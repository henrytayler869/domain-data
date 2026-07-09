import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkDomainsMany, statusOf } from "@/lib/gname";
import { startWaybackRun, countActiveRuns } from "@/lib/apify-wayback";
import { createRun } from "@/lib/wayback-db";
import { markExcluded } from "@/lib/ahrefs-db";

/**
 * POST /api/inventory/api-errors/process-unchecked
 *
 * Domain "API error" CHƯA có Wayback: check Gname →
 *   • available / backorder (mua được) → gửi Wayback (KHÔNG gửi N8N/DFS)
 *   • registered / premium (không mua được) → LOẠI TRỪ (rời tab)
 *   • error (IP chưa whitelist / rate-limit) → giữ lại, thử sau
 * Bảng tự cập nhật cột Wayback khi run xong. Bounded 120 domain/lần (né timeout).
 */
const CHECK_CAP = 120;
const WB_BATCH = 50;
const WB_CAP = 30;

export async function POST() {
  try {
    const sb = supabase();

    // Ứng viên: API error, chưa loại trừ, CHƯA có wayback_results, chưa in-flight.
    const errRows: { target_domain: string }[] = [];
    {
      const PAGE = 1000; let from = 0;
      for (;;) {
        const { data, error } = await sb.from("target_assessment").select("target_domain").ilike("category", "%API%error%").is("excluded_at", null).range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        if (!data || !data.length) break;
        errRows.push(...(data as typeof errRows));
        if (data.length < PAGE) break;
        from += PAGE;
      }
    }
    const errDomains = errRows.map((r) => String(r.target_domain).toLowerCase());
    const wbDone = new Set<string>();
    for (let i = 0; i < errDomains.length; i += 300) {
      const { data } = await sb.from("wayback_results").select("target_domain").in("target_domain", errDomains.slice(i, i + 300));
      for (const r of (data ?? []) as { target_domain: string }[]) wbDone.add(String(r.target_domain).toLowerCase());
    }
    const inFlight = new Set<string>();
    {
      const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
      const { data } = await sb.from("wayback_runs").select("targets").gte("started_at", since);
      for (const r of (data ?? []) as { targets: string[] }[]) for (const t of (r.targets ?? [])) inFlight.add(String(t).toLowerCase());
    }
    const candidates = errDomains.filter((d) => !wbDone.has(d) && !inFlight.has(d));
    if (!candidates.length) return NextResponse.json({ ok: true, candidates: 0, checked: 0, available: 0, registered: 0, errored: 0, dispatched: 0, dispatchedDomains: 0, excluded: 0, remaining: 0 });

    const batch = candidates.slice(0, CHECK_CAP);

    // Gname check (C=1 an toàn rate-limit) → phân loại.
    const checks = await checkDomainsMany(batch, 1);
    const acquirable: string[] = [], registered: string[] = [];
    let errored = 0;
    for (const c of checks) {
      const s = statusOf(c);
      if (s === "available" || s === "backorder") acquirable.push(c.domain);
      else if (s === "registered" || s === "premium") registered.push(c.domain);
      else errored++;   // error → giữ, thử sau
    }

    // Acquirable → Wayback (≤30 concurrent). KHÔNG gửi N8N.
    const active = await countActiveRuns();
    const slots = Math.max(0, WB_CAP - active);
    const toDispatch = acquirable.slice(0, slots * WB_BATCH);
    let dispatched = 0, dispatchedDomains = 0;
    for (let i = 0; i < toDispatch.length; i += WB_BATCH) {
      const b = toDispatch.slice(i, i + WB_BATCH);
      try {
        const run = await startWaybackRun(b);
        await createRun(run.runId, b, run.status, run.datasetId);
        dispatched++; dispatchedDomains += b.length;
      } catch { break; }
    }

    // Registered/premium → loại trừ (không mua được → rời tab).
    let excluded = 0;
    if (registered.length) { const ex = await markExcluded(registered); excluded = ex.count; }

    return NextResponse.json({
      ok: true,
      candidates: candidates.length,
      checked: batch.length,
      available: acquirable.length,
      registered: registered.length,
      errored,
      dispatched,
      dispatchedDomains,
      excluded,
      remaining: candidates.length - batch.length,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
