import { NextResponse } from "next/server";
import { listPendingRuns } from "@/lib/wayback-db";
import { pollAndIngestRun } from "@/lib/wayback-poll";

/**
 * POST /api/wayback/sweep
 *   Poll + ingest TẤT CẢ run Wayback còn pending (READY/RUNNING hoặc SUCCEEDED chưa
 *   ingest) — không giới hạn 20. Thay cho việc client tự poll từng run (chỉ thấy 20
 *   run gần nhất + dừng khi rời step 4). Idempotent, gọi lặp mỗi ~12s cho tới khi
 *   stillPending = 0.
 *
 * Response: { polled, ingestedRuns, ingestedResults, stillPending, errors }
 */
export async function POST() {
  try {
    const pending = await listPendingRuns();
    const CONC = 5;
    let cursor = 0, ingestedRuns = 0, ingestedResults = 0, errors = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const r = pending[cursor++];
        try {
          const res = await pollAndIngestRun(r.runId);
          if (res.ingested) { ingestedRuns++; ingestedResults += res.ingested.count; }
        } catch { errors++; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, pending.length || 1) }, () => worker()));
    const still = await listPendingRuns();
    return NextResponse.json({
      ok: true,
      polled: pending.length,
      ingestedRuns,
      ingestedResults,
      stillPending: still.length,
      errors,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
