/**
 * Backlink DB — persistent storage for curated Domain→DR reference data.
 * Backed by Supabase (table: backlink_db).
 */

import { supabase } from "./supabase";

const TABLE = "backlink_db";

export interface DbEntry {
  domain: string;
  dr: number;
  traffic?: number | null;
}

export async function readDb(): Promise<DbEntry[]> {
  const sb = supabase();
  const all: DbEntry[] = [];
  const PAGE = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await sb
      .from(TABLE)
      .select("domain,dr")
      .order("dr", { ascending: false })
      .order("domain", { ascending: true }) // tiebreak theo khoá chính: ORDER BY phải duy nhất thì range() mới không sót/trùng dòng giữa các trang
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as DbEntry[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// Chỉ trả ref domain CÓ traffic (đang điền cho DR 70-89) — dùng cho điều kiện 2
// của Domain Picker. Payload nhỏ (vài trăm dòng).
export async function readTrafficMap(): Promise<{ domain: string; traffic: number }[]> {
  const sb = supabase();
  const all: { domain: string; traffic: number }[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from(TABLE)
      .select("domain,traffic")
      .not("traffic", "is", null)
      .order("domain", { ascending: true }) // ORDER BY theo khoá chính: không có thì range() sót/trùng dòng giữa các trang
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data as { domain: string; traffic: number | null }[]) {
      all.push({ domain: r.domain, traffic: Number(r.traffic) || 0 });
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

export async function writeDb(entries: DbEntry[]): Promise<void> {
  const sb = supabase();

  // Strategy: clear + bulk insert (simple, atomic from caller's POV).
  // For incremental upsert, use upsertEntries below.
  const { error: delErr } = await sb.from(TABLE).delete().neq("domain", "");
  if (delErr) throw new Error(delErr.message);

  if (!entries.length) return;

  const BATCH = 500;
  for (let i = 0; i < entries.length; i += BATCH) {
    const slice = entries.slice(i, i + BATCH).map((e) => ({
      domain: e.domain.toLowerCase().trim(),
      dr: Number(e.dr) || 0,
    }));
    const { error } = await sb.from(TABLE).insert(slice);
    if (error) throw new Error(error.message);
  }
}

export async function upsertEntries(entries: DbEntry[]): Promise<{ added: number; total: number }> {
  const sb = supabase();
  if (!entries.length) {
    const { count } = await sb.from(TABLE).select("*", { count: "exact", head: true });
    return { added: 0, total: count ?? 0 };
  }

  const { count: countBefore } = await sb.from(TABLE).select("*", { count: "exact", head: true });
  const before = countBefore ?? 0;

  const BATCH = 500;
  for (let i = 0; i < entries.length; i += BATCH) {
    const slice = entries.slice(i, i + BATCH).map((e) => {
      const row: { domain: string; dr: number; traffic?: number } = {
        domain: e.domain.toLowerCase().trim(),
        dr: Number(e.dr) || 0,
      };
      // Chỉ set traffic khi có giá trị → không ghi đè traffic cũ bằng null.
      if (e.traffic != null && Number.isFinite(Number(e.traffic))) row.traffic = Number(e.traffic);
      return row;
    });
    const { error } = await sb.from(TABLE).upsert(slice, { onConflict: "domain" });
    if (error) throw new Error(error.message);
  }

  const { count: countAfter } = await sb.from(TABLE).select("*", { count: "exact", head: true });
  const total = countAfter ?? 0;
  return { added: total - before, total };
}

/**
 * Bổ sung ref (DR lấy từ Ahrefs) vào backlink_db: domain chưa có → thêm; đã có → chỉ
 * NÂNG DR khi giá trị mới cao hơn (không bao giờ hạ). Không đụng traffic. Trả số dòng ghi.
 */
export async function mergeRefsKeepMax(entries: { domain: string; dr: number }[]): Promise<number> {
  const best = new Map<string, number>();
  for (const e of entries) {
    const d = e.domain.toLowerCase().trim();
    const dr = Math.round(Number(e.dr) || 0);
    if (d && dr > (best.get(d) ?? -1)) best.set(d, dr);
  }
  if (!best.size) return 0;
  const sb = supabase();
  const { data, error } = await sb.from(TABLE).select("domain,dr").in("domain", [...best.keys()]);
  if (error) throw new Error(error.message);
  const existing = new Map(((data ?? []) as { domain: string; dr: number }[]).map((r) => [r.domain, r.dr]));
  const rows = [...best].filter(([d, dr]) => dr > (existing.get(d) ?? -1)).map(([domain, dr]) => ({ domain, dr }));
  if (!rows.length) return 0;
  const { error: upErr } = await sb.from(TABLE).upsert(rows, { onConflict: "domain" });
  if (upErr) throw new Error(upErr.message);
  return rows.length;
}

export async function deleteEntry(domain: string): Promise<number> {
  const sb = supabase();
  const target = domain.toLowerCase().trim();
  const { error, count } = await sb
    .from(TABLE)
    .delete({ count: "exact" })
    .eq("domain", target);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
