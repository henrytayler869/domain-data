import { NextRequest, NextResponse } from "next/server";
import { startWaybackRun } from "@/lib/apify-wayback";
import { createRun, listRecentRuns } from "@/lib/wayback-db";

/**
 * POST /api/wayback/runs
 *   Body: { targets: string[] }
 *   Triggers an async Apify run and persists the runId so the UI can poll.
 *
 * GET /api/wayback/runs
 *   Returns the 20 most recent runs (for resume-after-refresh).
 */

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { targets?: string[] };
    const targets = (body.targets ?? [])
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (!targets.length) {
      return NextResponse.json({ error: "Cần ít nhất 1 target domain" }, { status: 400 });
    }
    const run = await startWaybackRun(targets);
    await createRun(run.runId, targets, run.status, run.datasetId);
    return NextResponse.json({ ok: true, run });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const runs = await listRecentRuns(20);
    return NextResponse.json({ runs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
