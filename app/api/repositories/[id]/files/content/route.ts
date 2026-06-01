import { NextRequest, NextResponse } from "next/server";
import { isHttpError, requireAuth, sanitizeError } from "@/lib/middleware";
import { repositoryService } from "@/lib/services/repositoryService";

function validateFilePath(filePath: string): string | null {
  if (filePath.includes("..")) return "Path traversal detected";
  if (filePath.startsWith("/")) return "Absolute path not allowed";
  if (filePath.includes("\0")) return "Null bytes not allowed";
  
  // Prevent reading sensitive files like .env or private key files
  const filename = filePath.split("/").pop() || "";
  if (
    filename === ".env" || 
    filename.endsWith(".env") || 
    filename.endsWith(".pem") || 
    filename.endsWith(".key")
  ) {
    return "Access to sensitive files is restricted";
  }

  // Restrict file types: Only allow text files, reject common binaries
  const blockedExtensions = [
    // Images
    "png", "jpg", "jpeg", "gif", "webp", "ico", "tiff", "bmp", "svg",
    // Archives
    "zip", "tar", "gz", "rar", "7z", "tgz",
    // Binaries / Executables
    "exe", "dll", "so", "bin", "dmg", "iso", "jar", "war", "class",
    // Documents / Media
    "pdf", "docx", "xlsx", "pptx", "mp3", "mp4", "wav", "avi", "mkv", "mov",
    // Fonts
    "woff", "woff2", "ttf", "eot", "otf"
  ];
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (blockedExtensions.includes(ext)) {
    return "Binary files and media are not supported for preview";
  }

  return null;
}

function encodePathSegments(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(request);
    const id = parseInt(params.id);
    const searchParams = request.nextUrl.searchParams;
    const filePath = searchParams.get("path");

    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid repository ID" }, { status: 400 });
    }

    if (!filePath) {
      return NextResponse.json({ error: "File path is required" }, { status: 400 });
    }

    const validatedError = validateFilePath(filePath);
    if (validatedError) {
      return NextResponse.json({ error: validatedError }, { status: 400 });
    }

    const repository = await repositoryService.getRepository(id, user.userId);

    if (!repository) {
      return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    }

    // Attempt to fetch from raw.githubusercontent.com
    const url = String(repository.url || "");
    const m = url.match(
      /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?\/?$/i
    );
    
    if (!m) {
      return NextResponse.json({ error: "Only GitHub repositories are supported for file viewing" }, { status: 400 });
    }

    const owner = m[1];
    const repo = m[2];
    const branch = String(repository.defaultBranch || "main");
    
    const encodedPath = encodePathSegments(filePath);
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encodedPath}`;

    const response = await fetch(rawUrl);

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json({ error: "File not found on GitHub" }, { status: 404 });
      }
      return NextResponse.json({ error: `GitHub API error: ${response.statusText}` }, { status: response.status });
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const size = parseInt(contentLengthHeader, 10);
      if (size > 1024 * 1024) { // 1MB limit
        return NextResponse.json({ error: "File size exceeds 1MB limit" }, { status: 400 });
      }
    }

    const content = await response.text();
    if (content.length > 1024 * 1024) { // 1MB limit
      return NextResponse.json({ error: "File size exceeds 1MB limit" }, { status: 400 });
    }

    return NextResponse.json({ content, path: filePath });
  } catch (error: any) {
    console.error("Error fetching file content:", sanitizeError(error));

    if (isHttpError(error)) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch file content" },
      { status: 500 }
    );
  }
}
