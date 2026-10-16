/**
 * Rating engine — CHẠY THẲNG TRONG WEBAPP. Ưu tiên Ahrefs (MCP),
 * hết credit cả các token Ahrefs mới fallback DataForSEO.
 *
 * Ahrefs path (giống "Ahref Checker (Kelly)" của N8N):
 *   referring-domains (DR sẵn) + anchors qua MCP → OpenAI gpt-4o-mini phân loại → ghi DB.
 * DFS path (fallback, giống "DataforSEO Backlink Checker"):
 *   referring_domains (KHÔNG có DR) → đối chiếu backlink_db lấy DR → anchors (ĐK1/ĐK2) → gpt-4o-mini → ghi.
 *
 * Creds đọc từ Settings: ahrefsMcpTokens[] (ưu tiên, theo thứ tự) + DataForSEO + OpenAI key.
 */

import { readDb, readTrafficMap, mergeRefsKeepMax } from "./backlink-db";
import { rootDomain } from "./root-domain";
import { REF_BLACKLIST_SET } from "./picker-csv";
import { readAll as readRefBlacklist } from "./ref-blacklist-db";
import { upsertUnmatchedRefs } from "./unmatched-refs-db";
import { upsertRows, upsertAssessments } from "./ahrefs-db";
import { RATING } from "./rating-normalize";
import { analyzeAnchors, resolveAnchorQuality, type AnchorIn, type AnchorQuality } from "./anchor-analysis";
import { ahrefsCreditOk, ahrefsRefDomains, ahrefsAnchors, AHREFS_QUOTA_RE } from "./ahrefs-mcp";

const DFS_REFDOMAINS = "https://api.dataforseo.com/v3/backlinks/referring_domains/live";
const DFS_ANCHORS = "https://api.dataforseo.com/v3/backlinks/anchors/live";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const CONCURRENCY = 5;
const MIN_DR = 70;
const BACKLINK_DB_ADD_DR = 90;                // ref Ahrefs DR > ngưỡng này → bổ sung vào backlink_db

// AI CHỈ đánh giá chất lượng ANCHOR; rating do code tính (computeRating) theo đúng tiêu chí cũ:
//   ✅ TỐT        : anchor sạch (brand/niche, không spam, ngôn ngữ nhất quán) + ref DR>90 hoặc nhiều (≥3) ref DR≥70
//   ⚠️ TRUNG BÌNH : real brand + vài anchor spam nhẹ, hoặc anchor sạch nhưng chỉ có ref DR 70–89 (ít)
//   ⚠️ RỦI RO     : mixed — anchor ngôn ngữ lạ/casino/loan lẻ tẻ, hoặc ít ref khớp → cần người xem
//   ❌ XẤU        : nhiều anchor gambling/judi/poker/slot/casino/escort/viagra/cialis/replica/PBN, hoặc bị hack
//   ❌ RẤT XẤU    : drug marketplace, phishing, black SEO marketplace
// Trước đây để model tự chọn rating: gpt-4o-mini gần như không bao giờ cho TỐT (9/9 domain sạch có
// ref DR>90 bị hạ TRUNG BÌNH) và đôi khi viết lệch "✅ TỐI" → bộ lọc bỏ sót.
const SYSTEM_PROMPT = `Bạn đánh giá CHẤT LƯỢNG ANCHOR TEXT của một aged domain (KHÔNG chấm điểm domain — hệ thống tự tính từ DR). Trả về DUY NHẤT 1 JSON object:
{"anchor_quality":"...","category":"...","detail":"..."}

anchor_quality (chọn đúng 1):
- "clean": anchor là brand / tên miền / tên người / chủ đề ngách hợp lý, KHÔNG có từ khoá spam, ngôn ngữ nhất quán.
- "minor_spam": phần lớn là brand thật nhưng có VÀI anchor spam nhẹ (vd "click here", từ khoá SEO chung chung, 1–2 anchor ngôn ngữ lạ).
- "mixed": lẫn lộn — nhiều anchor ngôn ngữ lạ, casino/loan/pharma xuất hiện lẻ tẻ, khó kết luận, cần người xem.
- "heavy_spam": NHIỀU anchor gambling/judi/poker/slot/casino/escort/sex/viagra/cialis/replica/PBN, hoặc dấu hiệu domain bị hack.
- "malicious": drug marketplace, darknet, phishing, black SEO marketplace.
- "unknown": không có anchor nào để đánh giá.

Lưu ý khi đánh giá:
- Nhãn ", spam" cạnh anchor là cờ của Ahrefs về SITE trỏ link (site kém chất lượng), KHÔNG nói gì về nội dung anchor. Anchor là brand / tên miền / tên người thì vẫn là anchor sạch dù có nhãn đó.
- Anchor rác SEO tự động chứa tên miền (vd "SEO Authority Backlinks for <domain>", "Rank Higher on Google with <domain>", "<domain> website worth", danh bạ tự sinh) là spam liên kết phổ biến, KHÔNG phải chủ đề cá cược/người lớn: tính là "minor_spam" nếu anchor brand vẫn chiếm phần lớn, "mixed" nếu loại này áp đảo.
- Chỉ chọn "heavy_spam" khi CHỦ ĐỀ anchor là gambling/sex/pharma/replica/PBN… hoặc có dấu hiệu bị hack.

category: nhãn ngắn tiếng Anh (vd 'Clean brand niche', 'Gambling anchors', 'Mixed/foreign anchors', 'PBN network').
detail: 1-2 câu, nêu top 3-5 anchor + ngôn ngữ + brand hint.`;

/** Rating tất định từ chất lượng anchor (AI) + DR các ref sạch đã khớp. */
export function computeRating(q: AnchorQuality, matched: Ref[]): string {
  const strong = matched.filter((m) => m.dr >= MIN_DR).length;     // ref DR≥70
  const dk1 = matched.some((m) => m.dr > 90);
  switch (q) {
    case "malicious": return RATING.RAT_XAU;
    case "heavy_spam": return RATING.XAU;
    case "mixed": return RATING.RUI_RO;
    case "minor_spam": return strong >= 1 ? RATING.TRUNG_BINH : RATING.RUI_RO;
    case "unknown": return strong >= 1 ? RATING.TRUNG_BINH : RATING.RUI_RO;
    case "clean": return dk1 || strong >= 3 ? RATING.TOT : strong >= 1 ? RATING.TRUNG_BINH : RATING.RUI_RO;
  }
}

const ANCHOR_QUALITIES: AnchorQuality[] = ["clean", "minor_spam", "mixed", "heavy_spam", "malicious", "unknown"];

export interface RateCreds { ahrefsTokens: string[]; dfsLogin: string; dfsPassword: string; openaiApiKey: string }
export interface RateResult { rated: number; source: "ahrefs" | "dfs" | "none"; errors: string[] }

type Ref = { domain: string; dr: number };

// ─── OpenAI gpt-4o-mini: đánh giá anchor (dùng chung cả 2 path) ──────────────────
async function classifyAnchors(apiKey: string, input: { domain: string; refs_string: string; anchors_compact: string }): Promise<{ q: AnchorQuality; category: string; detail: string } | null> {
  const userText =
    `Domain: ${input.domain}\n` +
    `Ref domains (tham khảo ngữ cảnh): ${input.refs_string}\n` +
    `Top anchors: ${input.anchors_compact || "(không có)"}\n\n` +
    `Đánh giá anchor. Trả về JSON: {"anchor_quality":"...","category":"...","detail":"..."}`;
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL, max_tokens: 400, temperature: 0, response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userText }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const m = (data.choices?.[0]?.message?.content ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  const p = JSON.parse(m[0]) as { anchor_quality?: string; category?: string; detail?: string };
  const q = String(p.anchor_quality ?? "").trim().toLowerCase() as AnchorQuality;
  if (!ANCHOR_QUALITIES.includes(q)) return null;
  return { q, category: p.category ?? "", detail: p.detail ?? "" };
}

// Từ matched refs + anchors + api_error → {rating, category, detail}.
// Chất lượng anchor = đo đạc trong code (anchor-analysis) + ý kiến AI chỉ ở ca mơ hồ / có chủ đề xấu.
async function decide(apiKey: string, domain: string, matched: Ref[], anchors: AnchorIn[], apiError: string | null): Promise<{ rating: string; category: string; detail: string }> {
  const refsString = matched.map((m) => `${m.domain} (DR ${m.dr})`).join("; ");
  const dk1Count = matched.filter((m) => m.dr > 90).length;
  if (apiError) return { rating: RATING.RUI_RO, category: "API error", detail: apiError };
  if (matched.length === 0) return { rating: RATING.RUI_RO, category: "No matched backlinks", detail: "Không có ref nào khớp DB" };
  const features = analyzeAnchors(domain, anchors);
  const anchorsCompact = anchors.slice(0, 20).map((a) => `"${a.text}" (x${a.weight})`).join(" | ").slice(0, 1500);
  const input = { domain, refs_string: refsString, anchors_compact: anchorsCompact };
  let out = await classifyAnchors(apiKey, input);
  if (!out) out = await classifyAnchors(apiKey, input);           // JSON lỗi / nhãn lạ → hỏi lại 1 lần
  const q = resolveAnchorQuality(features, out?.q ?? null);
  // Nhãn khớp kết quả cuối: ca code quyết định (sạch / spam nhẹ) dùng nhãn cố định — AI hay
  // ghi "Mixed/foreign anchors" cho cả domain sạch; ca xấu / lẫn lộn do AI quyết thì giữ nhãn AI.
  const category =
    q === "clean" ? "Clean brand niche"
    : q === "minor_spam" ? "Brand + SEO spam anchors"
    : q === "unknown" ? "No anchors"
    : out && out.q === q && out.category ? out.category
    : q === "mixed" ? "Mixed / SEO spam anchors" : "Spam anchors";
  return { rating: computeRating(q, matched), category, detail: `DR>90:${dk1Count} | ${refsString}` };
}

// Ghi ahrefs_results (matched refs) + target_assessment.
async function writeRating(domain: string, matched: Ref[], r: { rating: string; category: string; detail: string }) {
  if (matched.length) await upsertRows(matched.map((m) => ({ targetDomain: domain, refDomain: m.domain, domainRating: m.dr })));
  await upsertAssessments([{ targetDomain: domain, rating: r.rating, category: r.category, detail: r.detail, excludedAt: null }]);
}

// Domain bị hoãn sang nguồn khác (không phải lỗi, không đếm là đã chấm).
class SkipDomain extends Error {}

// Chạy pool concurrency cho danh sách domain với 1 hàm rate 1 domain.
async function runPool(domains: string[], rateOne: (d: string) => Promise<void>, errors: string[]): Promise<number> {
  let cursor = 0, rated = 0;
  const worker = async () => {
    while (cursor < domains.length) {
      const d = domains[cursor++];
      try { await rateOne(d); rated++; }
      catch (e) {
        if (e instanceof SkipDomain) continue;
        if (errors.length < 5) errors.push(`${d}: ${e instanceof Error ? e.message : "lỗi"}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, domains.length) }, () => worker()));
  return rated;
}

// ─── Ahrefs path ────────────────────────────────────────────────────────────────
// Token hết unit giữa chừng → domain đó KHÔNG ghi "API error" mà trả về `leftover`
// để chấm bằng token kế / DFS (trước đây cả batch thành API error, không fallback).
async function rateViaAhrefs(domains: string[], token: string, apiKey: string, blacklist: Set<string>, errors: string[]): Promise<{ rated: number; leftover: string[] }> {
  const leftover: string[] = [];
  let exhausted = false;
  const rated = await runPool(domains, async (domain) => {
    if (exhausted) { leftover.push(domain); throw new SkipDomain(); }
    let matched: Ref[] = [];
    let apiError: string | null = null;
    try {
      const refs = await ahrefsRefDomains(token, domain, MIN_DR);
      matched = refs.filter((r) => !r.isSpam && !blacklist.has(r.domain)).map((r) => ({ domain: r.domain, dr: r.dr }));
    } catch (e) { apiError = e instanceof Error ? e.message : "ahrefs refdomains error"; }
    if (apiError && AHREFS_QUOTA_RE.test(apiError)) { exhausted = true; leftover.push(domain); throw new SkipDomain(); }

    // Ref DR>90 (sạch, Ahrefs có DR sẵn) → bổ sung backlink_db để nhánh DataForSEO (không có DR)
    // cũng khớp được. Chỉ thêm mới / nâng DR, không hạ. Lỗi chỉ log, không ảnh hưởng chấm rating.
    const highDr = matched.filter((m) => m.dr > BACKLINK_DB_ADD_DR);
    if (highDr.length) {
      await mergeRefsKeepMax(highDr).catch((e) =>
        console.error(`[rating] mergeRefsKeepMax ${domain}: ${e instanceof Error ? e.message : e}`));
    }

    // Cờ is_spam của Ahrefs là về SITE trỏ link, không về nội dung anchor → không đưa vào đánh giá.
    let anchors: AnchorIn[] = [];
    if (!apiError && matched.length) {
      anchors = (await ahrefsAnchors(token, domain)).map((a) => ({ text: a.text, weight: a.refdomains }));
    }
    const r = await decide(apiKey, domain, matched, anchors, apiError);
    await writeRating(domain, matched, r);
  }, errors);
  return { rated, leftover };
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
    const unmatched: string[] = [];
    let apiError: string | null = null;
    try {
      const items = await dfsCall<DfsRefItem>(DFS_REFDOMAINS, auth, domain, 100);
      const seen = new Set<string>();
      for (const it of items) {
        const ref = rootDomain(it.domain ?? "");
        if (!ref || seen.has(ref) || blacklist.has(ref)) continue;
        seen.add(ref);
        const dr = drMap.get(ref);
        if (dr == null) { unmatched.push(ref); continue; }
        matched.push({ domain: ref, dr, traffic: trafficMap.get(ref) ?? null });
      }
      matched.sort((a, b) => b.dr - a.dr);
    } catch (e) { apiError = `refdomains: ${e instanceof Error ? e.message : "fetch error"}`; }

    // Lưu ref chưa có trong backlink_db (đã loại blacklist) để check DR sau. Lỗi chỉ log.
    if (unmatched.length) {
      await upsertUnmatchedRefs(unmatched).catch((e) =>
        console.error(`[rating] upsertUnmatchedRefs ${domain}: ${e instanceof Error ? e.message : e}`));
    }

    const dk1 = matched.some((m) => m.dr > 90);
    const dk2 = !dk1 && matched.some((m) => m.dr >= 70 && m.dr <= 89 && (m.traffic ?? 0) >= 1_000_000);
    let anchors: AnchorIn[] = [];
    if (!apiError && (dk1 || dk2)) {
      try {
        const items = await dfsCall<DfsAnchorItem>(DFS_ANCHORS, auth, domain, 30);
        anchors = items.slice(0, 20).map((a) => ({ text: a.anchor ?? "", weight: a.backlinks ?? 0 }));
      } catch { /* anchors phụ trợ */ }
    }
    const plain: Ref[] = matched.map((m) => ({ domain: m.domain, dr: m.dr }));
    const r = await decide(creds.openaiApiKey, domain, plain, anchors, apiError);
    await writeRating(domain, plain, r);
  }, errors);
}

// ─── Entry: chọn nguồn (Ahrefs ưu tiên, hết credit → DFS) ────────────────────────
export async function rateDomains(domainsRaw: string[], creds: RateCreds): Promise<RateResult> {
  const domains = Array.from(new Set(domainsRaw.map((d) => d.trim().toLowerCase()).filter((d) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d))));
  if (!domains.length) return { rated: 0, source: "none", errors: [] };
  if (!creds.openaiApiKey) return { rated: 0, source: "none", errors: ["Thiếu OpenAI API key"] };

  const errors: string[] = [];
  const userBl = await readRefBlacklist().catch(() => []);
  const blacklist = new Set<string>(REF_BLACKLIST_SET);
  for (const e of userBl) blacklist.add(e.domain.toLowerCase());

  // 1) Ahrefs trước — lần lượt các token CÒN credit; token hết unit giữa chừng → phần còn lại sang token kế.
  let remaining = domains;
  let rated = 0;
  let source: RateResult["source"] = "none";
  for (const token of creds.ahrefsTokens) {
    if (!remaining.length) break;
    if (!token?.trim()) continue;
    if (await ahrefsCreditOk(token.trim())) {
      const r = await rateViaAhrefs(remaining, token.trim(), creds.openaiApiKey, blacklist, errors);
      rated += r.rated; remaining = r.leftover; source = "ahrefs";
    }
  }
  if (!remaining.length) return { rated, source, errors };

  // 2) Hết credit Ahrefs (hoặc chưa cấu hình) → DataForSEO cho phần còn lại.
  if (creds.dfsLogin && creds.dfsPassword) {
    rated += await rateViaDfs(remaining, creds, blacklist, errors);
    return { rated, source: "dfs", errors };
  }

  return { rated, source, errors: [...errors, "Ahrefs hết credit và chưa cấu hình DataForSEO"] };
}
