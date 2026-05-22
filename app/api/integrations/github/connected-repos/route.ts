import { NextRequest, NextResponse } from "next/server";
import { isHttpError, requireAuth, unauthorizedResponse, forbiddenResponse, notFoundResponse } from "@/lib/middleware";
import prisma from "@/lib/prisma";
import { sanitizeErrorMessage } from "@/lib/utils/rateLimit";
import { toJsonSafe } from "@/lib/utils/jsonSafe";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const account = await prisma.gitHubAccount.findUnique({
      where: { userId: user.userId },
      select: {
        id: true,
        username: true,
        githubUserId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const repos = await prisma.gitHubRepo.findMany({
      where: { userId: user.userId },
      orderBy: [{ enabled: "desc" }, { repoFullName: "asc" }],
      select: {
        id: true,
        repoFullName: true,
        installationId: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      { account: toJsonSafe(account), repos: toJsonSafe(repos) },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("GitHub connected repos error:", sanitizeErrorMessage(error));
    if (isHttpError(error)) {
      if (error.status === 401) return unauthorizedResponse(error.message);
      if (error.status === 403) return forbiddenResponse(error.message);
      if (error.status === 404) return notFoundResponse(error.message);
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error: "An unexpected error occurred",
      },
      { status: 500 },
    );
  }
}
