/**
 * Picker DB — persistent storage for domains imported from CSV (SpamZilla / ExpiredDomains export).
 * Backed by Supabase (table: picker_domains).
 */

import { supabase } from "./supabase";

const TABLE = "picker_domains";

export interface PickerEntry {
  domain: string;
  source: string;
  tf: number;
  cf: number;
  bl: number;
  rd: number;
  da: number;
  pa: number;
  age: number;
  szScore: number;
  szDrops: number;
  semTraffic: number;
  semKeywords: number;
  price: string;
  expires: string;
  score: number;
  addedAt: string;
}

interface Row {
  domain: string;
  source: string | null;
  tf: number;
  cf: number;
  bl: number;
  rd: number;
  da: number;
  pa: number;
  age: number;
  sz_score: number;
  sz_drops: number;
  sem_traffic: number;
  sem_keywords: number;
  price: string | null;
  expires: string | null;
  score: number;
  added_at: string;
}

function rowToEntry(r: Row): PickerEntry {
  return {
    domain: r.domain,
    source: r.source ?? "",
    tf: r.tf,
    cf: r.cf,
    bl: r.bl,
    rd: r.rd,
    da: r.da,
    pa: r.pa,
    age: r.age,
    szScore: r.sz_score,
    szDrops: r.sz_drops,
    semTraffic: Number(r.sem_traffic),
    semKeywords: r.sem_keywords,
    price: r.price ?? "",
    expires: r.expires ?? "",
    score: Number(r.score),
    addedAt: r.added_at,
  };
}

function entryToRow(e: Omit<PickerEntry, "addedAt">): Omit<Row, "added_at"> {
  return {
    domain: e.domain,
    source: e.source || null,
    tf: Math.round(e.tf),
    cf: Math.round(e.cf),
    bl: Math.round(e.bl),
    rd: Math.round(e.rd),
    da: Math.round(e.da),
    pa: Math.round(e.pa),
    age: Math.round(e.age),
    sz_score: Math.round(e.szScore),
    sz_drops: Math.round(e.szDrops),
    sem_traffic: Math.round(e.semTraffic),
    sem_keywords: Math.round(e.semKeywords),
    price: e.price || null,
    expires: e.expires || null,
    score: e.score,
  };
}

export async function readDb(): Promise<PickerEntry[]> {
  const sb = supabase();
  const all: Row[] = [];
  const PAGE = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .order("score", { ascending: false })
      .order("domain", { ascending: true }) // tiebreak theo khoá chính: ORDER BY phải duy nhất thì range() mới không sót/trùng dòng giữa các trang
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as Row[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all.map(rowToEntry);
}

export async function clearDb(): Promise<void> {
  const sb = supabase();
  const { error } = await sb.from(TABLE).delete().neq("domain", "");
  if (error) throw new Error(error.message);
}

export interface UpsertResult {
  added: number;
  updated: number;
  total: number;
}

export async function upsertEntries(entries: Omit<PickerEntry, "addedAt">[]): Promise<UpsertResult> {
  const sb = supabase();
  if (!entries.length) return { added: 0, updated: 0, total: 0 };

  // Count BEFORE for added/updated diff (avoids huge .in() filter that hits URL length limits)
  const { count: countBefore } = await sb.from(TABLE).select("*", { count: "exact", head: true });
  const before = countBefore ?? 0;

  // Upsert in batches (PostgREST request body & URL constraints — 500/batch is safe)
  const BATCH = 500;
  for (let i = 0; i < entries.length; i += BATCH) {
    const slice = entries.slice(i, i + BATCH).map(entryToRow);
    const { error } = await sb.from(TABLE).upsert(slice, { onConflict: "domain" });
    if (error) throw new Error(error.message);
  }

  const { count: countAfter } = await sb.from(TABLE).select("*", { count: "exact", head: true });
  const total = countAfter ?? 0;
  const added = total - before;
  return {
    added,
    updated: entries.length - added,
    total,
  };
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
