/**
 * Wayback Machine results — Supabase persistence.
 * Backed by `wayback_results` (per-domain) and `wayback_runs` (per-Apify-run).
 */

import { supabase } from "./supabase";
import type { WaybackResultItem, ApifyRunStatus } from "./apify-wayback";

const RESULTS_TABLE = "wayback_results";
const RUNS_TABLE = "wayback_runs";

export interface WaybackRow {
  targetDomain: string;
  snapshotCount: number | null;
  firstYear: string | null;
  lastYear: string | null;
  domainAge: number | null;
  hasBetting: boolean;
  hasAdult: boolean;
  contentHistory: WaybackResultItem["contentHistory"];
  problematicSnapshots: WaybackResultItem["problematicSnapshots"];
  errorReason: string | null;
  checkedAt: string;
}

export interface WaybackRunRow {
  runId: string;
  status: ApifyRunStatus;
  targets: string[];
  datasetId: string | null;
  startedAt: string;
  finishedAt: string | null;
  ingestedAt: string | null;
  error: string | null;
}

interface ResultsDbRow {
  target_domain: string;
  snapshot_count: number | null;
  first_year: string | null;
  last_year: string | null;
  domain_age: number | null;
  has_betting: boolean | null;
  has_adult: boolean | null;
  content_history: WaybackResultItem["contentHistory"] | null;
  problematic_snapshots: WaybackResultItem["problematicSnapshots"] | null;
  error_reason: string | null;
  checked_at: string;
}

interface RunDbRow {
  run_id: string;
  status: ApifyRunStatus;
  targets: string[];
  dataset_id: string | null;
  started_at: string;
  finished_at: string | null;
  ingested_at: string | null;
  error: string | null;
}

function rowToResult(r: ResultsDbRow): WaybackRow {
  return {
    targetDomain: r.target_domain,
    snapshotCount: r.snapshot_count,
    firstYear: r.first_year,
    lastYear: r.last_year,
    domainAge: r.domain_age,
    hasBetting: !!r.has_betting,
    hasAdult: !!r.has_adult,
    contentHistory: r.content_history ?? [],
    problematicSnapshots: r.problematic_snapshots ?? [],
    errorReason: r.error_reason,
    checkedAt: r.checked_at,
  };
}

function rowToRun(r: RunDbRow): WaybackRunRow {
  return {
    runId: r.run_id,
    status: r.status,
    targets: r.targets,
    datasetId: r.dataset_id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    ingestedAt: r.ingested_at,
    error: r.error,
  };
}

// ─── Results ──────────────────────────────────────────────────────────────────

export async function readAllResults(): Promise<WaybackRow[]> {
  const sb = supabase();
  const all: ResultsDbRow[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from(RESULTS_TABLE)
      .select("*")
      .order("checked_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as ResultsDbRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all.map(rowToResult);
}

export interface CheckedDomain { domain: string; flagged: boolean; noSnapshot: boolean }

/**
 * Danh sách domain ĐÃ check Wayback (chỉ cột nhẹ, không kéo JSONB). Dùng cho Domain
 * Picker Bước 2 để loại domain đã check / Flagged / no-snapshot.
 */
export async function listCheckedDomains(): Promise<CheckedDomain[]> {
  const sb = supabase();
  const out: CheckedDomain[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from(RESULTS_TABLE)
      .select("target_domain,has_betting,has_adult,snapshot_count,error_reason")
      .range(offset, offset + PAGE - 1);
    if (error) return out; // bảng có thể chưa tồn tại
    if (!data || data.length === 0) break;
    for (const r of data as Pick<ResultsDbRow, "target_domain" | "has_betting" | "has_adult" | "snapshot_count" | "error_reason">[]) {
      const flagged = !!(r.has_betting || r.has_adult);
      const noSnapshot = !flagged && (r.snapshot_count ?? 0) === 0;
      out.push({ domain: String(r.target_domain).toLowerCase(), flagged, noSnapshot });
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

export async function upsertResults(items: WaybackResultItem[]): Promise<{ count: number }> {
  if (!items.length) return { count: 0 };
  const sb = supabase();
  const rows: ResultsDbRow[] = items.map((it) => ({
    target_domain: it.domain.toLowerCase().trim(),
    snapshot_count: it.snapshotCount ?? null,
    first_year: it.firstYear ?? null,
    last_year: it.lastYear ?? null,
    domain_age: it.domainAge ?? null,
    has_betting: !!it.hasBetting,
    has_adult: !!it.hasAdult,
    content_history: it.contentHistory ?? [],
    problematic_snapshots: it.problematicSnapshots ?? [],
    error_reason: it.errorReason ?? null,
    checked_at: new Date().toISOString(),
  }));
  // Chunk to keep payload below Supabase REST limits (~1 MB) — JSONB rows can be large.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await sb.from(RESULTS_TABLE).upsert(slice, { onConflict: "target_domain" });
    if (error) throw new Error(error.message);
  }
  return { count: rows.length };
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

export async function createRun(
  runId: string,
  targets: string[],
  status: ApifyRunStatus,
  datasetId: string | null
): Promise<void> {
  const sb = supabase();
  const row: RunDbRow = {
    run_id: runId,
    status,
    targets,
    dataset_id: datasetId,
    started_at: new Date().toISOString(),
    finished_at: null,
    ingested_at: null,
    error: null,
  };
  const { error } = await sb.from(RUNS_TABLE).insert(row);
  if (error) throw new Error(error.message);
}

export async function updateRun(
  runId: string,
  patch: Partial<Pick<RunDbRow, "status" | "finished_at" | "ingested_at" | "error" | "dataset_id">>
): Promise<void> {
  const sb = supabase();
  const { error } = await sb.from(RUNS_TABLE).update(patch).eq("run_id", runId);
  if (error) throw new Error(error.message);
}

export async function getRun(runId: string): Promise<WaybackRunRow | null> {
  const sb = supabase();
  const { data, error } = await sb.from(RUNS_TABLE).select("*").eq("run_id", runId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToRun(data as RunDbRow) : null;
}

export async function listRecentRuns(limit = 20): Promise<WaybackRunRow[]> {
  const sb = supabase();
  const { data, error } = await sb
    .from(RUNS_TABLE)
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as RunDbRow[] | null)?.map(rowToRun) ?? [];
}

/**
 * TẤT CẢ run còn cần poll/ingest (KHÔNG giới hạn 20): đang chạy (READY/RUNNING)
 * hoặc đã SUCCEEDED nhưng chưa ingest. Dùng cho sweep để thu gom hết, tránh bỏ
 * rơi run khi 1 lần chạy tạo hàng trăm actor.
 */
export async function listPendingRuns(sinceHours = 12, limit = 3000): Promise<WaybackRunRow[]> {
  const sb = supabase();
  const since = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();
  const { data, error } = await sb
    .from(RUNS_TABLE)
    .select("*")
    .gte("started_at", since)
    .or("status.in.(READY,RUNNING),and(status.eq.SUCCEEDED,ingested_at.is.null)")
    .order("started_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as RunDbRow[] | null)?.map(rowToRun) ?? [];
}
