import { NextRequest, NextResponse } from "next/server";
import { isHttpError, requireAuth, unauthorizedResponse, forbiddenResponse, notFoundResponse } from "@/lib/middleware";
import prisma from "@/lib/prisma";
import { getGeminiService } from "@/lib/services/geminiService";
import { repositoryService } from "@/lib/services/repositoryService";

export async function POST(request: NextRequest) {
  try {

    const user = await requireAuth(request);
    let body;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const { repositoryId, question, conversationHistory, prompt } = body || {};

    // Validating prompt type if provided
    if (prompt !== undefined && typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Prompt must be a string" },
        { status: 400 }
      );
    }

    // Free-form mode: client provides a prebuilt prompt
    if (typeof prompt === "string" && prompt.trim()) {
      const response = await getGeminiService().chatRaw(prompt);

      return NextResponse.json({ response });
    }

    // Validating repositoryId
    const parsedRepositoryId = Number(repositoryId);

    if (
      typeof repositoryId !== "string" ||
      !repositoryId.trim() ||
      Number.isNaN(parsedRepositoryId)
    ) {
      return NextResponse.json(
        { error: "Valid repository ID is required" },
        { status: 400 }
      );
    }

    // Validating question
    if (
      typeof question !== "string" ||
      !question.trim()
    ) {
      return NextResponse.json(
        { error: "Valid question is required" },
        { status: 400 }
      );
    }

    // Validating conversationHistory 
    if (
      conversationHistory !== undefined &&
      !Array.isArray(conversationHistory)
    ) {
      return NextResponse.json(
        { error: "conversationHistory must be an array" },
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
      parsedRepositoryId,
      user.userId
    );

    if (!repository) {
      return notFoundResponse("Repository not found");
    }

    const context = {
      files: repository.files
        .slice(0, 20)
        .map((f: { path: string }) => f.path),

      recentCommits: repository.commits
        .slice(0, 5)
        .map(
          (c: { shortHash: string; message: string }) =>
            `${c.shortHash}: ${c.message}`
        ),

      contributors: repository.contributors.map(
        (c: { name: string }) => c.name
      ),
    };

    const response = await getGeminiService().chatAboutRepository({
      repositoryId: parsedRepositoryId,
      question,
      conversationHistory,
      context,
    });

    return NextResponse.json({ response, question });

  } catch (error: any) {
    console.error("AI chat error:", error);

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
