import { NextRequest, NextResponse } from "next/server";
import { readOps, writeOps } from "@/lib/ops-settings";

export const dynamic = "force-dynamic";

/** GET — cấu hình vận hành (hạn VPS). */
export async function GET() {
  try {
    return NextResponse.json(await readOps());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

/** POST { vpsExpiresAt: "yyyy-mm-dd" | null } */
export async function POST(request: NextRequest) {
  try {
    const b = (await request.json().catch(() => ({}))) as { vpsExpiresAt?: string | null };
    if (b.vpsExpiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(b.vpsExpiresAt)) {
      return NextResponse.json({ error: "Ngày không hợp lệ (yyyy-mm-dd)" }, { status: 400 });
    }
    await writeOps({ vpsExpiresAt: b.vpsExpiresAt || null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
