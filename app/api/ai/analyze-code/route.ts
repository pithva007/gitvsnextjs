import { NextRequest, NextResponse } from "next/server";
import { isHttpError, requireAuth, unauthorizedResponse, forbiddenResponse, notFoundResponse } from "@/lib/middleware";
import { getGeminiService } from "@/lib/services/geminiService";

export async function POST(request: NextRequest) {
  try {
    await requireAuth(request);
    const body = await request.json();
    const { code, language, analysisType, context } = body;

    if (!code || !language || !analysisType) {
      return NextResponse.json(
        { error: "Code, language, and analysis type are required" },
        { status: 400 }
      );
    }

    if (code.length > 10000) {
      return NextResponse.json(
        { error: "Code snippet too large (max 10000 characters)" },
        { status: 400 }
      );
    }

    const analysis = await getGeminiService().analyzeCode({
      code,
      language,
      analysisType,
      context,
    });

    return NextResponse.json({ analysis, analysisType });
  } catch (error: any) {
    console.error("Code analysis error:", error);
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
