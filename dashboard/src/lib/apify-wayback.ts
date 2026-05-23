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

const APIFY_BASE = "https://api.apify.com/v2";

function token(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) {
    throw new Error(
      "Apify chưa được cấu hình. Set APIFY_TOKEN trong dashboard/.env.local"
    );
  }
  return t;
}

function actorId(): string {
  return process.env.APIFY_WAYBACK_ACTOR_ID ?? "henry_tayler_869~wayback-machine-actor";
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

/** Trigger an async actor run. Returns immediately with runId + datasetId. */
export async function startWaybackRun(domains: string[]): Promise<ApifyRunMeta> {
  if (!domains.length) throw new Error("domains rỗng");
  const url = `${APIFY_BASE}/acts/${encodeURIComponent(actorId())}/runs?token=${token()}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domains }),
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
  const url = `${APIFY_BASE}/actor-runs/${encodeURIComponent(runId)}?token=${token()}`;
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
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const url = `${APIFY_BASE}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${PAGE}&offset=${offset}&token=${token()}`;
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
