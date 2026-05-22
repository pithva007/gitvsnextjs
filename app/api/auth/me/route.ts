import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAuthUser, unauthorizedResponse, forbiddenResponse, notFoundResponse, isHttpError } from "@/lib/middleware";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);

    if (!user) {
      return unauthorizedResponse("Not authenticated");
    }

    // Fetch user details
    const userDetails = await prisma.user.findUnique({
      where: { id: user.userId },
    });

    if (!userDetails) {
      return notFoundResponse("User not found");
    }

    return NextResponse.json({
      user: {
        id: userDetails.id,
        email: userDetails.email,
        name: userDetails.name,
        avatarUrl: (userDetails as any).image,
      },
    });
  } catch (error: any) {
    console.error("Get user error:", error);
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
