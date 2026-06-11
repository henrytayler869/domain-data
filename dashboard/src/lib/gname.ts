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
