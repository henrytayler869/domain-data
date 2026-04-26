import { NextRequest, NextResponse } from "next/server";
import { readSettings, writeSettings } from "@/lib/settings";

// GET — return settings (password is NEVER sent to client)
export async function GET() {
  try {
    const s = await readSettings();
    return NextResponse.json({
      dataforseoLogin: s.dataforseoLogin,
      hasPassword: s.dataforseoPassword.length > 0,
      // Mask: first 2 chars + dots + last 2 chars
      passwordHint: s.dataforseoPassword.length > 4
        ? s.dataforseoPassword.slice(0, 2) + "••••••" + s.dataforseoPassword.slice(-2)
        : s.dataforseoPassword.length > 0 ? "••••••" : "",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST — save settings
// body: { dataforseoLogin?: string; dataforseoPassword?: string }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    await writeSettings({
      dataforseoLogin: body.dataforseoLogin,
      dataforseoPassword: body.dataforseoPassword,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
