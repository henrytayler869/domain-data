import { NextRequest, NextResponse } from "next/server";
import { pollAndIngestRun } from "@/lib/wayback-poll";

/**
 * GET /api/wayback/runs/:runId
 *   Poll Apify cho 1 run. SUCCEEDED lần đầu → fetch dataset + upsert wayback_results
 *   + auto-loại flagged/no-snapshot. Idempotent (poll lại an toàn, ingest tối đa 1 lần).
 *
 * Response: { run, ingested: { count, autoExcluded, ... } | null }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const res = await pollAndIngestRun(runId);
    if (!res.run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
