import { NextRequest, NextResponse } from "next/server";
import { getWaybackRunStatus, fetchWaybackResults } from "@/lib/apify-wayback";
import { getRun, updateRun, upsertResults } from "@/lib/wayback-db";

/**
 * GET /api/wayback/runs/:runId
 *   Polls Apify for run status. If SUCCEEDED and not yet ingested, fetches the
 *   dataset and upserts into wayback_results in the same call. Idempotent —
 *   safe to poll repeatedly; ingestion happens at most once.
 *
 * Response: { run, ingested: { count } | null }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const dbRow = await getRun(runId);
    if (!dbRow) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Skip polling if already finished + ingested.
    if (dbRow.status === "SUCCEEDED" && dbRow.ingestedAt) {
      return NextResponse.json({ run: dbRow, ingested: null });
    }

    const live = await getWaybackRunStatus(runId);

    // Mirror status + dataset id back to DB.
    await updateRun(runId, {
      status: live.status,
      dataset_id: live.datasetId ?? dbRow.datasetId,
      finished_at: live.finishedAt ?? dbRow.finishedAt,
    });

    let ingested: { count: number } | null = null;
    if (live.status === "SUCCEEDED" && live.datasetId && !dbRow.ingestedAt) {
      const items = await fetchWaybackResults(live.datasetId);
      const { count } = await upsertResults(items);
      await updateRun(runId, { ingested_at: new Date().toISOString() });
      ingested = { count };
    } else if (["FAILED", "TIMED-OUT", "ABORTED"].includes(live.status) && !dbRow.error) {
      await updateRun(runId, { error: `Apify status: ${live.status}` });
    }

    // Fetch fresh row to return.
    const fresh = await getRun(runId);
    return NextResponse.json({ run: fresh, ingested });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
