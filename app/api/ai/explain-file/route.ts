import { NextRequest, NextResponse } from "next/server";
import { isHttpError, requireAuth, unauthorizedResponse, forbiddenResponse, notFoundResponse } from "@/lib/middleware";
import prisma from "@/lib/prisma";
import { repositoryService } from "@/lib/services/repositoryService";

type RepositoryFile = {
  path: string;
  size: number; // bytes or LOC
  language?: string; // e.g. "TypeScript"
  extension?: string; // e.g. "TypeScript"
};

type RepositoryCommit = {
  shortHash: string;
  message: string;
};

type RepositoryContributor = {
  name: string;
};

type Repository = {
  files: RepositoryFile[];
  commits: RepositoryCommit[];
  contributors: RepositoryContributor[];
};

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();
    const { repositoryId, filePath } = body;

    if (!repositoryId || !filePath) {
      return NextResponse.json(
        { error: "Repository ID and file path are required" },
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

    const repository = (await repositoryService.getRepository(
      repositoryId,
      user.userId
    )) as Repository;

    if (!repository) {
      return notFoundResponse("Repository not found");
    }

    const file = repository.files.find((f) => f.path === filePath);

    if (!file) {
      return notFoundResponse("File not found in repository");
    }

    const explanation = `File: ${file.path}\nSize: ${file.size} bytes\nLanguage: ${file.language || "Unknown"}\n\nThis is a ${file.extension || "file"} in the repository.`;

    return NextResponse.json({
      explanation,
      file: { path: file.path, language: file.language },
    });
  } catch (error: any) {
    console.error("File explanation error:", error);

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
