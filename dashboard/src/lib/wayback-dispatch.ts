/**
 * Một "tick" của drip-feed Wayback — gọi định kỳ (vd N8N Schedule mỗi 20-30 phút)
 * để xử lý dần hàng nghìn domain dưới giới hạn 32 concurrent run của Apify, KHÔNG
 * cần tab mở. Mỗi tick:
 *   1. SWEEP: poll+ingest mọi run pending (thu kết quả run đã xong → nhả slot Apify).
 *   2. DFS:   gửi domain clean+mua-được CHƯA rating qua N8N (đánh dấu placeholder để
 *             tick sau không gửi lại).
 *   3. DISPATCH: tạo thêm Wayback run cho domain available(≤$26) CHƯA check, lấp đầy
 *             tới CAP (30) slot còn trống.
 */

import { supabase } from "./supabase";
import { readGnamePricing } from "./gname-pricing";
import { listPendingRuns, createRun } from "./wayback-db";
import { pollAndIngestRun } from "./wayback-poll";
import { startWaybackRun, countActiveRuns } from "./apify-wayback";
import { upsertAssessments } from "./ahrefs-db";
import { readSettings } from "./settings";

const CAP = 30;                 // giữ ≤30 concurrent (limit Apify = 32, chừa margin)
const BATCH = 50;               // domain / run
const MAX_PRICE = 26;
const AVAIL_WINDOW_H = 24;      // available cache còn hạn
const DFS_BATCH = 140;          // domain / lần gửi N8N
const DISPATCH_CAP_DOMAINS = 40 * BATCH;  // trần domain dispatch mỗi tick (an toàn)

const tldOf = (d: string) => d.split(".").pop() ?? "";

// Phân trang 1 query PostgREST (query đã build sẵn bởi caller) — PostgREST trả tối đa 1000 dòng.
async function pageAll<T>(build: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> }): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data as T[] | null) ?? [];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export interface DispatchSummary {
  ingestedRuns: number;
  ingestedResults: number;
  dfsSent: number;
  dispatched: number;         // số run mới tạo
  dispatchedDomains: number;
  remainingToWayback: number;
  activeAfter: number;
}

export async function dispatchTick(): Promise<DispatchSummary> {
  const sb = supabase();

  // ── 1. SWEEP ────────────────────────────────────────────────────────────────
  const pending = await listPendingRuns();
  let ingestedRuns = 0, ingestedResults = 0;
  {
    let cursor = 0;
    const CONC = 5;
    const worker = async () => {
      while (cursor < pending.length) {
        const r = pending[cursor++];
        try { const res = await pollAndIngestRun(r.runId); if (res.ingested) { ingestedRuns++; ingestedResults += res.ingested.count; } } catch { /* ignore */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, pending.length || 1) }, () => worker()));
  }

  // ── Dữ liệu dùng chung ───────────────────────────────────────────────────────
  const pricingRows = await readGnamePricing();
  const price: Record<string, number | null> = {};
  for (const p of pricingRows) price[String(p.tld).toLowerCase()] = p.register;
  const availCutoff = new Date(Date.now() - AVAIL_WINDOW_H * 3600 * 1000).toISOString();

  const gnameRows = await pageAll<{ domain: string; status: string; drop_eta: string | null }>(
    () => sb.from("gname_checks").select("domain,status,drop_eta").in("status", ["available", "backorder"]).gte("checked_at", availCutoff),
  );
  const acquirable = new Map<string, { status: string; dropEta: string | null }>();
  for (const r of gnameRows) acquirable.set(String(r.domain).toLowerCase(), { status: r.status, dropEta: r.drop_eta });

  const wbRows = await pageAll<{ target_domain: string; snapshot_count: number | null; has_betting: boolean | null; has_adult: boolean | null }>(
    () => sb.from("wayback_results").select("target_domain,snapshot_count,has_betting,has_adult"),
  );
  const checked = new Set<string>();
  const clean = new Set<string>();
  for (const r of wbRows) {
    const d = String(r.target_domain).toLowerCase();
    checked.add(d);
    if (!r.has_betting && !r.has_adult && (r.snapshot_count ?? 0) > 0) clean.add(d);
  }

  // ── 2. DFS: clean + mua được + CHƯA có assessment (chưa gửi/chưa rating) ──────
  const cleanAcquirable = [...clean].filter((d) => acquirable.has(d));
  const assessed = new Set<string>();
  for (let i = 0; i < cleanAcquirable.length; i += 300) {
    const slice = cleanAcquirable.slice(i, i + 300);
    const { data } = await sb.from("target_assessment").select("target_domain").in("target_domain", slice);
    for (const r of (data ?? []) as { target_domain: string }[]) assessed.add(String(r.target_domain).toLowerCase());
  }
  const toDfs = cleanAcquirable.filter((d) => !assessed.has(d));
  let dfsSent = 0;
  if (toDfs.length) {
    const { n8nWebhookUrl } = await readSettings();
    if (n8nWebhookUrl) {
      for (let i = 0; i < toDfs.length; i += DFS_BATCH) {
        const batch = toDfs.slice(i, i + DFS_BATCH);
        try {
          const res = await fetch(n8nWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domains: batch, source: "wayback-dispatch", ts: new Date().toISOString() }),
            signal: AbortSignal.timeout(20_000),
          });
          if (res.ok) {
            // placeholder (rating=null) → tick sau không gửi lại; ingest-rating ghi đè khi N8N trả.
            await upsertAssessments(batch.map((d) => ({ targetDomain: d, rating: null, category: null, detail: "DFS pending", excludedAt: null })));
            dfsSent += batch.length;
          }
        } catch { /* ignore batch */ }
      }
    }
  }

  // ── 3. DISPATCH Wayback cho available(≤$26) CHƯA check & chưa in-flight ───────
  const inFlight = new Set<string>();
  for (const r of pending) for (const t of r.targets) inFlight.add(String(t).toLowerCase());
  const toWayback = [...acquirable.keys()].filter((d) => {
    if (acquirable.get(d)!.status !== "available") return false;
    if (checked.has(d) || inFlight.has(d)) return false;
    const p = price[tldOf(d)];
    return p != null && Number(p) <= MAX_PRICE;
  });

  const active = await countActiveRuns();
  const maxDomains = Math.min(Math.max(0, CAP - active) * BATCH, DISPATCH_CAP_DOMAINS);
  const dispatchList = toWayback.slice(0, maxDomains);
  let dispatched = 0, dispatchedDomains = 0;
  for (let i = 0; i < dispatchList.length; i += BATCH) {
    const batch = dispatchList.slice(i, i + BATCH);
    try {
      const run = await startWaybackRun(batch);
      await createRun(run.runId, batch, run.status, run.datasetId);
      dispatched++; dispatchedDomains += batch.length;
    } catch { break; }   // đụng limit / lỗi → dừng, để tick sau
  }

  return {
    ingestedRuns, ingestedResults, dfsSent,
    dispatched, dispatchedDomains,
    remainingToWayback: toWayback.length - dispatchedDomains,
    activeAfter: active + dispatched,
  };
}
