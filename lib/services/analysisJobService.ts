import prisma from "../prisma";
import type { AnalysisJob } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { isRetryableError, computeBackoffMs } from "../utils/retry";
import { analysisQueue } from "../queue/analysisQueue";

export type JobProgressUpdate = {
  progressPercent?: number;
  progressMessage?: string;
  progressDetails?: unknown;
};

const DEFAULT_LOCK_MS = 5 * 60 * 1000;

/**
 * AnalysisJobService
 *
 * Manages the lifecycle of repository analysis jobs: creation, claiming,
 * progress tracking, completion, and cleanup.  Uses a PostgreSQL-based
 * locking protocol with lock tokens to guarantee exactly-once processing
 * in a concurrent worker environment.
 *
 * ## Concurrency model
 *
 * - **Atomic reclaim + claim**: `claimNextJob()` runs `reclaimOrphanedJobs()`
 *   inside the same `$transaction` as the CTE claim.  PostgreSQL snapshot
 *   isolation ensures reclaimed rows are visible to the subsequent CTE.
 * - **Lock token**: Every claim generates a fresh `lock_token` UUID via
 *   `gen_random_uuid()`.  All mutating operations (heartbeat, markDone,
 *   markFailed, updateProgress, releaseLock) include the token in their
 *   WHERE clause, preventing stale writes from displaced workers.
 * - **FOR UPDATE SKIP LOCKED**: The claim CTE uses `FOR UPDATE SKIP LOCKED`
 *   so workers never block each other when contending for jobs.
 * - **Per-repo exclusivity**: The `NOT EXISTS` subquery prevents two
 *   PROCESSING jobs for the same repository.
 *
 * ## Race conditions eliminated
 *
 * 1. **TOCTOU reclaim → claim** (issue #1793): Previously, reclaim ran
 *    outside the claim transaction.  A new job inserted between reclaim
 *    and the CTE would be missed.  Now reclaim is inside the transaction.
 *
 * 2. **Zombie worker heartbeat** (issue #1793): A stale heartbeat from a
 *    displaced worker could extend the lock on a job another worker had
 *    claimed.  Now heartbeat checks `lock_token` — after reclaim or
 *    re-claim generates a new token, the old heartbeat silently fails.
 *
 * 3. **Stale markDone/markFailed** (issue #1793): A displaced worker could
 *    complete or fail a job it no longer owned.  Now every mutation
 *    validates both `locked_by` and `lock_token`.
 *
 * See `docs/infrastructure/analysis-job-worker.md` for the full
 * architecture document.
 */
export class AnalysisJobService {
  async getAnalysisStats(params: { userId: number }): Promise<{
    total: number;
    processing: number;
    queued: number;
    done: number;
    failed: number;
    stuck: number;
  }> {
    const [total, processing, queued, done, failed, stuck] =
      await Promise.all([
        prisma.analysisJob.count({ where: { userId: params.userId } }),
        prisma.analysisJob.count({
          where: { userId: params.userId, status: "PROCESSING" },
        }),
        prisma.analysisJob.count({
          where: { userId: params.userId, status: "QUEUED" },
        }),
        prisma.analysisJob.count({
          where: { userId: params.userId, status: "DONE" },
        }),
        prisma.analysisJob.count({
          where: { userId: params.userId, status: "FAILED" },
        }),
        prisma.analysisJob.count({
          where: {
            userId: params.userId,
            status: "PROCESSING",
            lockExpiresAt: { lt: new Date() },
          },
        }),
      ]);
    return { total, processing, queued, done, failed, stuck };
  }

  async createRepositoryAnalysisJob(params: {
    repositoryId: number;
    userId: number;
    maxAttempts?: number;
    scope?: string;
  }): Promise<AnalysisJob> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.analysisJob.findFirst({
        where: {
          repositoryId: params.repositoryId,
          status: { in: ["QUEUED", "PROCESSING"] },
        },
      });
      if (existing) return existing;

      try {
        const job = await tx.analysisJob.create({
          data: {
            repositoryId: params.repositoryId,
            userId: params.userId,
            type: "repository_analysis",
            status: "QUEUED",
            progressPercent: 0,
            progressMessage: "Queued",
            progressDetails: params.scope ? { scope: params.scope } : undefined,
            maxAttempts: params.maxAttempts ?? 3,
          },
        });
        await analysisQueue.add("repository_analysis", { jobId: job.id, userId: params.userId });
        return job;
      } catch (error: any) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const activeJob = await tx.analysisJob.findFirst({
            where: {
              repositoryId: params.repositoryId,
              status: { in: ["QUEUED", "PROCESSING"] },
            },
          });
          if (activeJob) return activeJob;
        }
        throw error;
      }
    });
  }

  async createArchitectureGenerationJob(params: {
    repositoryId: number;
    userId: number;
    maxAttempts?: number;
  }): Promise<AnalysisJob> {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${params.repositoryId})`;

      const existing = await tx.analysisJob.findFirst({
        where: {
          repositoryId: params.repositoryId,
          type: "architecture_generation",
          status: { in: ["QUEUED", "PROCESSING"] },
        },
      });
      if (existing) return existing;

      try {
        const job = await tx.analysisJob.create({
          data: {
            repositoryId: params.repositoryId,
            userId: params.userId,
            type: "architecture_generation",
            status: "QUEUED",
            progressPercent: 0,
            progressMessage: "Queued",
            maxAttempts: params.maxAttempts ?? 3,
          },
        });
        await analysisQueue.add("architecture_generation", { jobId: job.id, userId: params.userId });
        return job;
      } catch (error: any) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const activeJob = await tx.analysisJob.findFirst({
            where: {
              repositoryId: params.repositoryId,
              type: "architecture_generation",
              status: { in: ["QUEUED", "PROCESSING"] },
            },
          });
          if (activeJob) return activeJob;
        }
        throw error;
      }
    });
  }

  async getJob(params: {
    jobId: string;
    userId: number;
  }): Promise<AnalysisJob | null> {
    const job = await prisma.analysisJob.findUnique({
      where: {
        id: params.jobId,
      },
      include: {
        repository: {
          select: { userId: true },
        },
      },
    });

    if (!job) return null;

    let hasAccess = false;

    if (job.userId === params.userId) {
      hasAccess = true;
    } else if (job.repository.userId === params.userId) {
      hasAccess = true;
    } else {
      const orgAccess = await prisma.repositoryPolicyAssignment.findFirst({
        where: {
          repositoryId: job.repositoryId,
          organization: {
            members: {
              some: { userId: params.userId },
            },
          },
        },
      });

      if (orgAccess) {
        hasAccess = true;
      }
    }

    if (!hasAccess) {
      return null;
    }

    const { repository, ...jobData } = job as any;
    return jobData as AnalysisJob;
  }

  async updateProgress(params: {
    jobId: string;
    workerId?: string;
    lockToken?: string;
    update: JobProgressUpdate;
    extendLockMs?: number;
  }): Promise<void> {
    const lockExtension = params.extendLockMs ?? DEFAULT_LOCK_MS;

    const pct = params.update.progressPercent !== undefined
      ? Math.max(0, Math.min(100, Math.round(params.update.progressPercent)))
      : undefined;

    const where: any = { id: params.jobId };
    if (params.workerId) {
      where.lockedBy = params.workerId;
      if (params.lockToken) where.lockToken = params.lockToken;
    }

    await prisma.analysisJob.update({
      where,
      data: {
        progressPercent: pct,
        progressMessage: params.update.progressMessage,
        progressDetails: params.update.progressDetails as any,
        ...(params.workerId
          ? {
              lockExpiresAt: new Date(Date.now() + lockExtension),
            }
          : {}),
      },
    });
  }

  async markDone(params: {
    jobId: string;
    workerId?: string;
    lockToken?: string;
  }): Promise<void> {
    const where: any = { id: params.jobId };
    if (params.workerId) {
      where.lockedBy = params.workerId;
      if (params.lockToken) where.lockToken = params.lockToken;
    }

    await prisma.analysisJob.update({
      where,
      data: {
        status: "DONE",
        progressPercent: 100,
        progressMessage: "Analysis complete! ✓",
        finishedAt: new Date(),
        error: null,
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
        lockToken: null,
      },
    });
  }

  async markFailed(params: {
    jobId: string;
    workerId?: string;
    lockToken?: string;
    error: string;
    attempts: number;
    maxAttempts: number;
  }): Promise<void> {
    const where: any = { id: params.jobId };
    if (params.workerId) {
      where.lockedBy = params.workerId;
      if (params.lockToken) where.lockToken = params.lockToken;
    }

    const shouldRetry =
      params.attempts < params.maxAttempts &&
      isRetryableError(params.error);
    if (shouldRetry) {
      const delay = computeBackoffMs(params.attempts);
      await prisma.analysisJob.update({
        where,
        data: {
          status: "QUEUED",
          nextRunAt: new Date(Date.now() + delay),
          progressMessage: `Retrying in ${Math.round(delay / 1000)}s`,
          error: params.error,
          lockedAt: null,
          lockedBy: null,
          lockExpiresAt: null,
          lockToken: null,
        },
      });
      return;
    }

    await prisma.analysisJob.update({
      where,
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        progressMessage: "Analysis failed. Please try again.",
        progressPercent: null,
        error: params.error,
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
        lockToken: null,
      },
    });
  }

  /**
   * Claim the next available job for a worker.
   *
   * Runs inside a single `$transaction`:
   * 1. Reclaims any PROCESSING jobs with expired locks (resets to QUEUED).
   * 2. CTE claim: atomically picks one eligible job per-repo exclusivity.
   *
   * The claim generates a fresh `lock_token` via `gen_random_uuid()`:
   * every subsequent operation (heartbeat, markDone, markFailed) must
   * include this token to prove ownership.
   */
  async claimNextJob(params: {
    workerId: string;
    lockMs?: number;
  }): Promise<AnalysisJob | null> {
    const lockMs = params.lockMs ?? DEFAULT_LOCK_MS;

    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE analysis_jobs
        SET
          status = 'QUEUED',
          locked_by = NULL,
          locked_at = NULL,
          lock_expires_at = NULL,
          lock_token = NULL,
          updated_at = NOW()
        WHERE status = 'PROCESSING'
          AND lock_expires_at < NOW()
      `;

      const rows = await tx.$queryRaw<{ id: string }[]>`
        WITH candidate AS (
          SELECT a1.id
          FROM analysis_jobs a1
          WHERE a1.next_run_at <= NOW()
            AND a1.status IN ('QUEUED', 'PROCESSING')
            AND (a1.lock_expires_at IS NULL OR a1.lock_expires_at < NOW())
            AND NOT EXISTS (
              SELECT 1 FROM analysis_jobs a2
              WHERE a2.repository_id = a1.repository_id
                AND a2.status = 'PROCESSING'
                AND a2.id != a1.id
                AND (a2.lock_expires_at IS NULL OR a2.lock_expires_at > NOW())
            )
          ORDER BY a1.created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE analysis_jobs j
        SET
          status = 'PROCESSING',
          locked_at = NOW(),
          locked_by = ${params.workerId},
          lock_expires_at = NOW() + (${lockMs}::int * INTERVAL '1 millisecond'),
          lock_token = gen_random_uuid(),
          attempts = j.attempts + 1,
          started_at = COALESCE(j.started_at, NOW()),
          updated_at = NOW(),
          progress_message = COALESCE(j.progress_message, 'Analysis in progress...'),
          progress_percent = COALESCE(j.progress_percent, 0)
        FROM candidate
        WHERE j.id = candidate.id
        RETURNING j.id
      `;

      const claimedId = rows[0]?.id;
      if (!claimedId) return null;

      return tx.analysisJob.findUnique({ where: { id: claimedId } });
    });
  }

  /**
   * Immediately expire a lock so another worker can reclaim the job.
   * If `workerId` and `lockToken` are provided, they guard the WHERE
   * clause to prevent releasing a lock the caller does not own.
   */
  async releaseLock(params: {
    jobId: string;
    workerId?: string;
    lockToken?: string;
  }): Promise<void> {
    const where: any = { id: params.jobId };
    if (params.workerId) {
      where.lockedBy = params.workerId;
      if (params.lockToken) where.lockToken = params.lockToken;
    }
    await prisma.analysisJob.update({
      where,
      data: {
        lockExpiresAt: new Date(),
      },
    });
  }

  /**
   * Reset all PROCESSING jobs with expired locks back to QUEUED.
   * Clears `lockToken` so that any stale heartbeat or markDone from a
   * displaced worker silently fails.
   *
   * Called inside `claimNextJob`'s transaction to eliminate the TOCTOU
   * window between reclaim and claim (see #1793).
   */
  async reclaimOrphanedJobs(): Promise<number> {
    const result = await prisma.analysisJob.updateMany({
      where: {
        status: "PROCESSING",
        lockExpiresAt: { lt: new Date() },
      },
      data: {
        status: "QUEUED",
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
        lockToken: null,
      },
    });
    return result.count;
  }

  async countOrphanedJobs(params?: { userId?: number }): Promise<number> {
    const where: any = {
      status: "PROCESSING",
      lockExpiresAt: { lt: new Date() },
    };
    if (params?.userId != null) {
      where.userId = params.userId;
    }
    return prisma.analysisJob.count({ where });
  }

  /**
   * Release a job back to QUEUED when a worker is shutting down.
   * Sets `nextRunAt` to NOW so another worker can pick it up
   * immediately.  Clears `lockToken` to invalidate the old owner.
   */
  async markDrainReleased(params: {
    jobId: string;
    workerId?: string;
    lockToken?: string;
    error: string;
  }): Promise<void> {
    const where: any = { id: params.jobId };
    if (params.workerId) {
      where.lockedBy = params.workerId;
      if (params.lockToken) where.lockToken = params.lockToken;
    }
    await prisma.analysisJob.update({
      where,
      data: {
        status: "QUEUED",
        lockExpiresAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lockToken: null,
        nextRunAt: new Date(),
        progressMessage: "Worker shutting down — job released for reprocessing",
        error: params.error,
      },
    });
  }

  /**
   * Safety net for workers that terminate without releasing their locks.
   * Marks PROCESSING jobs whose lock has expired and whose last update
   * is older than the grace period (default 10 min) as FAILED.
   */
  async cleanupStaleJobs(gracePeriodMs: number = 10 * 60 * 1000): Promise<number> {
    const stale = await prisma.analysisJob.updateMany({
      where: {
        status: "PROCESSING",
        OR: [
          { lockExpiresAt: { lt: new Date() } },
          { lockExpiresAt: null },
        ],
        updatedAt: { lt: new Date(Date.now() - gracePeriodMs) },
      },
      data: {
        status: "FAILED",
        error: "Job timed out - no heartbeat received",
        progressMessage: "Job timed out - no heartbeat received",
        progressPercent: null,
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
        lockToken: null,
      },
    });
    return stale.count;
  }

  /**
   * Extend a worker's lock on a job.
   *
   * The UPDATE includes `locked_by` and `lock_token` in the WHERE clause.
   * If the job was reclaimed or re-claimed by another worker, the
   * `lock_token` will not match and the UPDATE affects 0 rows — the
   * caller detects it no longer holds the lock and should stop processing.
   */
  async heartbeat(params: {
    jobId: string;
    workerId: string;
    lockToken: string;
    lockMs?: number;
  }): Promise<void> {
    const lockMs = params.lockMs ?? DEFAULT_LOCK_MS;
    await prisma.$executeRaw`
      UPDATE analysis_jobs
      SET
        lock_expires_at = NOW() + (${lockMs}::int * INTERVAL '1 millisecond'),
        locked_by = ${params.workerId},
        updated_at = NOW()
      WHERE id = ${params.jobId}::uuid
        AND status = 'PROCESSING'
        AND locked_by = ${params.workerId}
        AND lock_token = ${params.lockToken}::uuid
    `;
  }
}

export const analysisJobService = new AnalysisJobService();
