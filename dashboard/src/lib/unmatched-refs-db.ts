/**
 * Unmatched Ref Domains — ref domain mà DataForSEO tìm thấy nhưng CHƯA có trong
 * backlink_db (chưa biết DR). Lưu lại để sau này check DR (Ahrefs) rồi bổ sung
 * vào backlink_db. Backed by Supabase (table: unmatched_refs).
 *
 * Đã loại ref blacklist trước khi gọi (xem /api/n8n/backlink-compare).
 */

import { supabase } from "./supabase";

const TABLE = "unmatched_refs";

export interface UnmatchedRef {
  domain: string;
  seenCount: number;
  firstSeen: string;
  lastSeen: string;
}

interface DbRow {
  domain: string;
  seen_count: number;
  first_seen: string;
  last_seen: string;
}

const clean = (domains: string[]): string[] =>
  Array.from(new Set(
    domains
      .map((d) => String(d ?? "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
      .filter((d) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d)),
  ));

/**
 * Upsert danh sách unmatched ref: có thì +1 seen_count + cập nhật last_seen,
 * chưa có thì thêm mới (first_seen = now). Chạy theo mẻ nhỏ (mỗi target 1 lần).
 */
export async function upsertUnmatchedRefs(domains: string[]): Promise<{ added: number; touched: number }> {
  const list = clean(domains);
  if (!list.length) return { added: 0, touched: 0 };
  const sb = supabase();

  const existing = new Map<string, number>();
  const CHUNK = 200;
  for (let i = 0; i < list.length; i += CHUNK) {
    const slice = list.slice(i, i + CHUNK);
    const { data, error } = await sb.from(TABLE).select("domain,seen_count").in("domain", slice);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { domain: string; seen_count: number }[]) existing.set(r.domain, r.seen_count);
  }

  const now = new Date().toISOString();
  const rows = list.map((domain) => ({ domain, seen_count: (existing.get(domain) ?? 0) + 1, last_seen: now }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    // first_seen KHÔNG có trong row → insert dùng default now(), conflict giữ nguyên.
    const { error } = await sb.from(TABLE).upsert(rows.slice(i, i + CHUNK), { onConflict: "domain" });
    if (error) throw new Error(error.message);
  }
  return { added: list.filter((d) => !existing.has(d)).length, touched: list.length };
}

/** Đọc toàn bộ unmatched ref (mới gặp nhiều nhất trước). */
export async function readUnmatchedRefs(): Promise<UnmatchedRef[]> {
  const sb = supabase();
  const all: DbRow[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .order("seen_count", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as DbRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all.map((r) => ({ domain: r.domain, seenCount: r.seen_count, firstSeen: r.first_seen, lastSeen: r.last_seen }));
}

/** Xoá khỏi unmatched (khi đã check DR + thêm vào backlink_db). */
export async function deleteUnmatchedRefs(domains: string[]): Promise<{ deleted: number }> {
  const list = clean(domains);
  if (!list.length) return { deleted: 0 };
  const sb = supabase();
  const BATCH = 500;
  for (let i = 0; i < list.length; i += BATCH) {
    const { error } = await sb.from(TABLE).delete().in("domain", list.slice(i, i + BATCH));
    if (error) throw new Error(error.message);
  }
  return { deleted: list.length };
}
