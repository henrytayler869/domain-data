/**
 * Khôi phục Bước 6 từ DB — dùng khi 1 lần chạy pipeline bị gián đoạn (đóng tab /
 * reload) nhưng gate + Wayback đã xong: gom lại các domain "mua được + clean" gần
 * đây kèm rating (nếu N8N đã trả) để hiện lại ở Bước 6 mà không phải chạy lại.
 *
 * Ứng viên = domain CLEAN (wayback_results: snapshot>0, không betting/adult) VÀ
 * mua được (gname_checks: available/backorder) trong `hours` giờ qua, chưa mua
 * (domain_inventory) và chưa bị loại trừ (target_assessment.excluded_at).
 */

import { supabase } from "./supabase";

export interface ResumeCandidate {
  domain: string;
  gnameStatus: "available" | "backorder";
  dropEta: string | null;
  rating: string | null;
  category: string | null;
  detail: string | null;
}

const chunk = <T>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

export async function readResumeCandidates(hours = 12): Promise<ResumeCandidate[]> {
  const sb = supabase();
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  // 1) CLEAN gần đây từ wayback_results.
  const cleanDomains: string[] = [];
  {
    const PAGE = 1000;
    let offset = 0;
    for (;;) {
      const { data, error } = await sb
        .from("wayback_results")
        .select("target_domain,snapshot_count,has_betting,has_adult,checked_at")
        .gte("checked_at", cutoff)
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      for (const r of data as { target_domain: string; snapshot_count: number | null; has_betting: boolean | null; has_adult: boolean | null }[]) {
        if (!r.has_betting && !r.has_adult && (r.snapshot_count ?? 0) > 0) cleanDomains.push(String(r.target_domain).toLowerCase());
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }
  if (!cleanDomains.length) return [];
  const cleanSet = new Set(cleanDomains);

  // 2) Mua được (available/backorder) trong các domain clean.
  const acquirable = new Map<string, { status: "available" | "backorder"; dropEta: string | null }>();
  for (const slice of chunk([...cleanSet], 300)) {
    const { data, error } = await sb
      .from("gname_checks")
      .select("domain,status,drop_eta")
      .in("domain", slice)
      .in("status", ["available", "backorder"])
      .gte("checked_at", cutoff);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { domain: string; status: "available" | "backorder"; drop_eta: string | null }[]) {
      acquirable.set(r.domain, { status: r.status, dropEta: r.drop_eta });
    }
  }
  if (!acquirable.size) return [];
  const cand = [...acquirable.keys()];

  // 3) rating/category/detail + loại trừ, và 4) đã mua.
  const assess = new Map<string, { rating: string | null; category: string | null; detail: string | null; excluded: boolean }>();
  const owned = new Set<string>();
  await Promise.all([
    (async () => {
      for (const slice of chunk(cand, 300)) {
        const { data, error } = await sb
          .from("target_assessment")
          .select("target_domain,rating,category,detail,excluded_at")
          .in("target_domain", slice);
        if (error) throw new Error(error.message);
        for (const r of (data ?? []) as { target_domain: string; rating: string | null; category: string | null; detail: string | null; excluded_at: string | null }[]) {
          assess.set(String(r.target_domain).toLowerCase(), { rating: r.rating, category: r.category, detail: r.detail, excluded: !!r.excluded_at });
        }
      }
    })(),
    (async () => {
      for (const slice of chunk(cand, 300)) {
        const { data, error } = await sb.from("domain_inventory").select("domain").in("domain", slice);
        if (error) throw new Error(error.message);
        for (const r of (data ?? []) as { domain: string }[]) owned.add(String(r.domain).toLowerCase());
      }
    })(),
  ]);

  // CHỈ giữ domain đã rated TỐT/TRUNG BÌNH (mua được ngay) — tránh kéo vào cả domain
  // clean+available chưa từng gửi DFS (gây "đang chờ" ảo). Domain đang được rate sẽ
  // hiện dần khi rating về → bấm "Khôi phục từ DB" lại để refresh.
  const isGoodRating = (r: string | null) => !!r && (r.includes("TỐT") || r.includes("TRUNG BÌNH"));
  const out: ResumeCandidate[] = [];
  for (const [domain, aq] of acquirable) {
    if (owned.has(domain)) continue;
    const a = assess.get(domain);
    if (a?.excluded) continue;                    // đã bấm Loại trừ
    if (!isGoodRating(a?.rating ?? null)) continue;   // chỉ domain TỐT/TB
    out.push({ domain, gnameStatus: aq.status, dropEta: aq.dropEta, rating: a!.rating, category: a?.category ?? null, detail: a?.detail ?? null });
  }
  return out;
}
