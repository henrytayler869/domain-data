/**
 * Rating engine — CHẠY THẲNG TRONG WEBAPP (thay workflow N8N). Ưu tiên Ahrefs (MCP),
 * hết credit cả các token Ahrefs mới fallback DataForSEO.
 *
 * Ahrefs path (giống "Ahref Checker (Kelly)" của N8N):
 *   referring-domains (DR sẵn) + anchors qua MCP → Claude Haiku phân loại → ghi DB.
 * DFS path (fallback, giống "DataforSEO Backlink Checker"):
 *   referring_domains (KHÔNG có DR) → đối chiếu backlink_db lấy DR → anchors (ĐK1/ĐK2) → Haiku → ghi.
 *
 * Creds đọc từ Settings: ahrefsMcpTokens[] (ưu tiên, theo thứ tự) + DataForSEO + Anthropic key.
 */

import { readDb, readTrafficMap } from "./backlink-db";
import { rootDomain } from "./root-domain";
import { REF_BLACKLIST_SET } from "./picker-csv";
import { readAll as readRefBlacklist } from "./ref-blacklist-db";
import { upsertRows, upsertAssessments } from "./ahrefs-db";
import { ahrefsCreditOk, ahrefsRefDomains, ahrefsAnchors } from "./ahrefs-mcp";

const DFS_REFDOMAINS = "https://api.dataforseo.com/v3/backlinks/referring_domains/live";
const DFS_ANCHORS = "https://api.dataforseo.com/v3/backlinks/anchors/live";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5";   // Claude Haiku 4.5 — giống node N8N
const CONCURRENCY = 5;
const MIN_DR = 70;                              // ref DR≥70 = ĐK1 (>90) hoặc ĐK2 (70-89)

// Prompt phân loại — sao y node "Classify" trong workflow N8N.
const SYSTEM_PROMPT = `Bạn phân loại chất lượng aged domain dựa trên hồ sơ Referring Domain (DR đã đối chiếu DB) + Anchor text. Trả về DUY NHẤT 1 JSON object (không markdown, không \`\`\`), format:
{"rating":"...","category":"...","detail":"..."}

RULE rating (chọn 1):
- "✅ TỐT": anchor brand/niche-relevant, không có spam keyword, ngôn ngữ nhất quán, có ref DR cao (DR>90 hoặc nhiều ref DR≥70).
- "⚠️ TRUNG BÌNH": real brand + vài anchor minor spam, hoặc max DR 70-89.
- "⚠️ RỦI RO": mixed — vài anchor ngôn ngữ lạ/casino/loan lẻ tẻ, ít ref khớp, cần human review.
- "❌ XẤU": nhiều anchor gambling/judi/poker/slot/casino/escort/viagra/cialis/replica/PBN, hoặc hacked.
- "❌ RẤT XẤU": drug marketplace, phishing, black SEO marketplace.

Nếu API error: rating="⚠️ RỦI RO", category="API error", detail=<error>.
Nếu refs_count=0: rating="⚠️ RỦI RO", category="No matched backlinks", detail="Không có ref nào khớp DB".

category: ngắn gọn (vd: 'Clean brand niche', 'Gambling anchors', 'Mixed/foreign anchors').
detail: 1-2 câu, nêu top 3-5 anchor + ngôn ngữ + brand hint + max DR.`;

export interface RateCreds { ahrefsTokens: string[]; dfsLogin: string; dfsPassword: string; anthropicApiKey: string }
export interface RateResult { rated: number; source: "ahrefs" | "dfs" | "none"; errors: string[] }

type Ref = { domain: string; dr: number };

// ─── Claude Haiku classify (dùng chung cả 2 path) ───────────────────────────────
async function classify(apiKey: string, input: {
  domain: string; refs_count: number; max_dr: number; dk1_count: number; refs_string: string; anchors_compact: string; api_error: string | null;
}): Promise<{ rating: string; category: string; detail: string }> {
  const userText =
    `Domain: ${input.domain}\n` +
    `Ref domain khớp DB: ${input.refs_count} (max DR ${input.max_dr}, DR>90: ${input.dk1_count})\n` +
    `Ref domains: ${input.refs_string}\n` +
    `Top anchors: ${input.anchors_compact}\n` +
    `API error: ${input.api_error ?? ""}\n\n` +
    `Phân loại. Trả về JSON: {"rating":"...","category":"...","detail":"..."}`;
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 512, system: SYSTEM_PROMPT, messages: [{ role: "user", content: userText }] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { rating: "⚠️ RỦI RO", category: "Parse error", detail: "Could not parse classify output" };
  const parsed = JSON.parse(m[0]) as { rating?: string; category?: string; detail?: string };
  return { rating: parsed.rating ?? "⚠️ RỦI RO", category: parsed.category ?? "", detail: parsed.detail ?? "" };
}

// Từ matched refs + anchors + api_error → {rating, category, detail} (rút gọn case tất định).
async function decide(apiKey: string, domain: string, matched: Ref[], anchorsCompact: string, apiError: string | null): Promise<{ rating: string; category: string; detail: string }> {
  const refsString = matched.map((m) => `${m.domain} (DR ${m.dr})`).join("; ");
  const maxDr = matched.length ? Math.max(...matched.map((m) => m.dr)) : 0;
  const dk1Count = matched.filter((m) => m.dr > 90).length;
  if (apiError) return { rating: "⚠️ RỦI RO", category: "API error", detail: apiError };
  if (matched.length === 0) return { rating: "⚠️ RỦI RO", category: "No matched backlinks", detail: "Không có ref nào khớp DB" };
  const out = await classify(apiKey, { domain, refs_count: matched.length, max_dr: maxDr, dk1_count: dk1Count, refs_string: refsString, anchors_compact: anchorsCompact, api_error: null });
  const isErr = out.category === "API error" || out.category === "Parse error";
  return { rating: out.rating, category: out.category, detail: isErr ? out.detail : `DR>90:${dk1Count} | ${refsString}` };
}

// Ghi ahrefs_results (matched refs) + target_assessment.
async function writeRating(domain: string, matched: Ref[], r: { rating: string; category: string; detail: string }) {
  if (matched.length) await upsertRows(matched.map((m) => ({ targetDomain: domain, refDomain: m.domain, domainRating: m.dr })));
  await upsertAssessments([{ targetDomain: domain, rating: r.rating, category: r.category, detail: r.detail, excludedAt: null }]);
}

// Chạy pool concurrency cho danh sách domain với 1 hàm rate 1 domain.
async function runPool(domains: string[], rateOne: (d: string) => Promise<void>, errors: string[]): Promise<number> {
  let cursor = 0, rated = 0;
  const worker = async () => {
    while (cursor < domains.length) {
      const d = domains[cursor++];
      try { await rateOne(d); rated++; }
      catch (e) { if (errors.length < 5) errors.push(`${d}: ${e instanceof Error ? e.message : "lỗi"}`); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, domains.length) }, () => worker()));
  return rated;
}

// ─── Ahrefs path ────────────────────────────────────────────────────────────────
async function rateViaAhrefs(domains: string[], token: string, apiKey: string, blacklist: Set<string>, errors: string[]): Promise<number> {
  return runPool(domains, async (domain) => {
    let matched: Ref[] = [];
    let apiError: string | null = null;
    try {
      const refs = await ahrefsRefDomains(token, domain, MIN_DR);
      matched = refs.filter((r) => !r.isSpam && !blacklist.has(r.domain)).map((r) => ({ domain: r.domain, dr: r.dr }));
    } catch (e) { apiError = e instanceof Error ? e.message : "ahrefs refdomains error"; }

    let anchorsCompact = "";
    if (!apiError && matched.length) {
      const anchors = await ahrefsAnchors(token, domain);
      anchorsCompact = anchors.map((a) => `"${a.text}" (x${a.refdomains}${a.isSpam ? ", spam" : ""})`).join(" | ").slice(0, 1500);
    }
    const r = await decide(apiKey, domain, matched, anchorsCompact, apiError);
    await writeRating(domain, matched, r);
  }, errors);
}

// ─── DataForSEO path (fallback) ──────────────────────────────────────────────────
interface DfsRefItem { domain?: string; backlinks?: number }
interface DfsAnchorItem { anchor?: string; backlinks?: number }

async function dfsCall<T>(url: string, auth: string, target: string, limit: number): Promise<T[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify([{ target, limit, order_by: ["backlinks,desc"] }]),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { tasks?: { status_code: number; status_message: string; result?: { items?: T[] }[] }[] };
  const task = data.tasks?.[0];
  if (!task || task.status_code !== 20000) throw new Error(`${task?.status_code} ${task?.status_message ?? "no task"}`);
  return task.result?.[0]?.items ?? [];
}

async function rateViaDfs(domains: string[], creds: RateCreds, blacklist: Set<string>, errors: string[]): Promise<number> {
  const [dbEntries, trafficRows] = await Promise.all([readDb(), readTrafficMap()]);
  const drMap = new Map(dbEntries.map((e) => [e.domain.toLowerCase(), e.dr]));
  const trafficMap = new Map(trafficRows.map((r) => [r.domain.toLowerCase(), r.traffic]));
  const auth = Buffer.from(`${creds.dfsLogin}:${creds.dfsPassword}`).toString("base64");

  return runPool(domains, async (domain) => {
    const matched: (Ref & { traffic: number | null })[] = [];
    let apiError: string | null = null;
    try {
      const items = await dfsCall<DfsRefItem>(DFS_REFDOMAINS, auth, domain, 100);
      const seen = new Set<string>();
      for (const it of items) {
        const ref = rootDomain(it.domain ?? "");
        if (!ref || seen.has(ref) || blacklist.has(ref)) continue;
        seen.add(ref);
        const dr = drMap.get(ref);
        if (dr == null) continue;
        matched.push({ domain: ref, dr, traffic: trafficMap.get(ref) ?? null });
      }
      matched.sort((a, b) => b.dr - a.dr);
    } catch (e) { apiError = `refdomains: ${e instanceof Error ? e.message : "fetch error"}`; }

    const dk1 = matched.some((m) => m.dr > 90);
    const dk2 = !dk1 && matched.some((m) => m.dr >= 70 && m.dr <= 89 && (m.traffic ?? 0) >= 1_000_000);
    let anchorsCompact = "";
    if (!apiError && (dk1 || dk2)) {
      try {
        const anchors = await dfsCall<DfsAnchorItem>(DFS_ANCHORS, auth, domain, 30);
        anchorsCompact = anchors.slice(0, 20).map((a) => `${a.anchor ?? ""} (${a.backlinks ?? 0})`).join(" | ").slice(0, 1500);
      } catch { /* anchors phụ trợ */ }
    }
    const plain: Ref[] = matched.map((m) => ({ domain: m.domain, dr: m.dr }));
    const r = await decide(creds.anthropicApiKey, domain, plain, anchorsCompact, apiError);
    await writeRating(domain, plain, r);
  }, errors);
}

// ─── Entry: chọn nguồn (Ahrefs ưu tiên, hết credit → DFS) ────────────────────────
export async function rateDomains(domainsRaw: string[], creds: RateCreds): Promise<RateResult> {
  const domains = Array.from(new Set(domainsRaw.map((d) => d.trim().toLowerCase()).filter((d) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d))));
  if (!domains.length) return { rated: 0, source: "none", errors: [] };
  if (!creds.anthropicApiKey) return { rated: 0, source: "none", errors: ["Thiếu Anthropic API key"] };

  const errors: string[] = [];
  const userBl = await readRefBlacklist().catch(() => []);
  const blacklist = new Set<string>(REF_BLACKLIST_SET);
  for (const e of userBl) blacklist.add(e.domain.toLowerCase());

  // 1) Ahrefs trước — dùng token đầu tiên CÒN credit (theo thứ tự).
  for (const token of creds.ahrefsTokens) {
    if (!token?.trim()) continue;
    if (await ahrefsCreditOk(token.trim())) {
      const rated = await rateViaAhrefs(domains, token.trim(), creds.anthropicApiKey, blacklist, errors);
      return { rated, source: "ahrefs", errors };
    }
  }

  // 2) Hết credit Ahrefs (hoặc chưa cấu hình) → DataForSEO.
  if (creds.dfsLogin && creds.dfsPassword) {
    const rated = await rateViaDfs(domains, creds, blacklist, errors);
    return { rated, source: "dfs", errors };
  }

  return { rated: 0, source: "none", errors: [...errors, "Ahrefs hết credit và chưa cấu hình DataForSEO"] };
}
