import { NextRequest, NextResponse } from "next/server";
import { isHttpError, requireAuth, unauthorizedResponse, forbiddenResponse, notFoundResponse } from "@/lib/middleware";
import prisma from "@/lib/prisma";
import { isHttpError, requireAuth } from "@/lib/middleware";
import { repositoryService } from "@/lib/services/repositoryService";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(request);
    const id = Number(params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { error: "Invalid repository ID. Must be a positive integer." },
        { status: 400 }
      );
    }

    const existingRepo = await prisma.repository.findUnique({ where: { id } });
    if (!existingRepo) {
      return notFoundResponse("Repository not found");
    }
    if (existingRepo.userId !== user.userId) {
      return forbiddenResponse();
    }

    const stats = await repositoryService.getRepositoryStats(id, user.userId);

    return NextResponse.json({ stats });
  } catch (error: any) {
    console.error("Get repository stats error:", error);
    if (isHttpError(error)) {
      if (error.status === 401) return unauthorizedResponse(error.message);
      if (error.status === 403) return forbiddenResponse(error.message);
      if (error.status === 404) return notFoundResponse(error.message);
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    if (error.message === "Repository not found") {
      return notFoundResponse(error.message);
    if (error?.message === "Repository not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
