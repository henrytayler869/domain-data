import { NextRequest, NextResponse } from "next/server";
import { deleteEntries } from "@/lib/inventory-db";
import { markExcluded } from "@/lib/ahrefs-db";

/**
 * Remove a set of domains from inventory AND mark them excluded in the
 * picker (target_assessment.excluded_at). Atomically handles the most
 * common "domain failed to acquire" flow:
 *  - Failed backorder → not actually owned, drop from kho
 *  - Don't want it reappearing in the Ahrefs picker either
 *
 * Body: { domains: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { domains?: string[] };
    const domains = (body.domains ?? [])
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    if (!domains.length) {
      return NextResponse.json(
        { error: "Cần ít nhất 1 domain" },
        { status: 400 },
      );
    }
    // Best-effort: do both. If exclude fails, the inventory row is still
    // gone — caller can re-trigger exclude later via the picker page.
    const delResult = await deleteEntries(domains);
    const exResult = await markExcluded(domains);
    return NextResponse.json({
      ok: true,
      deletedFromInventory: delResult.deleted,
      excludedInPicker: exResult.count,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
