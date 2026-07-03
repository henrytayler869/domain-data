/**
 * Expired Candidates — output của Expired Domain Pipeline (final_<date>.csv).
 * Backed by Supabase (table: expired_candidates). Xem supabase/expired_candidates.sql.
 */

import { supabase } from "./supabase";

const TABLE = "expired_candidates";

export type ExpiredStatus = "new" | "bought" | "excluded";

export interface ExpiredCandidate {
  domain: string;
  tld: string | null;
  dropDate: string | null;
  finalScore: number | null;
  wpLinks: number;
  ccRank: number | null;
  ccHarmonic: number | null;
  firstYear: number | null;
  crawlCount: number | null;
  dfsRank: number | null;
  referringDomains: number | null;
  backlinks: number | null;
  spamScore: number | null;
  length: number | null;
  hasHyphen: boolean;
  hasDigit: boolean;
  isDictWord: boolean;
  preScore: number | null;
  status: ExpiredStatus;
  importedAt: string;
}

interface DbRow {
  domain: string;
  tld: string | null;
  drop_date: string | null;
  final_score: number | null;
  wp_links: number | null;
  cc_rank: number | null;
  cc_harmonic: number | null;
  first_year: number | null;
  crawl_count: number | null;
  dfs_rank: number | null;
  referring_domains: number | null;
  backlinks: number | null;
  spam_score: number | null;
  length: number | null;
  has_hyphen: boolean | null;
  has_digit: boolean | null;
  is_dict_word: boolean | null;
  pre_score: number | null;
  status: string | null;
  imported_at: string;
}

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

function rowToEntry(r: DbRow): ExpiredCandidate {
  return {
    domain: r.domain,
    tld: r.tld,
    dropDate: r.drop_date,
    finalScore: num(r.final_score),
    wpLinks: num(r.wp_links) ?? 0,
    ccRank: num(r.cc_rank),
    ccHarmonic: num(r.cc_harmonic),
    firstYear: num(r.first_year),
    crawlCount: num(r.crawl_count),
    dfsRank: num(r.dfs_rank),
    referringDomains: num(r.referring_domains),
    backlinks: num(r.backlinks),
    spamScore: num(r.spam_score),
    length: num(r.length),
    hasHyphen: !!r.has_hyphen,
    hasDigit: !!r.has_digit,
    isDictWord: !!r.is_dict_word,
    preScore: num(r.pre_score),
    status: (r.status as ExpiredStatus) || "new",
    importedAt: r.imported_at,
  };
}

export async function readAll(): Promise<ExpiredCandidate[]> {
  const sb = supabase();
  const all: DbRow[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .order("final_score", { ascending: false, nullsFirst: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as DbRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all.map(rowToEntry);
}

export interface ImportRow {
  domain: string;
  tld?: string | null;
  drop_date?: string | null;
  final_score?: number | string | null;
  wp_links?: number | string | null;
  cc_rank?: number | string | null;
  cc_harmonic?: number | string | null;
  first_year?: number | string | null;
  crawl_count?: number | string | null;
  dfs_rank?: number | string | null;
  referring_domains?: number | string | null;
  backlinks?: number | string | null;
  spam_score?: number | string | null;
  length?: number | string | null;
  has_hyphen?: boolean | number | string | null;
  has_digit?: boolean | number | string | null;
  is_dict_word?: boolean | number | string | null;
  pre_score?: number | string | null;
}

const bool = (v: unknown): boolean =>
  v === true || v === 1 || v === "1" || v === "true" || v === "True";

/** Upsert (KHÔNG đụng status — giữ nguyên bought/excluded cho domain đã có). */
export async function upsertMany(rows: ImportRow[]): Promise<{ imported: number; total: number }> {
  const sb = supabase();
  const norm = rows
    .map((r) => ({
      domain: String(r.domain || "").toLowerCase().trim(),
      tld: r.tld ?? null,
      drop_date: r.drop_date ?? null,
      final_score: num(r.final_score),
      wp_links: num(r.wp_links) ?? 0,
      cc_rank: num(r.cc_rank),
      cc_harmonic: num(r.cc_harmonic),
      first_year: num(r.first_year),
      crawl_count: num(r.crawl_count),
      dfs_rank: num(r.dfs_rank),
      referring_domains: num(r.referring_domains),
      backlinks: num(r.backlinks),
      spam_score: num(r.spam_score),
      length: num(r.length),
      has_hyphen: bool(r.has_hyphen),
      has_digit: bool(r.has_digit),
      is_dict_word: bool(r.is_dict_word),
      pre_score: num(r.pre_score),
    }))
    .filter((r) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(r.domain));

  const BATCH = 500;
  for (let i = 0; i < norm.length; i += BATCH) {
    const { error } = await sb.from(TABLE).upsert(norm.slice(i, i + BATCH), { onConflict: "domain" });
    if (error) throw new Error(error.message);
  }
  const { count } = await sb.from(TABLE).select("*", { count: "exact", head: true });
  return { imported: norm.length, total: count ?? 0 };
}

export async function setStatus(domains: string[], status: ExpiredStatus): Promise<{ updated: number }> {
  const sb = supabase();
  const targets = Array.from(new Set(domains.map((d) => d.toLowerCase().trim()).filter(Boolean)));
  if (!targets.length) return { updated: 0 };
  const { error } = await sb.from(TABLE).update({ status }).in("domain", targets);
  if (error) throw new Error(error.message);
  return { updated: targets.length };
}
