import { NextResponse } from "next/server";
import { readAll as readAllAhrefs } from "@/lib/ahrefs-db";
import { readDb as readBacklinks, upsertEntries as upsertBacklinks } from "@/lib/backlink-db";

/**
 * One-shot backfill: aggregate ahrefs_results.ref_domain × MAX(domain_rating)
 * and merge into backlink_db with GREATEST(existing, new) semantics so we
 * never downgrade a DR that was already higher.
 *
 * Idempotent — safe to run multiple times.
 */
export async function POST() {
  try {
    // 1) Load every ref row, aggregate by ref_domain → MAX dr.
    const ahrefsRows = await readAllAhrefs();
    const drByRef = new Map<string, number>();
    for (const r of ahrefsRows) {
      if (!r.refDomain || r.refDomain === "__manually_excluded__") continue;
      const prev = drByRef.get(r.refDomain) ?? 0;
      if (r.domainRating > prev) drByRef.set(r.refDomain, r.domainRating);
    }

    // 2) Load current backlink_db so we can keep MAX(existing, new) and skip
    //    unchanged rows (reduces upsert traffic).
    const existing = await readBacklinks();
    const existingMap = new Map(existing.map((e) => [e.domain, e.dr]));

    const toUpsert: { domain: string; dr: number }[] = [];
    let skipped = 0;
    for (const [domain, newDr] of drByRef) {
      const oldDr = existingMap.get(domain) ?? -1;
      const finalDr = Math.max(oldDr, newDr);
      if (finalDr === oldDr) {
        skipped++;
        continue;
      }
      toUpsert.push({ domain, dr: finalDr });
    }

    // 3) Upsert in batches via existing helper.
    const result = await upsertBacklinks(toUpsert);

    return NextResponse.json({
      ok: true,
      ahrefsRowsScanned: ahrefsRows.length,
      uniqueRefDomains: drByRef.size,
      existingBacklinksBefore: existing.length,
      skippedUnchanged: skipped,
      upserted: toUpsert.length,
      addedNew: result.added,
      totalAfter: result.total,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
