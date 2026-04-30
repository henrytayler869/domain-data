import { NextRequest, NextResponse } from "next/server";
import { checkCredentials, makeSessionToken, SESSION_COOKIE } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json() as { username: string; password: string };
    if (!username || !password) {
      return NextResponse.json({ error: "Thiếu username hoặc password" }, { status: 400 });
    }
    if (!checkCredentials(username, password)) {
      return NextResponse.json({ error: "Sai username hoặc password" }, { status: 401 });
    }
    const token = await makeSessionToken();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return res;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
