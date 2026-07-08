/**
 * Gname registrar API client (server-only).
 *
 * Auth scheme (https://www.gname.com/domain/api/rule/anquan):
 *   1. Sort params by ASCII key order, trim values.
 *   2. Build "k1=v1&k2=v2" with URL-encoded values.
 *   3. Append APPKEY, MD5, uppercase → gntoken.
 *
 * Env: GNAME_APPID + GNAME_APPKEY (+ optional GNAME_API_BASE).
 */

import { createHash } from "node:crypto";

const API_BASE = process.env.GNAME_API_BASE ?? "https://api.gname.com";

function credentials(): { appid: string; appkey: string } {
  const appid = process.env.GNAME_APPID;
  const appkey = process.env.GNAME_APPKEY;
  if (!appid || !appkey) {
    throw new Error(
      "Gname chưa được cấu hình. Set GNAME_APPID và GNAME_APPKEY trong dashboard/.env.local"
    );
  }
  return { appid, appkey };
}

function sign(params: Record<string, string>, appkey: string): string {
  const stringA = Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k].trim())}`)
    .join("&");
  return createHash("md5").update(stringA + appkey).digest("hex").toUpperCase();
}

interface GnameEnvelope {
  code: number;
  msg: string;
  data: unknown;
}

async function gnamePost(path: string, params: Record<string, string>): Promise<GnameEnvelope> {
  const { appid, appkey } = credentials();
  const full: Record<string, string> = {
    ...params,
    appid,
    gntime: String(Math.floor(Date.now() / 1000)),
  };
  full.gntoken = sign(full, appkey);

  const body = new URLSearchParams(full);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    // Gname can be slow on registration calls.
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Gname HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as GnameEnvelope;
}

export interface GnameRegisterResult {
  domain: string;
  ok: boolean;
  /** Amount Gname froze/charged (USD) when ok. */
  price: number | null;
  /** Premium domain — needs manual confirmation on Gname, not auto-bought. */
  premium: boolean;
  code: number;
  msg: string;
}

export interface GnameCheckResult {
  domain: string;
  /** Gname có thể ĐĂNG KÝ NGAY (available) hay không. */
  available: boolean;
  /** Domain premium — Gname không cho tự mua giá thường. */
  premium: boolean;
  /** Gọi check LỖI (IP chưa whitelist / mạng / rate-limit) — khác với "registered". */
  error: boolean;
  /** registered + đang RỚT → có trong Gname dropcatch (is_backorder=1) → đặt backorder được. */
  backorderable: boolean;
  /** Ngày drop dự kiến (từ dropcatch) khi backorderable. */
  deletionDate: string | null;
  code: number;
  msg: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GnameBackorderChannel {
  channel_name: string;
  price: number;
  deposit: number;
  tlds: string[];
}

/**
 * Check 1 domain CÓ BACKORDER ĐƯỢC qua Gname không (`/api/dropcatch/list`).
 * Gname là thẩm quyền: domain đang RỚT + is_backorder=1 mới có trong list.
 * Onsale / có-chủ / không-rớt → count 0 → không backorder được. (KHÔNG suy từ RDAP.)
 */
export async function checkBackorderable(domain: string): Promise<{ ok: boolean; deletionDate: string | null }> {
  const ym = domain.toLowerCase().trim();
  try {
    const r = await gnamePost("/api/dropcatch/list", { inc_value: ym, page: "1", pagesize: "10" });
    if (r.code === 1 && Array.isArray(r.data)) {
      const hit = (r.data as Record<string, unknown>[]).find(
        (x) => String(x.domain ?? "").toLowerCase() === ym && (x.is_backorder === 1 || x.is_backorder === "1"),
      );
      if (hit) return { ok: true, deletionDate: hit.deletion_date ? String(hit.deletion_date) : null };
    }
    return { ok: false, deletionDate: null };
  } catch {
    return { ok: false, deletionDate: null };
  }
}

/** Danh sách kênh backorder của Gname (`/api/backorder/channel`) — giá + deposit + TLD. */
export async function getBackorderChannels(): Promise<GnameBackorderChannel[]> {
  const r = await gnamePost("/api/backorder/channel", {});
  if (r.code !== 1 || !Array.isArray(r.data)) return [];
  return (r.data as Record<string, unknown>[]).map((ch) => ({
    channel_name: String(ch.channel_name ?? ch.channel ?? ch.name ?? ""),
    price: parseFloat(String(ch.price ?? 0)) || 0,
    deposit: parseFloat(String(ch.deposit ?? 0)) || 0,
    tlds: Array.isArray(ch.tlds) ? (ch.tlds as unknown[]).map((t) => String(t).toLowerCase().replace(/^\./, "")) : [],
  }));
}

/**
 * Gname trả code -1 cho CẢ "registered" LẪN lỗi (rate-limit, IP). Phân loại theo msg:
 *   registered — "...has been registered or reserved"
 *   ratelimit  — "requests are too frequent / try again later" (tạm thời → retry)
 *   iperror    — IP chưa whitelist / chưa ủy quyền
 */
function classifyMsg(msg: string): "registered" | "ratelimit" | "iperror" | "other" {
  const m = msg.toLowerCase();
  if (/registered|reserved|已注册|已被注册|已被预留/.test(m)) return "registered";
  if (/frequent|too many|try again|rate.?limit|频繁|请稍|稍后/.test(m)) return "ratelimit";
  if (/\bip\b|whitelist|白名单|授权|unauthor|forbidden/.test(m)) return "iperror";
  return "other";
}

/**
 * Check 1 domain qua Gname `/api/domain/check` (có retry cho rate-limit).
 *   code 1  = available (mua được ngay) · code -3 = premium
 *   code -1 + msg "registered/reserved" = registered (chưa mua được)
 *   rate-limit / IP / lỗi khác → error=true (UI hiện ⚠️, không nhầm là registered).
 */
export async function checkDomain(domain: string, retries = 3): Promise<GnameCheckResult> {
  const ym = domain.toLowerCase().trim();
  const base = { domain: ym, available: false, premium: false, error: false, backorderable: false, deletionDate: null as string | null };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await gnamePost("/api/domain/check", { domain: ym });
      if (r.code === 1) {
        const data = (r.data && typeof r.data === "object") ? (r.data as Record<string, unknown>) : {};
        const premium = data.premium === true || data.premium === 1 || String(data.premium ?? "") === "1";
        return { ...base, available: true, premium, code: r.code, msg: r.msg };
      }
      if (r.code === -3) return { ...base, available: true, premium: true, code: r.code, msg: r.msg };
      const kind = classifyMsg(String(r.msg ?? ""));
      if (kind === "registered") {
        // "registered" → có BACKORDER được không? Hỏi Gname dropcatch (thẩm quyền), KHÔNG suy từ RDAP.
        const bo = await checkBackorderable(ym);
        return { ...base, available: false, backorderable: bo.ok, deletionDate: bo.deletionDate, code: r.code, msg: r.msg };
      }
      if (kind === "ratelimit" && attempt < retries) { await sleep(1200 * (attempt + 1)); continue; }
      return { ...base, error: true, code: r.code, msg: r.msg };   // iperror / other / hết retry
    } catch (err) {
      if (attempt < retries) { await sleep(1200 * (attempt + 1)); continue; }
      return { ...base, error: true, code: -999, msg: err instanceof Error ? err.message : "Unknown error" };
    }
  }
  return { ...base, error: true, code: -998, msg: "retries exhausted" };
}

/** Check nhiều domain — concurrency THẤP + giãn nhịp để tránh rate-limit Gname. */
export async function checkDomainsMany(
  domains: string[],
  concurrency = 2,
): Promise<GnameCheckResult[]> {
  const out: GnameCheckResult[] = new Array(domains.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < domains.length) {
      const i = cursor++;
      out[i] = await checkDomain(domains[i]);
      await sleep(350);   // giãn nhịp giữa các call của cùng worker
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, domains.length) }, () => worker()));
  return out;
}

/**
 * Submit a registration order for one domain.
 * code 1 = accepted (data = frozen amount). code -3 = premium (skipped — we
 * never auto-confirm premium pricing).
 */
export async function registerDomain(domain: string): Promise<GnameRegisterResult> {
  const ym = domain.toLowerCase().trim();
  try {
    const r = await gnamePost("/api/domain/reg", { ym });
    if (r.code === 1) {
      const price = typeof r.data === "number" ? r.data : parseFloat(String(r.data));
      return { domain: ym, ok: true, price: Number.isFinite(price) ? price : null, premium: false, code: r.code, msg: r.msg };
    }
    if (r.code === -3) {
      const p = (r.data as { price?: string } | null)?.price;
      return { domain: ym, ok: false, price: p ? parseFloat(p) : null, premium: true, code: r.code, msg: r.msg };
    }
    return { domain: ym, ok: false, price: null, premium: false, code: r.code, msg: r.msg };
  } catch (err) {
    return {
      domain: ym,
      ok: false,
      price: null,
      premium: false,
      code: -999,
      msg: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/** Channel 2 = $26 (deposit $3), phủ com/net/org… — dùng cho backorder mặc định. */
export const BACKORDER_CHANNEL_TD = 2;

export interface GnameBackorderResult {
  domain: string;
  ok: boolean;
  /** Số tiền deposit Gname đóng băng khi đặt backorder thành công (USD). */
  amount: number | null;
  code: number;
  msg: string;
}

/**
 * Đặt backorder (抢注) 1 domain qua Gname `/api/backorder/add`.
 *   ym = domain, td = channel (2 = Channel 2 $26). code 1 = thành công (data = deposit đóng băng).
 */
export async function placeBackorder(
  domain: string,
  td: number = BACKORDER_CHANNEL_TD,
): Promise<GnameBackorderResult> {
  const ym = domain.toLowerCase().trim();
  try {
    const r = await gnamePost("/api/backorder/add", { ym, td: String(td) });
    if (r.code === 1) {
      const amt = typeof r.data === "number" ? r.data : parseFloat(String(r.data));
      return { domain: ym, ok: true, amount: Number.isFinite(amt) ? amt : null, code: r.code, msg: r.msg };
    }
    return { domain: ym, ok: false, amount: null, code: r.code, msg: r.msg };
  } catch (err) {
    return { domain: ym, ok: false, amount: null, code: -999, msg: err instanceof Error ? err.message : "Unknown error" };
  }
}
