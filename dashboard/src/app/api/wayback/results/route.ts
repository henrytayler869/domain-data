import { NextRequest, NextResponse } from "next/server";
import { readAllResults, readResultsFor, readResultsForLight } from "@/lib/wayback-db";

export const dynamic = "force-dynamic";

/**
 * GET  /api/wayback/results            → toàn bộ wayback_results (dùng nội bộ / picker).
 * POST /api/wayback/results { targets } → CHỈ wayback của các domain yêu cầu (nhẹ hơn
 *   nhiều — Kho Domain chỉ cần vài trăm domain, không tải hết 6000+ dòng ~10MB).
 */
export async function GET() {
  try {
    return NextResponse.json({ rows: await readAllResults() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { targets?: string[]; full?: boolean };
    const targets = Array.isArray(body.targets) ? body.targets : [];
    // full=true → kéo JSONB nặng (chỉ dùng khi mở chi tiết 1 domain). Mặc định NHẸ
    // (badge flagged/clean) — bulk cả Kho ~1s thay vì ~135s vì bỏ content_history/problematic.
    const rows = body.full ? await readResultsFor(targets) : await readResultsForLight(targets);
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
