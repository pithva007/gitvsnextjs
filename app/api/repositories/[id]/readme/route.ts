import { NextRequest, NextResponse } from "next/server";
import { isHttpError, requireAuth, unauthorizedResponse, forbiddenResponse, notFoundResponse } from "@/lib/middleware";
import prisma from "@/lib/prisma";
import { repositoryService } from "@/lib/services/repositoryService";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireAuth(request);
    if (!/^\d+$/.test(params.id)) {
      return NextResponse.json(
        { error: "Invalid repository ID. Must be a positive integer." },
        { status: 400 },
      );
    }

    const id = Number(params.id);

    const existingRepo = await prisma.repository.findUnique({ where: { id } });
    if (!existingRepo) {
      return notFoundResponse("Repository not found");
    }
    if (existingRepo.userId !== user.userId) {
      return forbiddenResponse();
    }

    const repository = await repositoryService.fetchAndStoreReadme(
      id,
      user.userId,
    );

    return NextResponse.json({
      repository: {
        id: repository.id,
        readmePath: repository.readmePath,
        readmeText: repository.readmeText,
        readmeFetchedAt: repository.readmeFetchedAt,
      },
    });
  } catch (error: any) {
    console.error("Fetch README error:", error);

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
      { error: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
