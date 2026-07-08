import { NextResponse } from "next/server";
import { countActiveRuns } from "@/lib/apify-wayback";

/**
 * GET /api/wayback/active → { active }  số Apify run đang chiếm slot (RUNNING+READY).
 * Client dùng để throttle startWayback dưới giới hạn concurrent của Apify (32).
 */
export async function GET() {
  try {
    return NextResponse.json({ active: await countActiveRuns() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error", active: 0 }, { status: 500 });
  }
}
