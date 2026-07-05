import { NextRequest, NextResponse } from "next/server";
import { getWaybackRunStatus, fetchWaybackResults } from "@/lib/apify-wayback";
import { getRun, updateRun, upsertResults } from "@/lib/wayback-db";
import { markExcluded } from "@/lib/ahrefs-db";
import { excludeFlagged } from "@/lib/expired-db";

/**
 * GET /api/wayback/runs/:runId
 *   Polls Apify for run status. If SUCCEEDED and not yet ingested, fetches the
 *   dataset and upserts into wayback_results in the same call. Idempotent —
 *   safe to poll repeatedly; ingestion happens at most once.
 *
 *   Flagged domains (betting/adult) AND domains with no Wayback snapshots are
 *   auto-excluded in target_assessment so they drop out of the picker without a
 *   manual "Loại trừ" pass. Harmless for inventory-owned domains — the inventory
 *   view doesn't filter on excluded_at.
 *
 * Response: { run, ingested: { count, autoExcluded, flaggedCount, noSnapshotCount } | null }
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

    let ingested: {
      count: number;
      autoExcluded: number;
      autoExcludedDomains: string[];
      flaggedCount: number;
      noSnapshotCount: number;
    } | null = null;
    if (live.status === "SUCCEEDED" && live.datasetId && !dbRow.ingestedAt) {
      const items = await fetchWaybackResults(live.datasetId);
      const { count } = await upsertResults(items);
      // Auto-exclude domains that aren't worth picking, so they vanish without a
      // manual "Loại trừ" pass. The domain list is returned so the client can
      // also prune its justUploadedTargets bypass set — otherwise rows uploaded
      // in the same session would keep showing despite excluded_at.
      //   • flagged: betting/adult content history.
      //   • no snapshot: 0 Wayback snapshots (check succeeded, no archive history
      //     → domain has no aged value). Errored checks are left for manual review.
      const flagged = items
        .filter((it) => it.hasBetting || it.hasAdult)
        .map((it) => it.domain.toLowerCase().trim());
      // No-snapshot = không có snapshot nào. Actor báo qua errorReason "No snapshots
      // found" HOẶC snapshotCount=0. Lỗi THẬT (rate-limit/timeout…) thì KHÔNG loại,
      // để review/thử lại tay.
      const noSnapshot = items
        .filter((it) =>
          !it.hasBetting && !it.hasAdult &&
          (it.snapshotCount ?? 0) === 0 &&
          (!it.errorReason || /no\s*snapshots?\s*found/i.test(it.errorReason)))
        .map((it) => it.domain.toLowerCase().trim());
      const toExclude = Array.from(new Set([...flagged, ...noSnapshot]));
      let autoExcluded = 0;
      if (toExclude.length > 0) {
        const ex = await markExcluded(toExclude);          // Picker (target_assessment)
        autoExcluded = ex.count;
        await excludeFlagged(toExclude);                    // Domain Drop (expired_candidates → status='excluded')
      }
      await updateRun(runId, { ingested_at: new Date().toISOString() });
      ingested = {
        count,
        autoExcluded,
        autoExcludedDomains: toExclude,
        flaggedCount: flagged.length,
        noSnapshotCount: noSnapshot.length,
      };
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
