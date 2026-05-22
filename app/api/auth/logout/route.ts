import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, unauthorizedResponse, forbiddenResponse, notFoundResponse, isHttpError } from "@/lib/middleware";

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type");

    if (contentType && !contentType.includes("application/json")) {
      return NextResponse.json(
        { error: "Content-Type must be application/json"},
        { status: 400 }
      );
    }

    const user = await getAuthUser(request);

    if (!user) {
      return unauthorizedResponse("Not authenticated");
    }

    const contentLength = request.headers.get("content-length");

    if (
      contentType &&
      contentType.includes("application/json") &&
      contentLength !== "0"
    ) {
      const MAX_BODY_SIZE = 1024;

      if (contentLength && Number(contentLength) > MAX_BODY_SIZE) {
        return NextResponse.json(
          { error: "Request body too large" },
          { status: 413 }
        );
      }

      const rawBody = await request.text();

      // Only validate JSON when body actually exists
      if (rawBody.trim().length > 0) {
        try {
          JSON.parse(rawBody);
        } catch {
          return NextResponse.json(
            { error: "Invalid JSON payload" },
            { status: 400 }
          );
        }
      }
    }

    //Logout response

    // In a stateless JWT setup, logout is handled client-side by removing the token
    // We can optionally implement token blacklisting here if needed

    return NextResponse.json(
      { message: "Logged out successfully" },
      { status: 200 }
    );

  } catch (error: any) {
    console.error("Logout API Error:", error);
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