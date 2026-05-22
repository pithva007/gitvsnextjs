import { NextRequest, NextResponse } from "next/server";
import { isHttpError, requireAuth, unauthorizedResponse, forbiddenResponse, notFoundResponse } from "@/lib/middleware";
import { getGeminiService } from "@/lib/services/geminiService";

export async function POST(request: NextRequest) {
  try {
    await requireAuth(request);
    const body = await request.json();
    const { added, modified, deleted, diff } = body;

    if (
      (!added || added.length === 0) &&
      (!modified || modified.length === 0) &&
      (!deleted || deleted.length === 0) &&
      !diff
    ) {
      return NextResponse.json(
        { error: "At least one of added, modified, deleted, or diff is required" },
        { status: 400 }
      );
    }

    const suggestions = await getGeminiService().suggestCommitMessage({
      added: added || [],
      modified: modified || [],
      deleted: deleted || [],
      diff,
    });

    return NextResponse.json({ suggestions });
  } catch (error: any) {
    console.error("Commit suggestion error:", error);

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
