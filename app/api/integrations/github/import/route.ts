import { NextRequest, NextResponse } from "next/server";
import { isHttpError, requireAuth, unauthorizedResponse, forbiddenResponse, notFoundResponse } from "@/lib/middleware";
import { GitHubService, GitHubRateLimitError } from "@/lib/services/githubService";
import { sanitizeErrorMessage } from "@/lib/utils/rateLimit";
import { repositoryService } from "@/lib/services/repositoryService";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();
    const { url, token } = body;

    if (!url) {
      return NextResponse.json(
        { error: "Repository URL is required" },
        { status: 400 }
      );
    }

    if (!token) {
      return NextResponse.json(
        { error: "GitHub token is required" },
        { status: 400 }
      );
    }

    const parsed = GitHubService.parseGitHubUrl(url);
    if (!parsed) {
      return NextResponse.json(
        { error: "Invalid GitHub URL" },
        { status: 400 }
      );
    }

    const github = new GitHubService(token);
    const repoData = await github.getRepository(parsed.owner, parsed.repo);

    if (!repoData) {
      return NextResponse.json(
        { error: "Repository not found. It may have been renamed, deleted, or is inaccessible with the provided token." },
        { status: 404 }
      );
    }

    const repository = await repositoryService.createRepository({
      name: repoData.name,
      url: repoData.clone_url,
      description: repoData.description || undefined,
      userId: user.userId,
    });

    return NextResponse.json({ repository, source: "github" }, { status: 201 });
  } catch (error: any) {
    console.error("GitHub import error:", sanitizeErrorMessage(error));

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
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
