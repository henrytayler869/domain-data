import { NextRequest, NextResponse } from "next/server";
import { readApifySettings, writeApifySettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

function maskSecret(s: string): string {
  if (!s) return "";
  if (s.length <= 6) return "••••••";
  return s.slice(0, 4) + "••••••" + s.slice(-4);
}

// GET — trạng thái Apify (token KHÔNG trả về client, chỉ hint)
export async function GET() {
  try {
    const s = await readApifySettings();
    return NextResponse.json({
      hasApifyToken: s.apifyToken.length > 0,
      apifyTokenHint: maskSecret(s.apifyToken),
      apifyActorId: s.apifyActorId,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

// POST — lưu token/actor (token để trống = giữ nguyên)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    await writeApifySettings({
      apifyToken: body.apifyToken,
      apifyActorId: body.apifyActorId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
