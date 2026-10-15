/**
 * Credit Apify + DataforSEO cho các card trên đầu Domain Picker.
 *
 * Cache 15' trong app_settings (key="partner_credits") — dùng chung mọi tab/người xem,
 * nên dù mở nhiều tab thì mỗi partner cũng chỉ bị gọi tối đa 1 lần / 15'.
 *
 * AI (Claude/OpenAI) không có card: cả 2 đều không có API trả số dư — hết credit thì
 * thanh cảnh báo đỏ (PipelineAlert) đã báo.
 */

import { createHash } from "node:crypto";
import { supabase } from "./supabase";
import { readApifyConfig, readSettings, type ApifyConfig } from "./settings";

const TABLE = "app_settings";
const KEY = "partner_credits";
export const CREDITS_TTL_MS = 15 * 60 * 1000;

export interface ApifyCredit {
  label: string;
  active: boolean;
  usageUsd: number | null;
  limitUsd: number | null;
  error: string | null;
}

export interface PartnerCredits {
  fetchedAt: string;
  credsHash?: string;   // dấu vân tay các key lúc lấy số — đổi key trong Settings → cache hết hạn ngay
  apify: { ok: boolean; accounts: ApifyCredit[]; error: string | null };
  dataforseo: { ok: boolean; balanceUsd: number | null; error: string | null };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function fetchApify(cfg: ApifyConfig): Promise<PartnerCredits["apify"]> {
  try {
    if (!cfg.accounts.length) return { ok: false, accounts: [], error: "Chưa cấu hình tài khoản Apify" };
    const accounts = await Promise.all(cfg.accounts.map(async (a): Promise<ApifyCredit> => {
      const base = { label: a.label, active: a.id === cfg.activeId, usageUsd: null, limitUsd: null };
      try {
        const r = await fetch(`https://api.apify.com/v2/users/me/limits?token=${a.token}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!r.ok) return { ...base, error: r.status === 401 || r.status === 403 ? "Token không hợp lệ" : `HTTP ${r.status}` };
        const L = (await r.json())?.data ?? {};
        return {
          ...base,
          usageUsd: L.current?.monthlyUsageUsd ?? L.currentUsageCycle?.usageUsd ?? null,
          limitUsd: L.limits?.maxMonthlyUsageUsd ?? null,
          error: null,
        };
      } catch (e) {
        return { ...base, error: errMsg(e) };
      }
    }));
    return { ok: accounts.some((a) => !a.error), accounts, error: null };
  } catch (e) {
    return { ok: false, accounts: [], error: errMsg(e) };
  }
}

async function fetchDataforseo(login: string, password: string): Promise<PartnerCredits["dataforseo"]> {
  if (!login || !password) return { ok: false, balanceUsd: null, error: "Chưa cấu hình DataforSEO" };
  try {
    const auth = Buffer.from(`${login}:${password}`).toString("base64");
    const r = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.status_code !== 20000) return { ok: false, balanceUsd: null, error: data.status_message ?? `HTTP ${r.status}` };
    const u = data.tasks?.[0]?.result?.[0] ?? {};
    return { ok: true, balanceUsd: u.money?.balance ?? u.money_balance ?? null, error: null };
  } catch (e) {
    return { ok: false, balanceUsd: null, error: errMsg(e) };
  }
}

async function readCache(): Promise<PartnerCredits | null> {
  try {
    const { data } = await supabase().from(TABLE).select("value").eq("key", KEY).maybeSingle();
    return (data?.value ?? null) as PartnerCredits | null;
  } catch {
    return null;
  }
}

/** Trả cache nếu còn trong 15' (trừ khi force) — hết hạn thì gọi lại các partner và lưu. */
export async function getPartnerCredits(force = false): Promise<PartnerCredits> {
  const [cached, s, apifyCfg] = await Promise.all([readCache(), readSettings(), readApifyConfig()]);
  const credsHash = createHash("sha256")
    .update(JSON.stringify([s.dataforseoLogin, s.dataforseoPassword, apifyCfg.activeId, apifyCfg.accounts.map((a) => a.token)]))
    .digest("hex");
  // Cache còn hạn khi: chưa quá 15' và cùng bộ key (đổi key trong Settings → lấy lại ngay).
  if (!force && cached && cached.credsHash === credsHash && Date.now() - new Date(cached.fetchedAt).getTime() < CREDITS_TTL_MS) return cached;

  const [apify, dataforseo] = await Promise.all([
    fetchApify(apifyCfg),
    fetchDataforseo(s.dataforseoLogin, s.dataforseoPassword),
  ]);
  const fresh: PartnerCredits = { fetchedAt: new Date().toISOString(), credsHash, apify, dataforseo };
  try {
    await supabase().from(TABLE).upsert({ key: KEY, value: fresh, updated_at: fresh.fetchedAt }, { onConflict: "key" });
  } catch { /* không lưu được cache — vẫn trả số mới */ }
  return fresh;
}
