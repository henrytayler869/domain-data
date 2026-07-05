/**
 * Ahrefs Result DB — kết quả check Ahrefs (target_domain × ref_domain × DR).
 * Backed by Supabase (table: ahrefs_results).
 */

import { supabase } from "./supabase";

const TABLE = "ahrefs_results";
const ASSESS_TABLE = "target_assessment";

export interface AhrefsResultRow {
  targetDomain: string;
  refDomain: string;
  domainRating: number;
  checkedAt: string;
}

export interface AssessmentRow {
  targetDomain: string;
  rating: string | null;
  category: string | null;
  detail: string | null;
  excludedAt: string | null;
  updatedAt: string;
}

interface AssessmentDbRow {
  target_domain: string;
  rating: string | null;
  category: string | null;
  detail: string | null;
  excluded_at: string | null;
  updated_at: string;
}

interface DbRow {
  target_domain: string;
  ref_domain: string;
  domain_rating: number;
  checked_at: string;
}

function rowToEntry(r: DbRow): AhrefsResultRow {
  return {
    targetDomain: r.target_domain,
    refDomain: r.ref_domain,
    domainRating: r.domain_rating,
    checkedAt: r.checked_at,
  };
}

export async function readAll(): Promise<AhrefsResultRow[]> {
  const sb = supabase();
  const all: DbRow[] = [];
  const PAGE = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .order("target_domain", { ascending: true })
      .order("domain_rating", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as DbRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all.map(rowToEntry);
}

export interface RefRef {
  domain: string;
  dr: number;
}

export interface TargetSummary {
  targetDomain: string;
  refsCount: number;
  maxDr: number;
  checkedAt: string;
  refs: RefRef[];
  rating: string | null;
  category: string | null;
  detail: string | null;
  /** True if target_assessment.excluded_at is set — bought by someone else or already in our inventory. */
  excluded: boolean;
}

async function readAllAssessments(): Promise<Map<string, AssessmentDbRow>> {
  const sb = supabase();
  const all: AssessmentDbRow[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from(ASSESS_TABLE)
      .select("*")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as AssessmentDbRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return new Map(all.map((r) => [r.target_domain, r]));
}

export async function readTargetSummary(): Promise<TargetSummary[]> {
  // Aggregate client-side from full read — table size expected to be modest (10s of thousands max)
  const [all, assessMap] = await Promise.all([readAll(), readAllAssessments()]);
  const map = new Map<string, TargetSummary>();
  const ensure = (targetDomain: string, checkedAt: string): TargetSummary => {
    let cur = map.get(targetDomain);
    if (!cur) {
      cur = {
        targetDomain,
        refsCount: 0,
        maxDr: 0,
        checkedAt,
        refs: [],
        rating: null,
        category: null,
        detail: null,
        excluded: false,
      };
      map.set(targetDomain, cur);
    }
    return cur;
  };
  for (const r of all) {
    const cur = ensure(r.targetDomain, r.checkedAt);
    cur.refsCount += 1;
    if (r.domainRating > cur.maxDr) cur.maxDr = r.domainRating;
    if (r.checkedAt > cur.checkedAt) cur.checkedAt = r.checkedAt;
    cur.refs.push({ domain: r.refDomain, dr: r.domainRating });
  }
  // Attach assessments — also surface targets that have NO ref rows but were
  // still processed: excluded targets, và DataforSEO-checked (0 ref khớp DR)
  // → để chúng vẫn hiện trong panel cho user review + Wayback + quyết định.
  for (const [domain, a] of assessMap.entries()) {
    if (!map.has(domain) && (a.excluded_at || a.detail === "DataforSEO checked")) {
      ensure(domain, a.updated_at);
    }
  }
  for (const [domain, summary] of map.entries()) {
    const a = assessMap.get(domain);
    if (a) {
      summary.rating = a.rating;
      summary.category = a.category;
      summary.detail = a.detail;
      summary.excluded = !!a.excluded_at;
    }
  }
  // Sort each target's refs by DR desc
  for (const s of map.values()) s.refs.sort((a, b) => b.dr - a.dr);
  return Array.from(map.values()).sort((a, b) => b.refsCount - a.refsCount);
}

/**
 * Như readTargetSummary nhưng CHỈ cho 1 danh sách target cụ thể — query lọc
 * `target_domain IN (...)` thay vì quét toàn bảng ahrefs_results (~chục nghìn
 * dòng). Dùng cho Kho Domain / tra cứu nhiều domain (chỉ cần vài trăm target).
 */
export async function readTargetSummaryFor(targetsRaw: string[]): Promise<TargetSummary[]> {
  const targets = Array.from(new Set(
    targetsRaw.map((t) => t.toLowerCase().trim()).filter(Boolean),
  ));
  if (!targets.length) return [];

  const sb = supabase();
  const CHUNK = 150; // tránh URL quá dài cho .in()
  const PAGE = 1000; // PostgREST trả tối đa 1000 dòng/request → phải phân trang
  const CONCURRENCY = 6; // chạy song song các chunk (trước đây tuần tự = chậm)

  const chunks: string[][] = [];
  for (let i = 0; i < targets.length; i += CHUNK) chunks.push(targets.slice(i, i + CHUNK));

  // Tải 1 chunk: ref rows (phân trang) + assessments.
  const fetchChunk = async (slice: string[]) => {
    const refRows: DbRow[] = [];
    // Ref rows: 1 chunk (150 target) có thể có HÀNG NGHÌN ref → phải phân trang,
    // nếu không sẽ bị cắt ở 1000 dòng và mất ref của các target cuối chunk.
    let offset = 0;
    while (true) {
      const { data, error } = await sb
        .from(TABLE)
        .select("*")
        .in("target_domain", slice)
        .order("target_domain", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      refRows.push(...(data as DbRow[]));
      if (data.length < PAGE) break;
      offset += PAGE;
    }
    // Assessments: tối đa 1/target → ≤150 dòng/chunk, không cần phân trang.
    const { data: aData, error: aErr } = await sb
      .from(ASSESS_TABLE).select("*").in("target_domain", slice);
    if (aErr) throw new Error(aErr.message);
    return { refRows, assessRows: (aData ?? []) as AssessmentDbRow[] };
  };

  // Pool concurrency có giới hạn — nhanh hơn tuần tự nhưng không mở quá nhiều
  // kết nối khi danh sách target rất lớn (bulk lookup).
  const refRows: DbRow[] = [];
  const assessRows: AssessmentDbRow[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < chunks.length) {
      const idx = cursor++;
      const { refRows: rr, assessRows: ar } = await fetchChunk(chunks[idx]);
      refRows.push(...rr);
      assessRows.push(...ar);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, () => worker()),
  );
  const assessMap = new Map(assessRows.map((r) => [r.target_domain, r]));

  const map = new Map<string, TargetSummary>();
  const ensure = (targetDomain: string, checkedAt: string): TargetSummary => {
    let cur = map.get(targetDomain);
    if (!cur) {
      cur = { targetDomain, refsCount: 0, maxDr: 0, checkedAt, refs: [], rating: null, category: null, detail: null, excluded: false };
      map.set(targetDomain, cur);
    }
    return cur;
  };
  for (const r of refRows) {
    const cur = ensure(r.target_domain, r.checked_at);
    cur.refsCount += 1;
    if (r.domain_rating > cur.maxDr) cur.maxDr = r.domain_rating;
    if (r.checked_at > cur.checkedAt) cur.checkedAt = r.checked_at;
    cur.refs.push({ domain: r.ref_domain, dr: r.domain_rating });
  }
  for (const [domain, a] of assessMap.entries()) {
    if (!map.has(domain) && (a.excluded_at || a.detail === "DataforSEO checked")) {
      ensure(domain, a.updated_at);
    }
  }
  for (const [domain, summary] of map.entries()) {
    const a = assessMap.get(domain);
    if (a) {
      summary.rating = a.rating;
      summary.category = a.category;
      summary.detail = a.detail;
      summary.excluded = !!a.excluded_at;
    }
  }
  for (const s of map.values()) s.refs.sort((a, b) => b.dr - a.dr);
  return Array.from(map.values()).sort((a, b) => b.refsCount - a.refsCount);
}

// ─── Assessment upsert ───────────────────────────────────────────────────────

export async function upsertAssessments(
  rows: Omit<AssessmentRow, "updatedAt">[]
): Promise<{ added: number; total: number }> {
  const sb = supabase();
  if (!rows.length) {
    const { count } = await sb.from(ASSESS_TABLE).select("*", { count: "exact", head: true });
    return { added: 0, total: count ?? 0 };
  }

  const { count: countBefore } = await sb.from(ASSESS_TABLE).select("*", { count: "exact", head: true });
  const before = countBefore ?? 0;

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH).map((r) => ({
      target_domain: r.targetDomain.toLowerCase().trim(),
      rating: r.rating?.trim() || null,
      category: r.category?.trim() || null,
      detail: r.detail?.trim() || null,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await sb.from(ASSESS_TABLE).upsert(slice, { onConflict: "target_domain" });
    if (error) throw new Error(error.message);
  }
  const { count: countAfter } = await sb.from(ASSESS_TABLE).select("*", { count: "exact", head: true });
  const total = countAfter ?? 0;
  return { added: total - before, total };
}

export async function listCheckedTargets(): Promise<string[]> {
  const sb = supabase();
  const all = new Set<string>();
  const PAGE = 1000;

  // 1) Every target with any Ahrefs ref row.
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from(TABLE)
      .select("target_domain")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data) all.add((r as { target_domain: string }).target_domain);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  // 2) Mọi target có assessment row đều coi là "đã check" — gồm: target bị
  //    loại trừ thủ công (excluded_at), target được rate qua Ahrefs, và target
  //    đã query DataforSEO (marker "DataforSEO checked", kể cả 0 ref khớp).
  //    NGOẠI LỆ: assessment category='API error' (check thất bại) mà KHÔNG có
  //    ref row thật → coi như CHƯA check, để filter bước 2 hiện lại cho re-run.
  const refTargets = new Set(all); // tại đây all mới chỉ chứa target có ref row
  offset = 0;
  while (true) {
    const { data, error } = await sb
      .from(ASSESS_TABLE)
      .select("target_domain,category,excluded_at")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data as { target_domain: string; category: string | null; excluded_at: string | null }[]) {
      const isApiError = (r.category ?? "").trim().toLowerCase() === "api error";
      // API-error + không có ref thật + chưa bị loại trừ thủ công → bỏ qua.
      if (isApiError && !refTargets.has(r.target_domain) && !r.excluded_at) continue;
      all.add(r.target_domain);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return Array.from(all);
}

/**
 * Như listCheckedTargets nhưng CHỈ kiểm tra trong 1 danh sách target cho trước
 * (vd domain vừa upload ở Picker). Quét `IN (chunk)` thay vì quét TOÀN BẢNG
 * ahrefs_results → nhanh hơn rất nhiều (chỉ chạm tới phần giao với list upload).
 */
export async function listCheckedAmong(targetsRaw: string[]): Promise<string[]> {
  const targets = Array.from(new Set(
    targetsRaw.map((t) => t.toLowerCase().trim()).filter(Boolean),
  ));
  if (!targets.length) return [];

  const sb = supabase();
  const CHUNK = 150;
  const PAGE = 1000;
  const CONCURRENCY = 6;

  const chunks: string[][] = [];
  for (let i = 0; i < targets.length; i += CHUNK) chunks.push(targets.slice(i, i + CHUNK));

  const fetchChunk = async (slice: string[]): Promise<string[]> => {
    // (a) Target có ref row — bị giới hạn trong slice nên thường nhỏ (chỉ phần
    //     đã check mới có ref). Vẫn phân trang phòng target nhiều ref.
    const refSet = new Set<string>();
    let offset = 0;
    while (true) {
      const { data, error } = await sb
        .from(TABLE).select("target_domain").in("target_domain", slice)
        .order("target_domain", { ascending: true }).range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      for (const r of data as { target_domain: string }[]) refSet.add(r.target_domain);
      if (data.length < PAGE) break;
      offset += PAGE;
    }
    // (b) Target có assessment hợp lệ (≤150 dòng/chunk). API-error không-ref
    //     chưa loại trừ thủ công → coi như CHƯA check.
    const { data: aData, error: aErr } = await sb
      .from(ASSESS_TABLE).select("target_domain,category,excluded_at").in("target_domain", slice);
    if (aErr) throw new Error(aErr.message);
    const out: string[] = Array.from(refSet);
    for (const r of (aData ?? []) as { target_domain: string; category: string | null; excluded_at: string | null }[]) {
      const isApiError = (r.category ?? "").trim().toLowerCase() === "api error";
      if (isApiError && !refSet.has(r.target_domain) && !r.excluded_at) continue;
      out.push(r.target_domain);
    }
    return out;
  };

  const checked = new Set<string>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < chunks.length) {
      const idx = cursor++;
      for (const d of await fetchChunk(chunks[idx])) checked.add(d);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, () => worker()));
  return Array.from(checked);
}

/**
 * Flag targets as manually excluded by setting target_assessment.excluded_at.
 * Used by the "Loại trừ" action and as a piggyback from "Đã mua" so purchased
 * domains stop appearing in the picker.
 */
/**
 * Đọc rating (Tốt/Trung bình/xấu) cho 1 danh sách domain — bounded IN query,
 * dùng cho Domain Picker Bước 6 (lọc domain đáng mua sau khi N8N/DataForSEO ghi rating).
 */
export async function readAssessmentsFor(
  domains: string[],
): Promise<{ domain: string; rating: string | null; category: string | null }[]> {
  const targets = Array.from(new Set(domains.map((d) => d.toLowerCase().trim()).filter(Boolean)));
  if (!targets.length) return [];
  const sb = supabase();
  const out: { domain: string; rating: string | null; category: string | null }[] = [];
  const CHUNK = 150;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const { data, error } = await sb
      .from(ASSESS_TABLE)
      .select("target_domain,rating,category")
      .in("target_domain", targets.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { target_domain: string; rating: string | null; category: string | null }[]) {
      out.push({ domain: r.target_domain, rating: r.rating, category: r.category });
    }
  }
  return out;
}

export async function markExcluded(targets: string[]): Promise<{ count: number }> {
  const sb = supabase();
  const normalized = Array.from(
    new Set(targets.map((t) => t.toLowerCase().trim()).filter(Boolean))
  );
  if (!normalized.length) return { count: 0 };

  const now = new Date().toISOString();
  const BATCH = 500;
  for (let i = 0; i < normalized.length; i += BATCH) {
    const slice = normalized.slice(i, i + BATCH).map((t) => ({
      target_domain: t,
      excluded_at: now,
      updated_at: now,
    }));
    const { error } = await sb
      .from(ASSESS_TABLE)
      .upsert(slice, { onConflict: "target_domain" });
    if (error) throw new Error(error.message);
  }
  return { count: normalized.length };
}

export async function clearAll(): Promise<void> {
  const sb = supabase();
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    sb.from(TABLE).delete().neq("target_domain", ""),
    sb.from(ASSESS_TABLE).delete().neq("target_domain", ""),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
}

export async function deleteTarget(targetDomain: string): Promise<number> {
  const sb = supabase();
  const target = targetDomain.toLowerCase().trim();
  const [{ error: e1, count }, { error: e2 }] = await Promise.all([
    sb.from(TABLE).delete({ count: "exact" }).eq("target_domain", target),
    sb.from(ASSESS_TABLE).delete().eq("target_domain", target),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  return count ?? 0;
}

export interface UpsertResult {
  added: number;
  updated: number;
  total: number;
  uniqueTargets: number;
}

export async function upsertRows(rows: Omit<AhrefsResultRow, "checkedAt">[]): Promise<UpsertResult> {
  const sb = supabase();
  if (!rows.length) {
    const { count } = await sb.from(TABLE).select("*", { count: "exact", head: true });
    return { added: 0, updated: 0, total: count ?? 0, uniqueTargets: 0 };
  }

  const { count: countBefore } = await sb.from(TABLE).select("*", { count: "exact", head: true });
  const before = countBefore ?? 0;

  const BATCH = 500;
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH).map((r) => ({
      target_domain: r.targetDomain.toLowerCase().trim(),
      ref_domain: r.refDomain.toLowerCase().trim(),
      domain_rating: Math.round(Number(r.domainRating) || 0),
      checked_at: now, // bump so re-uploads reset visibility for "Xóa hiện tại" hide-filter
    }));
    const { error } = await sb
      .from(TABLE)
      .upsert(slice, { onConflict: "target_domain,ref_domain" });
    if (error) throw new Error(error.message);
  }

  const { count: countAfter } = await sb.from(TABLE).select("*", { count: "exact", head: true });
  const total = countAfter ?? 0;
  const added = total - before;
  const uniqueTargets = new Set(rows.map((r) => r.targetDomain.toLowerCase().trim())).size;

  return {
    added,
    updated: rows.length - added,
    total,
    uniqueTargets,
  };
}
