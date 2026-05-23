import { NextResponse } from "next/server";
import { readAllResults } from "@/lib/wayback-db";

/**
 * GET /api/wayback/results
 *   Returns every wayback_results row, newest checked_at first.
 */
export async function GET() {
  try {
    const rows = await readAllResults();
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
