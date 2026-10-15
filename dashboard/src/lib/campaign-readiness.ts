/**
 * "Chuẩn bị đợt quét" — gom số dư mọi công cụ trả tiền + checklist vận hành, và ước tính
 * chi phí cho N domain sắp quét. Dùng cho trang /campaign và cảnh báo Telegram.
 *
 * Phễu (tỉ lệ đọc LIVE từ DB): N domain → Gname check (miễn phí) → % mua được → Wayback
 * (Apify + OpenAI) → % clean → chấm rating (Ahrefs unit, hết thì DataForSEO) → % Tốt/TB.
 */

import { supabase } from "./supabase";
import { readSettings } from "./settings";
import { getPartnerCredits } from "./partner-credits";
import { ahrefsUnits } from "./ahrefs-mcp";
import { resolveAccount, getBackorderChannelsRaw } from "./gname";
import { readReconcileState, isTickHealthy } from "./pipeline-status";
import { readOps } from "./ops-settings";

// Đơn giá đo thực tế 2026-10-15 (xem RUNBOOK.md). Apify thấp hơn (~$0,01) khi run gom 5 domain.
export const UNIT_COST = {
  apifyPerWayback: 0.025,     // $ / domain quét Wayback (150 snapshot)
  openaiPerWayback: 0.007,    // $ / domain (gpt-4o-mini, ~55 snapshot)
  openaiPerRating: 0.0003,    // $ / domain chấm rating
  ahrefsUnitsPerRating: 300,  // unit / domain (refdomains + anchors)
  dfsPerRating: 0.03,         // $ / domain khi Ahrefs hết unit → DataForSEO
  waybackPerHour: 200,        // domain / giờ (40 run song song, tick 5')
  gnamePerHour: 1500,         // domain / giờ
};

export type Level = "ok" | "warn" | "bad";

export interface ToolRow {
  key: string;
  name: string;
  purpose: string;
  balance: string;            // số dư hiển thị
  need: string;               // cần cho N domain
  level: Level;
  note: string | null;
  topupUrl: string | null;
}

export interface CheckRow { key: string; label: string; level: Level; detail: string }

export interface Readiness {
  at: string;
  n: number;
  funnel: { availPct: number; cleanPct: number; goodPct: number; toWayback: number; toRating: number; buyable: number; hours: number };
  costUsd: { apify: number; openai: number; dfsIfNoAhrefs: number; total: number };
  tools: ToolRow[];
  checks: CheckRow[];
  // Số thô cho cảnh báo Telegram
  raw: { apifyRemainingUsd: number | null; dfsBalanceUsd: number | null; ahrefsRemainingUnits: number | null; openaiOk: boolean | null; gnameOk: boolean | null; vpsDaysLeft: number | null };
}

const usd = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 2 : 0 })}`;
const int = (v: number) => Math.round(v).toLocaleString("en-US");

// Tỉ lệ qua từng tầng, đọc từ toàn bộ lịch sử trong DB (lỗi → dùng số đo 2026-10-15).
async function funnelRatios() {
  const sb = supabase();
  const head = { count: "exact" as const, head: true };
  const pct = (hit: number | null, total: number | null, fallback: number) => (total ? (hit ?? 0) / total : fallback);
  try {
    const [gT, gH, wT, wH, rT, rH] = await Promise.all([
      sb.from("gname_checks").select("*", head),
      sb.from("gname_checks").select("*", head).in("status", ["available", "backorder"]),
      sb.from("wayback_results").select("*", head),
      sb.from("wayback_results").select("*", head).eq("has_betting", false).eq("has_adult", false).gt("snapshot_count", 0),
      sb.from("target_assessment").select("*", head).not("rating", "is", null),
      sb.from("target_assessment").select("*", head).or("rating.ilike.%TỐT%,rating.ilike.%TRUNG BÌNH%"),
    ]);
    return { availPct: pct(gH.count, gT.count, 0.79), cleanPct: pct(wH.count, wT.count, 0.4), goodPct: pct(rH.count, rT.count, 0.15) };
  } catch {
    return { availPct: 0.79, cleanPct: 0.4, goodPct: 0.15 };
  }
}

/** OpenAI: không có API số dư → gọi 1 completion siêu nhỏ để biết key còn dùng được (hết credit = 429 insufficient_quota). */
async function openaiCheck(key: string): Promise<{ ok: boolean; detail: string }> {
  if (!key) return { ok: false, detail: "Chưa có OpenAI API key trong Cài đặt" };
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (r.ok) return { ok: true, detail: "Key hoạt động" };
    const j = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (j.error?.code === "insufficient_quota") return { ok: false, detail: "Hết credit OpenAI" };
    return { ok: false, detail: j.error?.message?.slice(0, 120) ?? `HTTP ${r.status}` };
  } catch (e) { return { ok: false, detail: e instanceof Error ? e.message : String(e) }; }
}

async function gnameCheck(): Promise<{ ok: boolean; detail: string }> {
  try {
    const acc = await resolveAccount(null);
    const r = await getBackorderChannelsRaw(acc);
    return r.code === 1 ? { ok: true, detail: "Kết nối OK (IP VPS đã whitelist)" } : { ok: false, detail: r.msg || `code ${r.code}` };
  } catch (e) { return { ok: false, detail: e instanceof Error ? e.message : String(e) }; }
}

const levelFor = (have: number | null, need: number): Level =>
  have == null ? "warn" : have >= need ? "ok" : have >= need * 0.3 ? "warn" : "bad";

export async function computeReadiness(n: number, opts: { forceCredits?: boolean } = {}): Promise<Readiness> {
  const s = await readSettings();
  const tokens = [s.ahrefsToken1, s.ahrefsToken2, s.ahrefsToken3].filter(Boolean);
  const [ratios, credits, units, openai, gname, state, ops] = await Promise.all([
    funnelRatios(),
    getPartnerCredits(!!opts.forceCredits),
    Promise.all(tokens.map((t) => ahrefsUnits(t))),
    openaiCheck(s.openaiApiKey),
    gnameCheck(),
    readReconcileState(),
    readOps(),
  ]);

  // ── Phễu + chi phí ──────────────────────────────────────────────────────────
  const toWayback = n * ratios.availPct;
  const toRating = toWayback * ratios.cleanPct;
  const buyable = toRating * ratios.goodPct;
  const apifyNeed = toWayback * UNIT_COST.apifyPerWayback;
  const openaiNeed = toWayback * UNIT_COST.openaiPerWayback + toRating * UNIT_COST.openaiPerRating;
  const unitsNeed = toRating * UNIT_COST.ahrefsUnitsPerRating;

  // ── Số dư ──────────────────────────────────────────────────────────────────
  const apifyOk = credits.apify.accounts.filter((a) => !a.error && a.limitUsd != null && a.usageUsd != null);
  const apifyRemaining = apifyOk.length ? apifyOk.reduce((t, a) => t + Math.max(0, a.limitUsd! - a.usageUsd!), 0) : null;
  const dfsBalance = credits.dataforseo.balanceUsd;
  const unitRows = units.filter((u): u is NonNullable<typeof u> => !!u);
  const unitsRemaining = unitRows.length ? unitRows.reduce((t, u) => t + Math.max(0, u.limit - u.usage), 0) : null;
  const unitsShortfall = Math.max(0, unitsNeed - (unitsRemaining ?? 0));
  const dfsNeed = (unitsShortfall / UNIT_COST.ahrefsUnitsPerRating) * UNIT_COST.dfsPerRating;
  const resets = unitRows.map((u) => u.resetAt?.slice(0, 10)).filter(Boolean).join(", ");

  const vpsDaysLeft = ops.vpsExpiresAt ? Math.floor((Date.parse(ops.vpsExpiresAt) - Date.now()) / 86_400_000) : null;

  const tools: ToolRow[] = [
    {
      key: "apify", name: "Apify", purpose: "Quét Wayback (lịch sử web)",
      balance: apifyRemaining == null ? (credits.apify.error ?? "Không đọc được") : `${usd(apifyRemaining)} còn`,
      need: usd(apifyNeed), level: levelFor(apifyRemaining, apifyNeed),
      note: "Gói tháng — credit làm mới theo chu kỳ billing. Thêm tài khoản thứ 2 trong Cài đặt để tự chuyển khi hết.",
      topupUrl: "https://console.apify.com/billing",
    },
    {
      key: "openai", name: "OpenAI", purpose: "AI đọc nội dung Wayback + phân loại rating",
      balance: openai.ok ? "Key hoạt động (không có API xem số dư)" : openai.detail,
      need: usd(openaiNeed), level: openai.ok ? "ok" : "bad",
      note: `Nạp tối thiểu ${usd(Math.ceil(openaiNeed * 1.2))} (dư 20%). Bật auto-recharge trên OpenAI để khỏi bị dừng.`,
      topupUrl: "https://platform.openai.com/settings/organization/billing/overview",
    },
    {
      key: "ahrefs", name: "Ahrefs (MCP)", purpose: "Lấy ref domain + anchor để chấm rating",
      balance: unitsRemaining == null ? "Không đọc được token" : `${int(unitsRemaining)} unit còn (${unitRows.length}/${tokens.length} token)`,
      need: `${int(unitsNeed)} unit`, level: levelFor(unitsRemaining, unitsNeed),
      note: resets ? `Unit làm mới ngày: ${resets}. Thiếu unit thì tự chuyển sang DataForSEO.` : null,
      topupUrl: "https://app.ahrefs.com/account/billing",
    },
    {
      key: "dataforseo", name: "DataForSEO", purpose: "Dự phòng chấm rating khi Ahrefs hết unit",
      balance: dfsBalance == null ? (credits.dataforseo.error ?? "Không đọc được") : `${usd(dfsBalance)} còn`,
      need: dfsNeed > 0 ? usd(dfsNeed) : "$0 (Ahrefs đủ unit)", level: levelFor(dfsBalance, Math.max(5, dfsNeed)),
      note: "Nên giữ ≥ $10 phòng khi Ahrefs lỗi.",
      topupUrl: "https://app.dataforseo.com/",
    },
    {
      key: "gname", name: "Gname", purpose: "Check còn mua được + mua domain",
      balance: gname.detail, need: `Check miễn phí · mua ~${int(buyable)} domain đáng mua × giá (≤ $26)`,
      level: gname.ok ? "ok" : "bad",
      note: "Số dư Gname chỉ dùng khi bấm Mua — nạp theo số domain định mua.",
      topupUrl: "https://www.gname.com/",
    },
    {
      key: "vps", name: "VPS", purpose: "Chạy dashboard + DB + cron pipeline",
      balance: vpsDaysLeft == null ? "Chưa nhập ngày hết hạn" : `Còn ${vpsDaysLeft} ngày (${ops.vpsExpiresAt})`,
      need: `Cần chạy ~${Math.ceil(toWayback / UNIT_COST.waybackPerHour / 24)} ngày`,
      level: vpsDaysLeft == null ? "warn" : vpsDaysLeft >= Math.max(7, toWayback / UNIT_COST.waybackPerHour / 24 + 3) ? "ok" : vpsDaysLeft >= 3 ? "warn" : "bad",
      note: "Gia hạn trên panel nhà cung cấp VPS. Đổi IP thì xem RUNBOOK mục Đổi IP.",
      topupUrl: null,
    },
  ];

  const healthy = isTickHealthy(state);
  const checks: CheckRow[] = [
    { key: "cron", label: "Pipeline nền (cron VPS) đang chạy", level: healthy ? "ok" : "bad",
      detail: state.lastTickAt ? `Tick gần nhất ${Math.round((Date.now() - Date.parse(state.lastTickAt)) / 60000)} phút trước` : "Chưa có tick nào" },
    { key: "paused", label: "Wayback không bị tạm dừng", level: state.waybackPaused ? "bad" : "ok",
      detail: state.waybackPaused === "apify_credit" ? "Dừng vì Apify hết credit" : state.waybackPaused === "ai_credit" ? "Dừng vì OpenAI hết credit / key lỗi" : "Bình thường" },
    { key: "gname", label: "Gname kết nối được (IP VPS đã whitelist)", level: gname.ok ? "ok" : "bad", detail: gname.detail },
    { key: "openai", label: "OpenAI key dùng được", level: openai.ok ? "ok" : "bad", detail: openai.detail },
    { key: "telegram", label: "Đã cấu hình Telegram nhận cảnh báo", level: ops.telegramBotToken && ops.telegramChatId ? "ok" : "warn",
      detail: ops.telegramBotToken && ops.telegramChatId ? "Sẽ báo khi sắp hết tiền / pipeline dừng / đợt quét xong" : "Chưa có — nhập ở mục Cảnh báo Telegram bên dưới" },
  ];

  return {
    at: new Date().toISOString(),
    n,
    funnel: { availPct: ratios.availPct, cleanPct: ratios.cleanPct, goodPct: ratios.goodPct, toWayback: Math.round(toWayback), toRating: Math.round(toRating), buyable: Math.round(buyable), hours: Math.ceil(toWayback / UNIT_COST.waybackPerHour) },
    costUsd: { apify: apifyNeed, openai: openaiNeed, dfsIfNoAhrefs: toRating * UNIT_COST.dfsPerRating, total: apifyNeed + openaiNeed + dfsNeed },
    tools,
    checks,
    raw: { apifyRemainingUsd: apifyRemaining, dfsBalanceUsd: dfsBalance, ahrefsRemainingUnits: unitsRemaining, openaiOk: openai.ok, gnameOk: gname.ok, vpsDaysLeft },
  };
}
