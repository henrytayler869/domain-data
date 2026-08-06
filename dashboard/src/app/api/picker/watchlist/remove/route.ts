import { NextRequest, NextResponse } from "next/server";
import { remove } from "@/lib/watchlist-db";

/**
 * POST /api/picker/watchlist/remove { domains: string[] }
 *   Bỏ domain khỏi watchlist. Session-gated.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { domains?: string[] };
    const domains = (body.domains ?? []).filter(Boolean);
    if (!domains.length) return NextResponse.json({ error: "Không có domain để bỏ" }, { status: 400 });
    const res = await remove(domains);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
