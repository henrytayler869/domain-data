import { NextRequest, NextResponse } from "next/server";
import { markExcluded } from "@/lib/ahrefs-db";

/**
 * Mark targets as "manually excluded" by setting target_assessment.excluded_at.
 * Used for domains already bought by someone else, and as a piggyback from the
 * "Đã mua" flow so purchased domains stop appearing in the picker.
 *
 * Body: { targets: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { targets?: string[] };
    const targets = (body.targets ?? [])
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (!targets.length) {
      return NextResponse.json(
        { error: "Cần ít nhất 1 target domain" },
        { status: 400 }
      );
    }
    const result = await markExcluded(targets);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
