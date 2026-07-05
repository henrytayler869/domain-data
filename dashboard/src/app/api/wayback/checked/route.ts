import { NextResponse } from "next/server";
import { listCheckedDomains } from "@/lib/wayback-db";

/** GET /api/wayback/checked — domain đã check Wayback (kèm cờ flagged / no-snapshot). */
export async function GET() {
  try {
    return NextResponse.json({ checked: await listCheckedDomains() });
  } catch {
    return NextResponse.json({ checked: [] });
  }
}
