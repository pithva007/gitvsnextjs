import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from '@/src/utils/rateLimit';
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { generateToken } from "@/lib/auth";
import { unauthorizedResponse, forbiddenResponse, notFoundResponse, isHttpError } from "@/lib/middleware";

export async function POST(request: NextRequest) {
  try {
// 1. EXTRACT IP AND CHECK RATE LIMIT FIRST
    const forwardedFor = request.headers.get('x-forwarded-for');
    const ip = forwardedFor?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown-ip';
    
    const rateLimitResult = checkRateLimit(ip);
    
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { 
          status: 429, 
          headers: {
            'Retry-After': rateLimitResult.retryAfter?.toString() || '900'
          }
        }
      );
    }

    // 2. PARSE BODY
    const body = await request.json();
    const { email, password } = body;

    // Validation
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Please provide a valid email address" },
        { status: 400 }
      );
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return unauthorizedResponse("Invalid email or password");
    }

    // Security: never allow password login for Google-only accounts.
    if (!user.passwordHash) {
      const hasGoogleAccount =
        (await prisma.account.count({
          where: { userId: user.id, provider: "google" },
        })) > 0;

      if (hasGoogleAccount) {
        return unauthorizedResponse("Email already exists. Please sign in with Google.");
      }
    }

    // Verify password
    const passwordHash = user.passwordHash || (user as any).password;
    if (!passwordHash) {
      return unauthorizedResponse("Invalid email or password");
    }

    const isValidPassword = await bcrypt.compare(password, passwordHash);

    if (!isValidPassword) {
      return unauthorizedResponse("Invalid email or password");
    }

    // Generate JWT token
    const token = generateToken({ userId: user.id, email: user.email });

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: (user as any).image,
      },
      token,
    });
  } catch (error: any) {
    console.error("Login error:", error);
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