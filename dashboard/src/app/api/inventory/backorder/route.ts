import { NextRequest, NextResponse } from "next/server";
import { setBackorder } from "@/lib/inventory-db";

/**
 * Flip the is_backorder flag for one or more inventory rows.
 * Used when a backorder is confirmed (isBackorder: false) so the row
 * counts as a regular purchase from now on.
 *
 * Body: { domains: string[], isBackorder?: boolean (default false) }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { domains?: string[]; isBackorder?: boolean };
    const domains = body.domains ?? [];
    const isBackorder = body.isBackorder ?? false; // default = "confirm"
    if (!domains.length) {
      return NextResponse.json(
        { error: "Cần ít nhất 1 domain" },
        { status: 400 },
      );
    }
    const result = await setBackorder(domains, isBackorder);
    return NextResponse.json({ ok: true, isBackorder, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
