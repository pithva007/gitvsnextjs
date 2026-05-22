import { NextRequest, NextResponse } from "next/server";
import { isHttpError, requireAuth, unauthorizedResponse, forbiddenResponse, notFoundResponse } from "@/lib/middleware";
import prisma from "@/lib/prisma";
import { GitHubService, GitHubRateLimitError } from "@/lib/services/githubService";
import { sanitizeErrorMessage } from "@/lib/utils/rateLimit";
import { toJsonSafe } from "@/lib/utils/jsonSafe";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();
    const token = (body?.token as string | undefined)?.trim();

    if (!token) {
      return NextResponse.json(
        { error: "GitHub token is required" },
        { status: 400 },
      );
    }

    const github = new GitHubService(token);
    const me = await github.getAuthenticatedUser();

    const account = await prisma.gitHubAccount.upsert({
      where: { userId: user.userId },
      create: {
        userId: user.userId,
        githubUserId: BigInt(me.id),
        username: me.login,
        accessToken: token,
      },
      update: {
        githubUserId: BigInt(me.id),
        username: me.login,
        accessToken: token,
      },
      select: {
        id: true,
        userId: true,
        githubUserId: true,
        username: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ account: toJsonSafe(account) }, { status: 200 });
  } catch (error: any) {
    console.error("GitHub connect error:", sanitizeErrorMessage(error));

    if (error instanceof GitHubRateLimitError) {
      return NextResponse.json(
        { error: error.message, retryAfter: error.retryAfterSeconds },
        { status: 429 }
      );
    }

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
