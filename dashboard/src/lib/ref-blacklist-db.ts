/**
 * User-added Ref Domain Blacklist — extends the hardcoded REF_BLACKLIST.
 * Backed by Supabase (table: ref_blacklist).
 */

import { supabase } from "./supabase";

const TABLE = "ref_blacklist";

export interface RefBlacklistEntry {
  domain: string;
  note: string | null;
  addedAt: string;
}

interface DbRow {
  domain: string;
  note: string | null;
  added_at: string;
}

function rowToEntry(r: DbRow): RefBlacklistEntry {
  return { domain: r.domain, note: r.note, addedAt: r.added_at };
}

export async function readAll(): Promise<RefBlacklistEntry[]> {
  const sb = supabase();
  const all: DbRow[] = [];
  const PAGE = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .order("added_at", { ascending: false })
      .order("domain", { ascending: true }) // tiebreak theo khoá chính: ORDER BY phải duy nhất thì range() mới không sót/trùng dòng giữa các trang
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as DbRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all.map(rowToEntry);
}

export async function addEntries(domains: string[], note?: string): Promise<{ added: number; total: number }> {
  const sb = supabase();
  const cleaned = Array.from(
    new Set(
      domains
        .map((d) => d.toLowerCase().trim())
        .map((d) => d.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
        .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
    )
  );
  if (!cleaned.length) {
    const { count } = await sb.from(TABLE).select("*", { count: "exact", head: true });
    return { added: 0, total: count ?? 0 };
  }

  const { count: countBefore } = await sb.from(TABLE).select("*", { count: "exact", head: true });
  const before = countBefore ?? 0;

  const rows = cleaned.map((domain) => ({ domain, note: note || null }));
  const { error } = await sb.from(TABLE).upsert(rows, { onConflict: "domain" });
  if (error) throw new Error(error.message);

  const { count: countAfter } = await sb.from(TABLE).select("*", { count: "exact", head: true });
  const total = countAfter ?? 0;
  return { added: total - before, total };
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

export async function clearAll(): Promise<void> {
  const sb = supabase();
  const { error } = await sb.from(TABLE).delete().neq("domain", "");
  if (error) throw new Error(error.message);
}
