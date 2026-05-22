import { NextRequest, NextResponse } from "next/server";
import { isHttpError, requireAuth, unauthorizedResponse, forbiddenResponse, notFoundResponse } from "@/lib/middleware";
import prisma from "@/lib/prisma";
import { getGeminiService } from "@/lib/services/geminiService";
import { repositoryService } from "@/lib/services/repositoryService";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();
    const { repositoryId, type } = body;

    if (!repositoryId || !type) {
      return NextResponse.json(
        { error: "Repository ID and analysis type are required" },
        { status: 400 }
      );
    }

    const existingRepo = await prisma.repository.findUnique({ where: { id: repositoryId } });
    if (!existingRepo) {
      return notFoundResponse("Repository not found");
    }
    if (existingRepo.userId !== user.userId) {
      return forbiddenResponse();
    }

    const repository = await repositoryService.getRepository(
      repositoryId,
      user.userId
    );

    if (!repository) {
      return notFoundResponse("Repository not found");
    }

    const context = {
      languages: repository.languages.map((l: any) => ({
        name: l.name,
        percentage: l.percentage,
      })),
      contributors: repository.contributors.map((c: any) => ({
        name: c.name,
        commits: c.commits,
      })),
      commits: repository.commits.slice(0, 10).map((c: any) => ({
        message: c.message,
        author: c.authorName,
        date: c.committedAt.toISOString(),
      })),
    };

    const analysis = await getGeminiService().analyzeRepository({
      repositoryId,
      type,
      context,
    });

    return NextResponse.json({ analysis, type });
  } catch (error: any) {
    console.error("Repository analysis error:", error);

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
