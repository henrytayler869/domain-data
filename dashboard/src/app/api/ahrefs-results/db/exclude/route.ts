import { NextRequest, NextResponse } from "next/server";
import { upsertRows } from "@/lib/ahrefs-db";

/**
 * Mark targets as "manually excluded" — adds them to the Ahrefs checked list
 * so the domain-picker excludeChecked filter hides them. Used for domains
 * already bought by someone else (not acquirable).
 *
 * Body: { targets: string[] }
 *
 * Strategy: insert a marker row (ref_domain = "__manually_excluded__", DR=0)
 * per target. PK (target_domain, ref_domain) makes this idempotent.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { targets?: string[] };
    const targets = (body.targets ?? [])
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (!targets.length) {
      return NextResponse.json(
        { error: "Cần ít nhất 1 target domain" },
        { status: 400 }
      );
    }
    const rows = targets.map((t) => ({
      targetDomain: t,
      refDomain: "__manually_excluded__",
      domainRating: 0,
    }));
    const result = await upsertRows(rows);
    return NextResponse.json({
      ok: true,
      count: targets.length,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
