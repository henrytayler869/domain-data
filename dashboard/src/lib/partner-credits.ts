/**
 * Credit 3 partner (Apify, Claude API, DataforSEO) cho 3 card trên đầu Domain Picker.
 *
 * Cache 15' trong app_settings (key="partner_credits") — dùng chung mọi tab/người xem,
 * nên dù mở nhiều tab thì mỗi partner cũng chỉ bị gọi tối đa 1 lần / 15'.
 *
 * AI: Wayback actor chạy OpenAI là chính, Claude dự phòng → card hiện provider ĐANG CHẠY
 * (Claude nếu còn dùng được, không thì OpenAI). Cả Anthropic lẫn OpenAI đều KHÔNG có API
 * trả số dư → chỉ biết còn/hết credit qua 1 lệnh thử max_tokens=1 (chi phí ~0).
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

export type AiProvider = "claude" | "openai";
export interface AiStatus { ok: boolean; status: "ok" | "no_credit" | "invalid_key" | "not_configured" | "error"; error: string | null }

/** Số dư OpenAI ước tính = số dư user nhập − chi phí từ lúc nhập (Admin API /organization/costs). */
export interface OpenaiBalance {
  balanceUsd: number | null;   // null = chưa nhập số dư (vẫn có spentUsd nếu có admin key)
  spentUsd: number | null;     // chi phí từ mốc (hoặc từ đầu tháng nếu chưa có mốc)
  since: string | null;        // ISO — mốc tính chi phí
  error: string | null;
}

export interface PartnerCredits {
  fetchedAt: string;
  credsHash?: string;   // dấu vân tay các key lúc lấy số — đổi key trong Settings → cache hết hạn ngay
  apify: { ok: boolean; accounts: ApifyCredit[]; error: string | null };
  ai: { active: AiProvider | null; claude: AiStatus; openai: AiStatus; openaiBalance: OpenaiBalance | null };
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

async function fetchClaude(apiKey: string): Promise<AiStatus> {
  if (!apiKey) return { ok: false, status: "not_configured", error: "Chưa có Anthropic API key" };
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      // Cùng model với rating-engine — probe 1 token, chi phí không đáng kể.
      body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (r.ok) return { ok: true, status: "ok", error: null };
    const body = await r.json().catch(() => ({}));
    const msg: string = body?.error?.message ?? `HTTP ${r.status}`;
    if (r.status === 401 || r.status === 403) return { ok: false, status: "invalid_key", error: msg };
    if (/credit balance/i.test(msg)) return { ok: false, status: "no_credit", error: msg };
    return { ok: false, status: "error", error: msg };
  } catch (e) {
    return { ok: false, status: "error", error: errMsg(e) };
  }
}

async function fetchOpenai(apiKey: string): Promise<AiStatus> {
  if (!apiKey) return { ok: false, status: "not_configured", error: "Chưa có OpenAI API key" };
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      // Cùng model với Wayback actor — probe 1 token.
      body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (r.ok) return { ok: true, status: "ok", error: null };
    const body = await r.json().catch(() => ({}));
    const msg: string = body?.error?.message ?? `HTTP ${r.status}`;
    if (body?.error?.code === "insufficient_quota") return { ok: false, status: "no_credit", error: msg };
    if (r.status === 401 || r.status === 403) return { ok: false, status: "invalid_key", error: msg };
    return { ok: false, status: "error", error: msg };
  } catch (e) {
    return { ok: false, status: "error", error: errMsg(e) };
  }
}

/** Tổng chi phí OpenAI (USD) từ startSec đến nay. Bucket theo ngày UTC → tính cả ngày của mốc (ước tính dư, an toàn). */
async function openaiSpentSince(adminKey: string, startSec: number): Promise<number> {
  let total = 0;
  let page: string | null = null;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ start_time: String(startSec), bucket_width: "1d", limit: "180" });
    if (page) q.set("page", page);
    const r = await fetch(`https://api.openai.com/v1/organization/costs?${q}`, {
      headers: { Authorization: `Bearer ${adminKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body?.error?.message ?? `HTTP ${r.status}`);
    for (const b of body.data ?? []) for (const x of b.results ?? []) total += Number(x?.amount?.value) || 0;
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return total;
}

async function fetchOpenaiBalance(adminKey: string, baselineUsd: string, baselineAt: string): Promise<OpenaiBalance | null> {
  if (!adminKey) return null;
  const baseline = Number(baselineUsd);
  const hasBaseline = baselineUsd.trim() !== "" && Number.isFinite(baseline) && !!baselineAt;
  const now = new Date();
  // Có mốc → đầu ngày UTC của mốc; chưa có → đầu tháng UTC (hiện "đã tiêu tháng này").
  const from = hasBaseline ? new Date(baselineAt) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startSec = Math.floor(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()) / 1000);
  try {
    const spent = await openaiSpentSince(adminKey, startSec);
    return { balanceUsd: hasBaseline ? baseline - spent : null, spentUsd: spent, since: from.toISOString(), error: null };
  } catch (e) {
    return { balanceUsd: null, spentUsd: null, since: from.toISOString(), error: errMsg(e) };
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

/** Trả cache nếu còn trong 15' (trừ khi force) — hết hạn thì gọi lại 3 partner và lưu. */
export async function getPartnerCredits(force = false): Promise<PartnerCredits> {
  const [cached, s, apifyCfg] = await Promise.all([readCache(), readSettings(), readApifyConfig()]);
  const credsHash = createHash("sha256")
    .update(JSON.stringify([s.anthropicApiKey, s.openaiApiKey, s.openaiAdminKey, s.openaiBaselineUsd, s.openaiBaselineAt, s.dataforseoLogin, s.dataforseoPassword, apifyCfg.activeId, apifyCfg.accounts.map((a) => a.token)]))
    .digest("hex");
  // Cache còn hạn khi: chưa quá 15', cùng bộ key, và đã có field ai (bản cũ trước khi có OpenAI thì không).
  if (!force && cached?.ai && cached.credsHash === credsHash && Date.now() - new Date(cached.fetchedAt).getTime() < CREDITS_TTL_MS) return cached;

  const [apify, claude, openai, openaiBalance, dataforseo] = await Promise.all([
    fetchApify(apifyCfg),
    fetchClaude(s.anthropicApiKey),
    fetchOpenai(s.openaiApiKey),
    fetchOpenaiBalance(s.openaiAdminKey, s.openaiBaselineUsd, s.openaiBaselineAt),
    fetchDataforseo(s.dataforseoLogin, s.dataforseoPassword),
  ]);
  // Cùng thứ tự với Wayback actor: OpenAI chính, Claude dự phòng.
  const active: AiProvider | null = openai.ok ? "openai" : claude.ok ? "claude" : null;
  const fresh: PartnerCredits = { fetchedAt: new Date().toISOString(), credsHash, apify, ai: { active, claude, openai, openaiBalance }, dataforseo };
  try {
    await supabase().from(TABLE).upsert({ key: KEY, value: fresh, updated_at: fresh.fetchedAt }, { onConflict: "key" });
  } catch { /* không lưu được cache — vẫn trả số mới */ }
  return fresh;
}
