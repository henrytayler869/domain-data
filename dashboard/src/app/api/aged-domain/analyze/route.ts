import { NextRequest, NextResponse } from "next/server";
import { readDb } from "@/lib/backlink-db";

const DATAFORSEO_ENDPOINT =
  "https://api.dataforseo.com/v3/backlinks/referring_domains/live";

// Referring domain as returned by DataforSEO (we only care about domain + backlinks count)
interface DfsReferringDomain {
  domain: string;
  backlinks: number; // number of backlinks from this referring domain
}

export interface TopDomain {
  domain: string;
  dbDr: number | null; // DR from our Backlink DB (null = not in DB)
  backlinks: number;   // backlink count from DataforSEO
  inDb: boolean;
}

export interface DomainResult {
  domain: string;
  totalRefDomains: number;  // total referring domains (DataforSEO count)
  dbMatches: number;        // referring domains found in DB with DR ≥ minDr
  maxDbDr: number;          // highest DB DR among matched referring domains
  topDomains: TopDomain[];  // top referring domains (with DB DR if available)
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const {
      domains,
      minDr = 30,
      limitPerDomain = 100,
    }: { domains: string[]; minDr: number; limitPerDomain: number } =
      await request.json();

    if (!domains?.length) {
      return NextResponse.json({ error: "No domains provided" }, { status: 400 });
    }

    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;
    if (!login || !password) {
      return NextResponse.json(
        { error: "DataforSEO credentials not configured in .env.local" },
        { status: 500 }
      );
    }

    const auth = Buffer.from(`${login}:${password}`).toString("base64");

    // Normalize domain names
    const normalizedDomains = domains.map((d) =>
      d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "")
    );

    // Build tasks — one per domain
    // Sort by backlinks_count desc so we get the most-linked referring domains first
    const tasks = normalizedDomains.map((domain) => ({
      target: domain,
      limit: Math.min(limitPerDomain, 1000),
      order_by: ["backlinks_count,desc"],
    }));

    // ── Call DataforSEO (all domains in one batch request) ─────────────────────
    const dfsRes = await fetch(DATAFORSEO_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(tasks),
    });

    if (!dfsRes.ok) {
      const errText = await dfsRes.text();
      return NextResponse.json(
        { error: `DataforSEO API error: ${errText}` },
        { status: 502 }
      );
    }

    const dfsData = await dfsRes.json();

    // ── Load Backlink DB ───────────────────────────────────────────────────────
    // DB is the SOLE source of DR for referring domains.
    // DataforSEO only tells us WHICH domains link back — DR comes from our DB.
    const dbEntries = await readDb();
    const dbMap = new Map<string, number>(dbEntries.map((e) => [e.domain, e.dr]));

    // ── Process each task result ───────────────────────────────────────────────
    const results: DomainResult[] = (dfsData.tasks ?? []).map(
      (task: {
        status_code: number;
        status_message: string;
        data: { target: string };
        result?: {
          total_count?: number;
          items?: DfsReferringDomain[];
        }[];
      }) => {
        const target = task.data?.target ?? "unknown";

        if (task.status_code !== 20000 || !task.result?.[0]) {
          return {
            domain: target,
            totalRefDomains: 0,
            dbMatches: 0,
            maxDbDr: 0,
            topDomains: [],
            error: task.status_message ?? "No data from DataforSEO",
          } satisfies DomainResult;
        }

        const result = task.result[0];
        const items: DfsReferringDomain[] = result.items ?? [];
        const totalRefDomains: number = result.total_count ?? 0;

        // ── Cross-reference with Backlink DB ──────────────────────────────────
        // For each referring domain returned by DataforSEO:
        //   → look up DR in our DB
        //   → count as a "match" if in DB AND DB DR ≥ minDr
        const matched = items
          .map((i) => ({ ...i, dbDr: dbMap.get(i.domain) ?? null }))
          .filter((i): i is typeof i & { dbDr: number } =>
            i.dbDr !== null && i.dbDr >= minDr
          );

        const dbMatches = matched.length;
        const maxDbDr =
          matched.length > 0 ? Math.max(...matched.map((i) => i.dbDr)) : 0;

        // Top 10 referring domains (those DataforSEO returned, annotated with DB DR)
        const topDomains: TopDomain[] = items.slice(0, 10).map((i) => {
          const dbDr = dbMap.get(i.domain) ?? null;
          return {
            domain: i.domain,
            dbDr,
            backlinks: i.backlinks,
            inDb: dbDr !== null,
          };
        });

        return {
          domain: target,
          totalRefDomains,
          dbMatches,
          maxDbDr,
          topDomains,
        } satisfies DomainResult;
      }
    );

    return NextResponse.json({ results, cost: dfsData.cost ?? null });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
