import { NextRequest, NextResponse } from "next/server";
import { readAllResults, readResultsFor } from "@/lib/wayback-db";

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
    const body = (await request.json().catch(() => ({}))) as { targets?: string[] };
    const targets = Array.isArray(body.targets) ? body.targets : [];
    return NextResponse.json({ rows: await readResultsFor(targets) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
