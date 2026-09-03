import { NextRequest, NextResponse } from "next/server";
import { readSettings, writeSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

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
      hasAnthropicKey: s.anthropicApiKey.length > 0,
      anthropicKeyHint: maskSecret(s.anthropicApiKey),
      hasAhrefs1: s.ahrefsToken1.length > 0,
      ahrefs1Hint: maskSecret(s.ahrefsToken1),
      hasAhrefs2: s.ahrefsToken2.length > 0,
      ahrefs2Hint: maskSecret(s.ahrefsToken2),
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
      anthropicApiKey: body.anthropicApiKey,
      ahrefsToken1: body.ahrefsToken1,
      ahrefsToken2: body.ahrefsToken2,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
