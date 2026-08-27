/**
 * Apify integration: Wayback Machine Actor.
 *
 * The actor (henry_tayler_869/wayback-machine-actor) is fully self-configured
 * server-side — we ONLY pass `{ domains }` and let it use its built-in defaults
 * (useProxy, useAI, maxSnapshotsToCheck, etc.).
 *
 * Two-step flow:
 *   1. POST /v2/acts/{id}/runs  → returns runId + defaultDatasetId immediately
 *   2. Poll GET /v2/actor-runs/{runId} until status === 'SUCCEEDED'
 *   3. GET /v2/datasets/{datasetId}/items → array of WaybackResult rows
 *
 * Only import from API routes (server-only) — uses APIFY_TOKEN.
 */

import { readApifySettings } from "./settings";

const APIFY_BASE = "https://api.apify.com/v2";

// Token + actor đọc từ app_settings (Cài đặt → Apify) → fallback env. Cho phép đổi
// tài khoản Apify khi hết credit mà không cần sửa .env.local + redeploy.
async function apifyCfg(): Promise<{ token: string; actorId: string }> {
  const s = await readApifySettings();
  if (!s.apifyToken) {
    throw new Error("Apify chưa cấu hình. Vào Cài đặt → Apify để nhập token (hoặc set APIFY_TOKEN).");
  }
  return { token: s.apifyToken, actorId: s.apifyActorId };
}

export type ApifyRunStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMING-OUT"
  | "TIMED-OUT"
  | "ABORTING"
  | "ABORTED";

export interface ApifyRunMeta {
  runId: string;
  status: ApifyRunStatus;
  datasetId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface WaybackResultItem {
  domain: string;
  snapshotCount: number;
  firstYear: string | null;
  lastYear: string | null;
  domainAge: number;
  hasBetting: boolean;
  hasAdult: boolean;
  contentHistory: Array<{
    year: string;
    timestamp: string;
    summary: string;
    hasBetting: boolean;
    hasAdult: boolean;
    confidence: string;
    keywords: string[];
  }>;
  problematicSnapshots: Array<{
    timestamp: string;
    url: string;
    title: string;
    summary: string;
    hasBetting: boolean;
    hasAdult: boolean;
    confidence: string;
    keywords: string[];
  }>;
  errorReason: string | null;
}

// ── Quét SÂU mặc định ──────────────────────────────────────────────────────────
// Đánh giá backlink history dựa vào Wayback: bỏ sót bet/adult = mua nhầm = mất tiền.
// Nên MẶC ĐỊNH quét sâu (nhiều snapshot) cho MỌI domain. Batch nhỏ + timeout run đủ
// dài để 1 run không bị Apify timeout (caller phải chia batch nhỏ — xem reconciler).
export const WAYBACK_MAX_SNAPSHOTS = 150;      // số snapshot/domain actor kiểm tra
export const WAYBACK_RUN_TIMEOUT_SECS = 3600;  // timeout mỗi Apify run (batch nhỏ → đủ)

export interface StartRunOpts {
  maxSnapshots?: number;   // override độ sâu quét
  timeoutSecs?: number;    // override timeout run
}

/** Trigger an async actor run. Returns immediately with runId + datasetId. */
export async function startWaybackRun(domains: string[], opts: StartRunOpts = {}): Promise<ApifyRunMeta> {
  if (!domains.length) throw new Error("domains rỗng");
  const maxSnapshots = opts.maxSnapshots ?? WAYBACK_MAX_SNAPSHOTS;
  const timeoutSecs = opts.timeoutSecs ?? WAYBACK_RUN_TIMEOUT_SECS;
  const { token, actorId } = await apifyCfg();
  const url = `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${token}&timeout=${timeoutSecs}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domains, maxSnapshotsToCheck: maxSnapshots }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `Apify start run failed (${res.status}): ${body?.error?.message ?? JSON.stringify(body).slice(0, 200)}`
    );
  }
  const d = body.data;
  return {
    runId: d.id,
    status: d.status,
    datasetId: d.defaultDatasetId ?? null,
    startedAt: d.startedAt ?? null,
    finishedAt: d.finishedAt ?? null,
  };
}

/** Poll a run for current status. Cheap — single GET, no dataset fetch. */
export async function getWaybackRunStatus(runId: string): Promise<ApifyRunMeta> {
  const { token } = await apifyCfg();
  const url = `${APIFY_BASE}/actor-runs/${encodeURIComponent(runId)}?token=${token}`;
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `Apify get run failed (${res.status}): ${body?.error?.message ?? JSON.stringify(body).slice(0, 200)}`
    );
  }
  const d = body.data;
  return {
    runId: d.id,
    status: d.status,
    datasetId: d.defaultDatasetId ?? null,
    startedAt: d.startedAt ?? null,
    finishedAt: d.finishedAt ?? null,
  };
}

/** Pull all items from a dataset. Paginates if >1000 items. */
export async function fetchWaybackResults(datasetId: string): Promise<WaybackResultItem[]> {
  const out: WaybackResultItem[] = [];
  const { token } = await apifyCfg();
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const url = `${APIFY_BASE}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${PAGE}&offset=${offset}&token=${token}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Apify fetch dataset failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const items = (await res.json()) as WaybackResultItem[];
    if (!items.length) break;
    out.push(...items);
    if (items.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

/**
 * Số Actor run đang CHIẾM slot concurrency (RUNNING + READY). Apify chặn tạo run
 * mới khi vượt giới hạn concurrent (tài khoản này = 32) → dùng để throttle dispatch.
 */
export async function countActiveRuns(): Promise<number> {
  const { token } = await apifyCfg();
  let total = 0;
  for (const status of ["RUNNING", "READY"] as const) {
    const res = await fetch(`${APIFY_BASE}/actor-runs?token=${token}&status=${status}&limit=1`);
    if (!res.ok) continue;
    const body = await res.json();
    total += body?.data?.total ?? 0;
  }
  return total;
}
