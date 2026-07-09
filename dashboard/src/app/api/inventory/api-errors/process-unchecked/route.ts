import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkDomainsMany, statusOf } from "@/lib/gname";
import { startWaybackRun, countActiveRuns } from "@/lib/apify-wayback";
import { createRun } from "@/lib/wayback-db";

/**
 * POST /api/inventory/api-errors/process-unchecked
 *
 * Cho các domain "API error" CHƯA có Wayback result: check Gname → domain nào
 * AVAILABLE thì gửi qua Wayback (KHÔNG gửi N8N/DFS). Bảng Check Lỗi tự cập nhật
 * cột Wayback khi run xong (qua tick sweep / tải lại).
 *
 * Bounded mỗi lần (CAP domain) để không quá proxy timeout — trả `remaining` để
 * client bấm lại xử lý tiếp. Domain đã gửi Wayback (in-flight) tự loại lần sau.
 */
const CHECK_CAP = 120;   // Gname C=1 ~7 req/s → ≤120 domain/lần cho an toàn timeout
const WB_BATCH = 50;
const WB_CAP = 30;       // ≤30 concurrent (Apify limit 32)

export async function POST() {
  try {
    const sb = supabase();

    // 1) Ứng viên: category API error, chưa loại trừ, CHƯA có wayback_results,
    //    và chưa nằm trong run Wayback gần đây (in-flight).
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
    const errDomains = new Set(errRows.map((r) => String(r.target_domain).toLowerCase()));

    // đã có wayback_results?
    const wbDone = new Set<string>();
    {
      const list = [...errDomains];
      for (let i = 0; i < list.length; i += 300) {
        const { data } = await sb.from("wayback_results").select("target_domain").in("target_domain", list.slice(i, i + 300));
        for (const r of (data ?? []) as { target_domain: string }[]) wbDone.add(String(r.target_domain).toLowerCase());
      }
    }
    // in-flight (run Wayback 3h qua)
    const inFlight = new Set<string>();
    {
      const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
      const { data } = await sb.from("wayback_runs").select("targets").gte("started_at", since);
      for (const r of (data ?? []) as { targets: string[] }[]) for (const t of (r.targets ?? [])) inFlight.add(String(t).toLowerCase());
    }

    const candidates = [...errDomains].filter((d) => !wbDone.has(d) && !inFlight.has(d));
    if (!candidates.length) return NextResponse.json({ ok: true, candidates: 0, checked: 0, available: 0, dispatched: 0, dispatchedDomains: 0, remaining: 0 });

    const batch = candidates.slice(0, CHECK_CAP);

    // 2) Gname check (C=1 — an toàn rate-limit) → available.
    const checks = await checkDomainsMany(batch, 1);
    const available = checks.filter((c) => statusOf(c) === "available").map((c) => c.domain);

    // 3) Available → Wayback (respect 32 concurrent). KHÔNG gửi N8N.
    const active = await countActiveRuns();
    const slots = Math.max(0, WB_CAP - active);
    const toDispatch = available.slice(0, slots * WB_BATCH);
    let dispatched = 0, dispatchedDomains = 0;
    for (let i = 0; i < toDispatch.length; i += WB_BATCH) {
      const b = toDispatch.slice(i, i + WB_BATCH);
      try {
        const run = await startWaybackRun(b);
        await createRun(run.runId, b, run.status, run.datasetId);
        dispatched++; dispatchedDomains += b.length;
      } catch { break; }   // đụng limit → dừng, lần sau tiếp
    }

    return NextResponse.json({
      ok: true,
      candidates: candidates.length,
      checked: batch.length,
      available: available.length,
      dispatched,
      dispatchedDomains,
      remaining: candidates.length - batch.length,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
