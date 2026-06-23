import { NextRequest, NextResponse } from "next/server";
import { readTargetSummaryFor } from "@/lib/ahrefs-db";

/**
 * POST /api/ahrefs-results/db/by-targets
 * Body: { targets: string[] }
 *
 * Trả TargetSummary CHỈ cho các target yêu cầu (query lọc `IN (...)`), thay vì
 * quét toàn bộ ahrefs_results. Dùng cho Kho Domain & tra cứu nhiều domain để
 * load nhanh (vài trăm domain thay vì chục nghìn dòng).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { targets?: unknown };
    const targets = Array.isArray(body.targets) ? body.targets.map(String) : [];
    const rows = await readTargetSummaryFor(targets);
    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
