import { NextRequest, NextResponse } from "next/server";
import { readUnmatchedRefs, deleteUnmatchedRefs } from "@/lib/unmatched-refs-db";

/**
 * GET  /api/backlink-db/unmatched            → JSON { total, rows }
 * GET  /api/backlink-db/unmatched?format=csv → tải file CSV (domain,seen_count,...)
 *   Ref domain DataForSEO tìm thấy nhưng CHƯA có trong backlink_db (để check DR sau).
 * POST /api/backlink-db/unmatched  { domains: string[] }
 *   → xoá khỏi unmatched (khi đã check DR + bổ sung vào backlink_db).
 */
export async function GET(request: NextRequest) {
  try {
    const rows = await readUnmatchedRefs();
    if (request.nextUrl.searchParams.get("format") === "csv") {
      const csv = "domain,seen_count,first_seen,last_seen\n" +
        rows.map((r) => `${r.domain},${r.seenCount},${r.firstSeen},${r.lastSeen}`).join("\n");
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="unmatched_refs_${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }
    return NextResponse.json({ total: rows.length, rows });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { domains?: string[] };
    if (!Array.isArray(body.domains) || !body.domains.length) {
      return NextResponse.json({ error: "Cần domains: []" }, { status: 400 });
    }
    const res = await deleteUnmatchedRefs(body.domains);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
