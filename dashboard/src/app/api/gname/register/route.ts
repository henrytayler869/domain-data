import { NextRequest, NextResponse } from "next/server";
import { registerDomain, GnameRegisterResult } from "@/lib/gname";
import { upsertEntries } from "@/lib/inventory-db";
import { markExcluded } from "@/lib/ahrefs-db";

/**
 * POST /api/gname/register
 * Body: {
 *   domains: string[],
 *   meta?: Record<string, { source?: string|null, rating?: string|null, category?: string|null }>
 * }
 *
 * Submits a real registration order to Gname for each domain (SPENDS MONEY —
 * the UI must confirm first). Successful orders are saved into
 * domain_inventory with the actual frozen price and marked excluded in the
 * picker. Premium domains (code -3) are never auto-confirmed.
 *
 * Domains are processed sequentially — Gname rate-limits aggressive clients
 * and order volume here is small (manually selected).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      domains?: string[];
      meta?: Record<string, { source?: string | null; rating?: string | null; category?: string | null }>;
    };
    const domains = Array.from(new Set(
      (body.domains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean)
    ));
    if (!domains.length) {
      return NextResponse.json({ error: "Cần ít nhất 1 domain" }, { status: 400 });
    }
    if (domains.length > 50) {
      return NextResponse.json(
        { error: "Tối đa 50 domain mỗi lần để tránh mua nhầm số lượng lớn" },
        { status: 400 }
      );
    }

    const results: GnameRegisterResult[] = [];
    for (const d of domains) {
      results.push(await registerDomain(d));
    }

    const succeeded = results.filter((r) => r.ok);

    // Save successful orders into inventory with the real charged price.
    if (succeeded.length > 0) {
      const meta = body.meta ?? {};
      await upsertEntries(succeeded.map((r) => ({
        domain: r.domain,
        purchasePrice: r.price,
        source: meta[r.domain]?.source ?? null,
        rating: meta[r.domain]?.rating ?? null,
        category: meta[r.domain]?.category ?? null,
        notes: `Gname API: ${r.msg}`.slice(0, 500),
      })));
      await markExcluded(succeeded.map((r) => r.domain));
    }

    return NextResponse.json({
      ok: true,
      results,
      succeeded: succeeded.length,
      failed: results.length - succeeded.length,
      totalCharged: succeeded.reduce((a, r) => a + (r.price ?? 0), 0),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
