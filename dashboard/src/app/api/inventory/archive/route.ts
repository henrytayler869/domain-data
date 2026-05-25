import { NextRequest, NextResponse } from "next/server";
import { setArchived } from "@/lib/inventory-db";

/**
 * Soft-archive / unarchive inventory rows.
 * Body: { domains: string[], archived?: boolean (default true) }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { domains?: string[]; archived?: boolean };
    const domains = body.domains ?? [];
    const archived = body.archived !== false; // default true
    if (!domains.length) {
      return NextResponse.json(
        { error: "Cần ít nhất 1 domain" },
        { status: 400 },
      );
    }
    const result = await setArchived(domains, archived);
    return NextResponse.json({ ok: true, archived, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
