import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, isAuthDisabled, SESSION_COOKIE } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  // Open access if AUTH_* env vars are not configured (local dev fallback).
  if (isAuthDisabled()) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const isValid = await verifySessionToken(token);

  if (!isValid) {
    const loginUrl = new URL("/login", request.url);
    if (request.nextUrl.pathname !== "/") {
      loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Apply to everything except: /login, /api/auth/*, Next.js internals, and common static files.
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon\\.ico|robots\\.txt|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|css|js|map)$).*)",
  ],
};
