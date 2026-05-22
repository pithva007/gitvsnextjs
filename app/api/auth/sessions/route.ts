import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, unauthorizedResponse, forbiddenResponse, notFoundResponse, isHttpError } from "@/lib/middleware";
import prisma from "@/lib/prisma";
import { toJsonSafe } from "@/lib/utils/jsonSafe";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);

    if (!user) {
      return unauthorizedResponse("Not authenticated");
    }

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const cursor = searchParams.get("cursor");

    // Default limit 10, max 50
    let limit = 10;
    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        limit = Math.min(parsedLimit, 50);
      }
    }

    // Fetch one extra item to determine if there is a next page
    const sessions = await prisma.session.findMany({
      where: { userId: user.userId },
      take: limit + 1,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { expires: "desc" },
    });

    let nextCursor: string | undefined = undefined;
    if (sessions.length > limit) {
      sessions.pop(); // Remove the extra item
      nextCursor = sessions[sessions.length - 1]?.id;
    }

    return NextResponse.json({
      items: toJsonSafe(sessions),
      nextCursor,
    });
  } catch (error: any) {
    console.error("Fetch sessions error:", error);
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
