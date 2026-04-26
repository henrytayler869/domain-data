import { NextRequest, NextResponse } from "next/server";

const CSV_URL =
  "https://d3ry1h4w5036x1.cloudfront.net/reports/Namecheap_Market_Sales_Buy_Now.csv";

export interface Domain {
  domainName: string;
  tld: string;
  price: number;
  priceText: string;
  buyUrl: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const priceMin = parseFloat(searchParams.get("priceMin") ?? "0");
  const priceMax = parseFloat(searchParams.get("priceMax") ?? "200");
  const tldsParam = searchParams.get("tlds") ?? "";
  const tldSet = new Set(
    tldsParam
      ? tldsParam
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      : []
  );

  try {
    const res = await fetch(CSV_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DomainScraper/1.0)" },
      next: { revalidate: 3600 }, // cache 1 hour (CSV updates hourly)
    });

    if (!res.ok) throw new Error(`CSV fetch failed: HTTP ${res.status}`);

    const text = await res.text();
    const lines = text.split("\n");
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

    const domainIdx = headers.indexOf("domain");
    const priceIdx = headers.indexOf("price");
    const permalinkIdx = headers.indexOf("permalink");

    if (domainIdx < 0 || priceIdx < 0) {
      throw new Error("Unexpected CSV format");
    }

    const domains: Domain[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(",");
      const domain = (cols[domainIdx] ?? "").toLowerCase().trim();
      const priceStr = (cols[priceIdx] ?? "").trim();
      const permalink = (cols[permalinkIdx] ?? "").trim();

      if (!domain || !priceStr) continue;

      const dotIdx = domain.indexOf(".");
      if (dotIdx < 0) continue;
      const tld = domain.slice(dotIdx + 1);

      if (tldSet.size > 0 && !tldSet.has(tld)) continue;

      const price = parseFloat(priceStr);
      if (isNaN(price) || price < priceMin || price > priceMax) continue;

      domains.push({
        domainName: domain,
        tld,
        price,
        priceText: `$${price.toFixed(2)}`,
        buyUrl:
          permalink || `https://www.namecheap.com/market/buynow/${domain}/`,
      });
    }

    // sort by price ascending
    domains.sort((a, b) => a.price - b.price);

    return NextResponse.json({ domains, total: domains.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
