import { NextRequest, NextResponse } from "next/server";
import { readSettings, writeSettings } from "@/lib/settings";

function maskSecret(s: string): string {
  if (s.length === 0) return "";
  if (s.length <= 4) return "••••••";
  return s.slice(0, 2) + "••••••" + s.slice(-2);
}

// GET — return settings (password is NEVER sent to client)
export async function GET() {
  try {
    const s = await readSettings();
    return NextResponse.json({
      dataforseoLogin: s.dataforseoLogin,
      hasPassword: s.dataforseoPassword.length > 0,
      passwordHint: maskSecret(s.dataforseoPassword),
      n8nWebhookUrl: s.n8nWebhookUrl,
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
      n8nWebhookUrl: body.n8nWebhookUrl,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
