import { NextResponse } from "next/server";
import { readTrafficMap } from "@/lib/backlink-db";

/**
 * GET /api/backlink-db/traffic
 * Trả ref domain có traffic (DR 70-89 đã điền) → dùng cho điều kiện 2 của
 * Domain Picker (ref DR 70-89 + traffic >= 1M).
 */
export async function GET() {
  try {
    const rows = await readTrafficMap();
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
