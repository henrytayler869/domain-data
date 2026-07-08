/**
 * Cache kết quả check Gname từng domain (table: gname_checks). Lần chạy gate sau
 * bỏ qua domain đã check gần đây → giảm số call API + rate-limit. KHÔNG cache
 * status 'error' (tạm thời) để lần sau check lại.
 */

import { supabase } from "./supabase";
import type { GnameStatus } from "./gname";

const TABLE = "gname_checks";

export interface CachedCheck {
  domain: string;
  status: GnameStatus;
  dropEta: string | null;
  code: number | null;
  checkedAt: string;
}

interface DbRow {
  domain: string;
  status: GnameStatus;
  drop_eta: string | null;
  code: number | null;
  checked_at: string;
}

const norm = (domains: string[]): string[] =>
  Array.from(new Set(domains.map((d) => String(d ?? "").toLowerCase().trim()).filter(Boolean)));

/** Đọc cache CÒN HẠN (checked_at > now - ttlHours) cho danh sách domain. */
export async function readFreshChecks(domains: string[], ttlHours: number): Promise<Map<string, CachedCheck>> {
  const list = norm(domains);
  const map = new Map<string, CachedCheck>();
  if (!list.length) return map;
  const sb = supabase();
  const cutoff = new Date(Date.now() - ttlHours * 3600 * 1000).toISOString();
  const CHUNK = 300;
  for (let i = 0; i < list.length; i += CHUNK) {
    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .in("domain", list.slice(i, i + CHUNK))
      .gte("checked_at", cutoff);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as DbRow[]) {
      map.set(r.domain, { domain: r.domain, status: r.status, dropEta: r.drop_eta, code: r.code, checkedAt: r.checked_at });
    }
  }
  return map;
}

/** Ghi cache (bỏ qua status 'error' — tạm thời, không cache). */
export async function writeChecks(
  rows: { domain: string; status: GnameStatus; dropEta: string | null; code: number | null }[],
): Promise<void> {
  const keep = rows.filter((r) => r.status !== "error");
  if (!keep.length) return;
  const sb = supabase();
  const now = new Date().toISOString();
  const payload = keep.map((r) => ({ domain: r.domain.toLowerCase().trim(), status: r.status, drop_eta: r.dropEta, code: r.code, checked_at: now }));
  const BATCH = 500;
  for (let i = 0; i < payload.length; i += BATCH) {
    const { error } = await sb.from(TABLE).upsert(payload.slice(i, i + BATCH), { onConflict: "domain" });
    if (error) throw new Error(error.message);
  }
}
