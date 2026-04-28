import { NextRequest, NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";

const AHREFS_BASE = "https://api.ahrefs.com/v3";

export interface AhrefsRefDomain {
  domain: string;
  dr: number;    // domain_rating (rounded)
  links: number; // links_to_target
}

export interface AhrefsDomainResult {
  domain: string;
  qualifiedCount: number;         // referring domains with DR >= minDr (up to limitPerDomain)
  maxDr: number;                  // highest DR among qualified referring domains
  limitReached: boolean;          // true if qualifiedCount === limitPerDomain (there may be more)
  qualifiedDomains: AhrefsRefDomain[]; // all qualified referring domains returned
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

    const settings = await readSettings();
    const apiKey = settings.ahrefsApiKey;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Chưa cấu hình Ahrefs API Key. Vào Settings để nhập." },
        { status: 400 }
      );
    }

    // Normalize domain names
    const normalizedDomains = domains.map((d) =>
      d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "")
    );

    const limit = Math.min(limitPerDomain, 1000);

    // Call Ahrefs for each domain in parallel
    const results: AhrefsDomainResult[] = await Promise.all(
      normalizedDomains.map(async (domain): Promise<AhrefsDomainResult> => {
        try {
          const params = new URLSearchParams({
            target: domain,
            select: "domain,domain_rating,links_to_target",
            mode: "subdomains",
            history: "live",
            limit: String(limit),
            order_by: "domain_rating:desc",
            // Pre-filter: only referring domains with DR >= minDr
            where: JSON.stringify({ field: "domain_rating", is: ["gte", minDr] }),
          });

          const res = await fetch(
            `${AHREFS_BASE}/site-explorer/refdomains?${params}`,
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: "application/json",
              },
              cache: "no-store",
            }
          );

          if (!res.ok) {
            const errText = await res.text().catch(() => `HTTP ${res.status}`);
            return {
              domain,
              qualifiedCount: 0,
              maxDr: 0,
              limitReached: false,
              qualifiedDomains: [],
              error: `Ahrefs: ${errText}`,
            } satisfies AhrefsDomainResult;
          }

          const data = await res.json();
          const items: Array<{
            domain: string;
            domain_rating: number;
            links_to_target: number;
          }> = data.refdomains ?? [];

          const qualifiedDomains: AhrefsRefDomain[] = items.map((i) => ({
            domain: i.domain,
            dr: Math.round(i.domain_rating),
            links: i.links_to_target ?? 0,
          }));

          return {
            domain,
            qualifiedCount: qualifiedDomains.length,
            maxDr: qualifiedDomains[0]?.dr ?? 0,
            limitReached: qualifiedDomains.length === limit,
            qualifiedDomains,
          } satisfies AhrefsDomainResult;
        } catch (err) {
          return {
            domain,
            qualifiedCount: 0,
            maxDr: 0,
            limitReached: false,
            qualifiedDomains: [],
            error: err instanceof Error ? err.message : "Unknown error",
          } satisfies AhrefsDomainResult;
        }
      })
    );

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
