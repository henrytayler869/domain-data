/**
 * Rating engine — CHẠY THẲNG TRONG WEBAPP (thay cho workflow N8N "DataforSEO
 * Backlink Checker"). Cho mỗi domain:
 *   1. DataForSEO referring_domains/live  → ref domains.
 *   2. Đối chiếu backlink_db (DR + traffic) + lọc ref_blacklist → matched refs.
 *   3. Nếu ĐK1 (ref DR>90) hoặc ĐK2 (ref DR70-89 & traffic≥1M) → lấy anchors/live.
 *   4. Claude Haiku phân loại (prompt y hệt node "Classify" trong N8N) → {rating, category, detail}.
 *   5. Ghi target_assessment (rating/category/detail) + ahrefs_results (matched refs).
 *
 * Không phụ thuộc N8N. Anthropic key + DataForSEO creds đọc từ Settings (app_settings).
 */

import { readDb, readTrafficMap } from "./backlink-db";
import { rootDomain } from "./root-domain";
import { REF_BLACKLIST_SET } from "./picker-csv";
import { readAll as readRefBlacklist } from "./ref-blacklist-db";
import { upsertRows, upsertAssessments } from "./ahrefs-db";

const DFS_REFDOMAINS = "https://api.dataforseo.com/v3/backlinks/referring_domains/live";
const DFS_ANCHORS = "https://api.dataforseo.com/v3/backlinks/anchors/live";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5";   // Claude Haiku 4.5 — giống node N8N
const CONCURRENCY = 5;

// Prompt phân loại — sao y node "Classify" (system message) trong workflow N8N.
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

export interface RateCreds { dfsLogin: string; dfsPassword: string; anthropicApiKey: string }
export interface RateResult { rated: number; errors: string[] }

interface DfsRefItem { domain?: string; backlinks?: number }
interface DfsAnchorItem { anchor?: string; backlinks?: number }

// Gọi 1 task DataForSEO live (referring_domains hoặc anchors) cho 1 target.
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

// Gọi Claude Haiku phân loại. Trả {rating, category, detail} hoặc ném lỗi (để caller
// đánh dấu credit-flag). Parse JSON theo cùng cách node "Build & Append Row".
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

export async function rateDomains(domainsRaw: string[], creds: RateCreds): Promise<RateResult> {
  const domains = Array.from(new Set(domainsRaw.map((d) => d.trim().toLowerCase()).filter((d) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d))));
  if (!domains.length) return { rated: 0, errors: [] };
  if (!creds.anthropicApiKey || !creds.dfsLogin || !creds.dfsPassword) {
    return { rated: 0, errors: ["Thiếu Anthropic key hoặc DataForSEO creds"] };
  }

  // Nạp 1 lần: DR + traffic + blacklist (hardcoded + user-added).
  const [dbEntries, trafficRows, userBl] = await Promise.all([readDb(), readTrafficMap(), readRefBlacklist().catch(() => [])]);
  const drMap = new Map(dbEntries.map((e) => [e.domain.toLowerCase(), e.dr]));
  const trafficMap = new Map(trafficRows.map((r) => [r.domain.toLowerCase(), r.traffic]));
  const blacklist = new Set<string>(REF_BLACKLIST_SET);
  for (const e of userBl) blacklist.add(e.domain.toLowerCase());
  const auth = Buffer.from(`${creds.dfsLogin}:${creds.dfsPassword}`).toString("base64");

  const errors: string[] = [];
  let rated = 0;

  const rateOne = async (domain: string) => {
    let api_error: string | null = null;
    const matched: { domain: string; dr: number; traffic: number | null }[] = [];
    // 1) referring_domains → matched refs (đã lọc blacklist).
    try {
      const items = await dfsCall<DfsRefItem>(DFS_REFDOMAINS, auth, domain, 100);
      const seen = new Set<string>();
      for (const it of items) {
        const ref = rootDomain(it.domain ?? "");
        if (!ref || seen.has(ref) || blacklist.has(ref)) continue;
        seen.add(ref);
        const dr = drMap.get(ref);
        if (dr == null) continue;                       // chưa có DR trong DB → bỏ (giống backlink-compare)
        matched.push({ domain: ref, dr, traffic: trafficMap.get(ref) ?? null });
      }
      matched.sort((a, b) => b.dr - a.dr);
    } catch (e) {
      api_error = `refdomains: ${e instanceof Error ? e.message : "fetch error"}`;
    }

    const refsString = matched.map((m) => `${m.domain} (DR ${m.dr})`).join("; ");
    const maxDr = matched.length ? matched[0].dr : 0;
    const dk1Count = matched.filter((m) => m.dr > 90).length;
    const dk1 = dk1Count > 0;
    const dk2 = !dk1 && matched.some((m) => m.dr >= 70 && m.dr <= 89 && (m.traffic ?? 0) >= 1_000_000);

    // 2) anchors chỉ cho domain ĐK1/ĐK2 (tiết kiệm credit) — dựng anchors_compact.
    let anchorsCompact = "";
    if (!api_error && (dk1 || dk2)) {
      try {
        const anchors = await dfsCall<DfsAnchorItem>(DFS_ANCHORS, auth, domain, 30);
        anchorsCompact = anchors.slice(0, 20).map((a) => `${a.anchor ?? ""} (${a.backlinks ?? 0})`).join(" | ").slice(0, 1500);
      } catch { /* anchors phụ trợ — lỗi không chặn */ }
    }

    // 3) Phân loại: rút gọn các case tất định (khỏi tốn token AI); còn lại gọi Haiku.
    let rating: string, category: string, detail: string;
    if (api_error) {
      rating = "⚠️ RỦI RO"; category = "API error"; detail = api_error;
    } else if (matched.length === 0) {
      rating = "⚠️ RỦI RO"; category = "No matched backlinks"; detail = "Không có ref nào khớp DB";
    } else {
      const out = await classify(creds.anthropicApiKey, {
        domain, refs_count: matched.length, max_dr: maxDr, dk1_count: dk1Count,
        refs_string: refsString, anchors_compact: anchorsCompact, api_error: null,
      });
      rating = out.rating; category = out.category;
      const isErr = category === "API error" || category === "Parse error";
      // detail = ref-summary (giống node Build & Append) trừ khi lỗi → cho picker/valuation.
      detail = isErr ? out.detail : `DR>90:${dk1Count} | ${refsString}`;
    }

    // 4) Ghi ahrefs_results (matched refs) + target_assessment. Bọc lỗi để không chặn cả batch.
    try {
      if (matched.length) {
        await upsertRows(matched.map((m) => ({ targetDomain: domain, refDomain: m.domain, domainRating: m.dr })));
      }
      await upsertAssessments([{ targetDomain: domain, rating, category, detail, excludedAt: null }]);
      rated++;
    } catch (e) {
      if (errors.length < 5) errors.push(`${domain}: ghi DB lỗi ${e instanceof Error ? e.message : ""}`);
    }
  };

  // Pool concurrency có giới hạn.
  let cursor = 0;
  const worker = async () => {
    while (cursor < domains.length) {
      const d = domains[cursor++];
      try { await rateOne(d); }
      catch (e) { if (errors.length < 5) errors.push(`${d}: ${e instanceof Error ? e.message : "lỗi"}`); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, domains.length) }, () => worker()));

  return { rated, errors };
}
