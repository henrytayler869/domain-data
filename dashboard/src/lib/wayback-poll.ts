/**
 * Poll 1 Apify Wayback run + ingest kết quả (dùng chung cho:
 *   - GET /api/wayback/runs/:runId  (poll 1 run)
 *   - POST /api/wayback/sweep       (poll HẾT run pending)
 *
 * Idempotent: run đã SUCCEEDED + ingest thì bỏ qua. Khi SUCCEEDED lần đầu → fetch
 * dataset, upsert wayback_results, auto-loại domain flagged (betting/adult) và
 * no-snapshot khỏi picker (target_assessment) + Domain Drop (expired_candidates).
 */

import { getWaybackRunStatus, fetchWaybackResults } from "./apify-wayback";
import { getRun, updateRun, upsertResults, type WaybackRunRow } from "./wayback-db";
import { markExcluded } from "./ahrefs-db";
import { excludeFlagged } from "./expired-db";

export interface RunIngest {
  count: number;
  autoExcluded: number;
  autoExcludedDomains: string[];
  flaggedCount: number;
  noSnapshotCount: number;
}

export interface PollResult {
  run: WaybackRunRow | null;
  ingested: RunIngest | null;
}

export async function pollAndIngestRun(runId: string): Promise<PollResult> {
  const dbRow = await getRun(runId);
  if (!dbRow) return { run: null, ingested: null };

  // Đã xong + đã ingest → khỏi gọi Apify lại.
  if (dbRow.status === "SUCCEEDED" && dbRow.ingestedAt) {
    return { run: dbRow, ingested: null };
  }

  const live = await getWaybackRunStatus(runId);
  await updateRun(runId, {
    status: live.status,
    dataset_id: live.datasetId ?? dbRow.datasetId,
    finished_at: live.finishedAt ?? dbRow.finishedAt,
  });

  let ingested: RunIngest | null = null;
  if (live.status === "SUCCEEDED" && live.datasetId && !dbRow.ingestedAt) {
    const items = await fetchWaybackResults(live.datasetId);
    const { count } = await upsertResults(items);
    const flagged = items
      .filter((it) => it.hasBetting || it.hasAdult)
      .map((it) => it.domain.toLowerCase().trim());
    // no-snapshot = actor báo "No snapshots found" hoặc snapshotCount=0. Lỗi THẬT
    // (rate-limit/timeout) thì KHÔNG loại, để review/thử lại tay.
    const noSnapshot = items
      .filter((it) =>
        !it.hasBetting && !it.hasAdult &&
        (it.snapshotCount ?? 0) === 0 &&
        (!it.errorReason || /no\s*snapshots?\s*found/i.test(it.errorReason)))
      .map((it) => it.domain.toLowerCase().trim());
    const toExclude = Array.from(new Set([...flagged, ...noSnapshot]));
    let autoExcluded = 0;
    if (toExclude.length > 0) {
      const ex = await markExcluded(toExclude);
      autoExcluded = ex.count;
      await excludeFlagged(toExclude);
    }
    await updateRun(runId, { ingested_at: new Date().toISOString() });
    ingested = { count, autoExcluded, autoExcludedDomains: toExclude, flaggedCount: flagged.length, noSnapshotCount: noSnapshot.length };
  } else if (["FAILED", "TIMED-OUT", "ABORTED"].includes(live.status) && !dbRow.error) {
    await updateRun(runId, { error: `Apify status: ${live.status}` });
  }

  const fresh = await getRun(runId);
  return { run: fresh, ingested };
}
