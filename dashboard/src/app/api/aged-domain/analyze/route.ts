import { NextRequest, NextResponse } from "next/server";
import { readDb } from "@/lib/backlink-db";
import { readSettings } from "@/lib/settings";
import { upsertRows, upsertAssessments } from "@/lib/ahrefs-db";

const DATAFORSEO_ENDPOINT =
  "https://api.dataforseo.com/v3/backlinks/referring_domains/live";

interface DfsReferringDomain {
  domain: string;
  backlinks: number;
}

export interface TopDomain {
  domain: string;
  dbDr: number | null; // DR from our Backlink DB (null = not in DB)
  backlinks: number;
  inDb: boolean;
}

export interface DomainResult {
  domain: string;
  totalRefDomains: number;
  dbMatches: number;      // ref domains in DB with DR ≥ minDr
  maxDbDr: number;
  topDomains: TopDomain[];
  error?: string;
}

// Gộp subdomain về root để khớp backlink_db (lưu root). svnesterov.blogspot.com
// → blogspot.com; sub.example.co.uk → example.co.uk.
const MULTI_SLD = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "mil"]);
function rootDomain(host: string): string {
  const h = String(host || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  const p = h.split(".").filter(Boolean);
  if (p.length <= 2) return h;
  const last = p[p.length - 1], sld = p[p.length - 2];
  if (last.length === 2 && MULTI_SLD.has(sld)) return p.slice(-3).join(".");
  return p.slice(-2).join(".");
}

export async function POST(request: NextRequest) {
  try {
    const {
      domains,
      minDr = 30,
      limitPerDomain = 100,
      persist = true,
    }: { domains: string[]; minDr: number; limitPerDomain: number; persist?: boolean } =
      await request.json();

    if (!domains?.length) {
      return NextResponse.json({ error: "No domains provided" }, { status: 400 });
    }

    const settings = await readSettings();
    const login = settings.dataforseoLogin;
    const password = settings.dataforseoPassword;
    if (!login || !password) {
      return NextResponse.json(
        { error: "Chưa cấu hình DataforSEO credentials. Vào Settings để nhập API Key." },
        { status: 400 }
      );
    }
    const auth = Buffer.from(`${login}:${password}`).toString("base64");

    const targets = Array.from(new Set(
      domains
        .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
        .filter((d) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d))
    ));
    if (!targets.length) {
      return NextResponse.json({ error: "Không có domain hợp lệ" }, { status: 400 });
    }

    // DR lookup từ backlink_db.
    const dbEntries = await readDb();
    const dbMap = new Map<string, number>(dbEntries.map((e) => [e.domain.toLowerCase(), e.dr]));
    const lim = Math.min(Math.max(limitPerDomain, 1), 1000);

    const results: DomainResult[] = new Array(targets.length);
    const unmatchedMap = new Map<string, number>(); // root domain chưa có DR → max backlinks
    // Để persist vào store dùng chung với Domain Picker (ahrefs_results): mọi ref
    // có DR trong DB (KHÔNG lọc minDr — Picker tự áp ngưỡng) + marker đã check.
    const refsRows: { targetDomain: string; refDomain: string; domainRating: number }[] = [];
    const processedTargets = new Set<string>();
    let dfsCost = 0;

    // referring_domains/live CHỈ nhận 1 task/request → gọi 1 domain/request,
    // concurrency 6.
    const CONCURRENCY = 6;
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const i = cursor++;
        const target = targets[i];
        try {
          const res = await fetch(DATAFORSEO_ENDPOINT, {
            method: "POST",
            headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
            body: JSON.stringify([{ target, limit: lim, order_by: ["backlinks,desc"] }]),
            signal: AbortSignal.timeout(120_000),
          });
          if (!res.ok) {
            results[i] = { domain: target, totalRefDomains: 0, dbMatches: 0, maxDbDr: 0, topDomains: [], error: `HTTP ${res.status}` };
            continue;
          }
          const data = await res.json();
          dfsCost += data.cost ?? 0;
          const task = data.tasks?.[0];
          if (!task || task.status_code !== 20000 || !task.result?.[0]) {
            results[i] = { domain: target, totalRefDomains: 0, dbMatches: 0, maxDbDr: 0, topDomains: [], error: task?.status_message ?? "No data" };
            continue;
          }
          const result = task.result[0];
          const items: DfsReferringDomain[] = result.items ?? [];
          processedTargets.add(target); // query thành công → đã check
          // Gộp ref về root + giữ max backlinks/root.
          const refRoots = new Map<string, number>();
          for (const it of items) {
            const ref = rootDomain(it.domain ?? "");
            if (!ref) continue;
            refRoots.set(ref, Math.max(refRoots.get(ref) ?? 0, it.backlinks ?? 0));
          }
          const matched: { domain: string; dr: number; backlinks: number }[] = [];
          for (const [ref, bl] of refRoots) {
            const dr = dbMap.get(ref);
            if (dr == null) {
              unmatchedMap.set(ref, Math.max(unmatchedMap.get(ref) ?? 0, bl));
            } else {
              // Ref có DR trong DB → lưu vào store dùng chung (full, không lọc minDr).
              refsRows.push({ targetDomain: target, refDomain: ref, domainRating: dr });
              if (dr >= minDr) matched.push({ domain: ref, dr, backlinks: bl });
            }
          }
          matched.sort((a, b) => b.dr - a.dr);
          const topDomains: TopDomain[] = [...refRoots.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([domain, backlinks]) => {
              const dr = dbMap.get(domain) ?? null;
              return { domain, dbDr: dr, backlinks, inDb: dr !== null };
            });
          results[i] = {
            domain: target,
            totalRefDomains: result.total_count ?? refRoots.size,
            dbMatches: matched.length,
            maxDbDr: matched.length ? matched[0].dr : 0,
            topDomains,
          };
        } catch (e) {
          results[i] = { domain: target, totalRefDomains: 0, dbMatches: 0, maxDbDr: 0, topDomains: [], error: e instanceof Error ? e.message : "fetch error" };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()));

    // Lưu vào store dùng chung với Domain Picker (ahrefs_results + target_assessment)
    // → Picker thấy ngay kết quả này, KHÔNG cần gọi lại DataforSEO. Không chặn
    // response nếu persist lỗi.
    let persisted = false;
    if (persist && processedTargets.size > 0) {
      try {
        if (refsRows.length > 0) await upsertRows(refsRows);
        await upsertAssessments(
          [...processedTargets].map((target) => ({
            targetDomain: target,
            rating: null,
            category: null,
            detail: "DataforSEO checked",
            excludedAt: null,
          })),
        );
        persisted = true;
      } catch {
        persisted = false;
      }
    }

    const unmatchedRefs = [...unmatchedMap.entries()]
      .map(([domain, backlinks]) => ({ domain, backlinks }))
      .sort((a, b) => b.backlinks - a.backlinks)
      .slice(0, 5000);

    return NextResponse.json({
      results,
      cost: dfsCost,
      unmatchedUnique: unmatchedMap.size,
      unmatchedRefs,
      persisted,
      refsSaved: refsRows.length,
      targetsChecked: processedTargets.size,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
