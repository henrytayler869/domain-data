/**
 * Watchlist — domain "để xem xét mua sau" (chưa mua). Backed by Supabase
 * (table: domain_watchlist). Lưu snapshot rating/category/detail lúc thêm để review.
 */

import { supabase } from "./supabase";

const TABLE = "domain_watchlist";

export interface WatchlistEntry {
  domain: string;
  rating: string | null;
  category: string | null;
  detail: string | null;
  note: string | null;
  addedAt: string;
}

interface DbRow {
  domain: string;
  rating: string | null;
  category: string | null;
  detail: string | null;
  note: string | null;
  added_at: string;
}

const toEntry = (r: DbRow): WatchlistEntry => ({
  domain: r.domain, rating: r.rating, category: r.category, detail: r.detail, note: r.note, addedAt: r.added_at,
});

export async function readAll(): Promise<WatchlistEntry[]> {
  const sb = supabase();
  const { data, error } = await sb.from(TABLE).select("*").order("added_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as DbRow[]).map(toEntry);
}

export interface AddInput { domain: string; rating?: string | null; category?: string | null; detail?: string | null; note?: string | null }

export async function addMany(entries: AddInput[]): Promise<{ added: number; total: number }> {
  const sb = supabase();
  const rows = Array.from(
    new Map(entries.map((e) => [e.domain.toLowerCase().trim(), e])).values(),
  ).filter((e) => e.domain).map((e) => ({
    domain: e.domain.toLowerCase().trim(),
    rating: e.rating ?? null,
    category: e.category ?? null,
    detail: e.detail ?? null,
    note: e.note ?? null,
  }));
  if (!rows.length) return { added: 0, total: (await count()) };
  const { error } = await sb.from(TABLE).upsert(rows, { onConflict: "domain" });
  if (error) throw new Error(error.message);
  return { added: rows.length, total: await count() };
}

export async function remove(domains: string[]): Promise<{ removed: number }> {
  const sb = supabase();
  const targets = Array.from(new Set(domains.map((d) => d.toLowerCase().trim()).filter(Boolean)));
  if (!targets.length) return { removed: 0 };
  const { error, count: c } = await sb.from(TABLE).delete({ count: "exact" }).in("domain", targets);
  if (error) throw new Error(error.message);
  return { removed: c ?? 0 };
}

async function count(): Promise<number> {
  const sb = supabase();
  const { count: c } = await sb.from(TABLE).select("*", { count: "exact", head: true });
  return c ?? 0;
}
