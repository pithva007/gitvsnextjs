/**
 * @jest-environment node
 *
 * Tests for GET /api/repositories/[id]/files/content
 */

jest.mock("@/lib/middleware", () => ({
  requireAuth: jest.fn(),
  sanitizeError: jest.fn((err) => err?.message || "Unknown error"),
  isHttpError: jest.fn(() => false),
}));

jest.mock("@/lib/services/repositoryService", () => ({
  repositoryService: {
    getRepository: jest.fn(),
  },
}));

import { GET } from "../route";
import { requireAuth } from "@/lib/middleware";
import { repositoryService } from "@/lib/services/repositoryService";
import { NextRequest } from "next/server";

describe("GET /api/repositories/[id]/files/content", () => {
  const mockUser = { userId: 123 };
  const mockRepo = {
    id: 1,
    url: "https://github.com/owner/repo",
    defaultBranch: "main",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (requireAuth as jest.Mock).mockResolvedValue(mockUser);
    (repositoryService.getRepository as jest.Mock).mockResolvedValue(mockRepo);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: jest.fn().mockReturnValue("100"),
      },
      text: jest.fn().mockResolvedValue("mocked content"),
    } as any);
  });

  it("successfully retrieves file content with valid parameters", async () => {
    const request = new NextRequest("http://localhost/api/repositories/1/files/content?path=src/index.js");
    const response = await GET(request, { params: { id: "1" } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.content).toBe("mocked content");
    expect(data.path).toBe("src/index.js");
  });

  it("blocks path traversal attempts containing '..'", async () => {
    const request = new NextRequest("http://localhost/api/repositories/1/files/content?path=../../.env");
    const response = await GET(request, { params: { id: "1" } });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Path traversal detected");
  });

  it("blocks absolute paths starting with '/'", async () => {
    const request = new NextRequest("http://localhost/api/repositories/1/files/content?path=/etc/passwd");
    const response = await GET(request, { params: { id: "1" } });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Absolute path not allowed");
  });

  it("blocks sensitive files like .env", async () => {
    const request = new NextRequest("http://localhost/api/repositories/1/files/content?path=.env");
    const response = await GET(request, { params: { id: "1" } });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Access to sensitive files is restricted");
  });

  it("blocks binary files like zip and png", async () => {
    const request = new NextRequest("http://localhost/api/repositories/1/files/content?path=assets/image.png");
    const response = await GET(request, { params: { id: "1" } });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Binary files and media are not supported");
  });

  it("limits file size using Content-Length header", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: jest.fn().mockImplementation((name) => {
          if (name.toLowerCase() === "content-length") {
            return String(1024 * 1024 + 100); // Exceeds 1MB
          }
          return null;
        }),
      },
      text: jest.fn().mockResolvedValue("mocked content"),
    } as any);

    const request = new NextRequest("http://localhost/api/repositories/1/files/content?path=src/index.js");
    const response = await GET(request, { params: { id: "1" } });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("File size exceeds 1MB limit");
  });
});
