import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { isHttpError, requireAuth, unauthorizedResponse, forbiddenResponse, notFoundResponse } from "@/lib/middleware";
import { sanitizeErrorMessage } from "@/lib/utils/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    const userDetails = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true,
      },
    });

    const hasGoogleAccount =
      (await prisma.account.count({
        where: { userId: user.userId, provider: "google" },
      })) > 0;

    if (!userDetails) {
      return notFoundResponse("User not found");
    }

    return NextResponse.json({
      id: userDetails.id,
      name: userDetails.name,
      email: userDetails.email,
      image: userDetails.image,
      createdAt: userDetails.createdAt,
      avatarUrl: (userDetails as any).image,
      isGoogleLinked: hasGoogleAccount,
    });
  } catch (error: any) {
    console.error("Error fetching user:", sanitizeErrorMessage(error));
    if (isHttpError(error)) {
      if (error.status === 401) return unauthorizedResponse(error.message);
      if (error.status === 403) return forbiddenResponse(error.message);
      if (error.status === 404) return notFoundResponse(error.message);
      return NextResponse.json(
        { message: error.message },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    await prisma.user.delete({
      where: { id: user.userId },
    });

    return NextResponse.json({ message: "Account deleted" });
  } catch (error: any) {
    console.error("Error deleting account:", sanitizeErrorMessage(error));
    if (error?.code === "P2025") {
      return notFoundResponse("User not found");
    }
    if (isHttpError(error)) {
      if (error.status === 401) return unauthorizedResponse(error.message);
      if (error.status === 403) return forbiddenResponse(error.message);
      if (error.status === 404) return notFoundResponse(error.message);
      return NextResponse.json(
        { message: error.message },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
