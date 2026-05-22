import { NextRequest, NextResponse } from "next/server";
import { isHttpError, requireAuth, unauthorizedResponse, forbiddenResponse, notFoundResponse } from "@/lib/middleware";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const user = await requireAuth(request);
    const jobId = params.jobId;

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(jobId)) {
      return NextResponse.json(
        { error: "Invalid job ID format. Expected a UUID" },
        { status: 400 }
      );
    }

    // Check job existence and ownership
    const job = await prisma.analysisJob.findFirst({
      where: { id: jobId, userId: user.userId },
      select: {
        id: true,
        status: true,
        type: true,
        repositoryId: true,
        attempts: true,
        maxAttempts: true,
        nextRunAt: true,
        progressPercent: true,
        progressMessage: true,
        progressDetails: true,
        startedAt: true,
        finishedAt: true,
        error: true,
        updatedAt: true,
        createdAt: true,
      }
    });

    if (!job) {
      return notFoundResponse("Job not found");
    }

    return NextResponse.json({ job });
  } catch (error: any) {
    console.error("GET /analysis/:jobId error:", error);
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
