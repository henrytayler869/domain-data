import { NextRequest, NextResponse } from "next/server";
import { readAll, addMany, type AddInput } from "@/lib/watchlist-db";

/**
 * GET  /api/picker/watchlist          → { total, entries }
 * POST /api/picker/watchlist { entries: [{domain, rating?, category?, detail?}] }
 *   Thêm domain vào watchlist (để xem xét mua sau). Session-gated.
 */
export async function GET() {
  try {
    const entries = await readAll();
    return NextResponse.json({ total: entries.length, entries });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { entries?: AddInput[] };
    const entries = (body.entries ?? []).filter((e) => e && e.domain);
    if (!entries.length) return NextResponse.json({ error: "Không có domain để thêm" }, { status: 400 });
    const res = await addMany(entries);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
