import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isHttpError, unauthorizedResponse, forbiddenResponse, notFoundResponse } from "@/lib/middleware";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(request);
    const jobId = params.id;

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(jobId)) {
      return NextResponse.json(
        { error: "Invalid job ID format. Expected a UUID" },
        { status: 400 }
      );
    }

    // Check job existence and ownership (Pattern C)
    const job = await prisma.analysisJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return notFoundResponse("Job not found");
    }

    if (job.userId !== user.userId) {
      return forbiddenResponse("You do not have access to this job");
    }

    const details = job.progressDetails as { retryAfter?: number; rateLimited?: boolean } | null;
    const retryAfter = details?.retryAfter ?? null;

    return NextResponse.json({
      job: {
        id: job.id,
        status: job.status,
        type: job.type,
        repositoryId: job.repositoryId,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        nextRunAt: job.nextRunAt,
        progressPercent: job.progressPercent,
        progressMessage: job.progressMessage,
        progressDetails: job.progressDetails,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        error: job.error,
        updatedAt: job.updatedAt,
        createdAt: job.createdAt,
        retryAfter,
        rateLimited: details?.rateLimited ?? false,
      },
    });
  } catch (error: any) {
    console.error("Get analysis job error:", error);

    if (isHttpError(error)) {
      if (error.status === 401) return unauthorizedResponse(error.message);
      if (error.status === 403) return forbiddenResponse(error.message);
      if (error.status === 404) return notFoundResponse(error.message);
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
