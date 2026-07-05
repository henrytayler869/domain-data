import { NextResponse } from "next/server";
import { readGnamePricing } from "@/lib/gname-pricing";

/** GET /api/gname/pricing — giá register + backorder theo TLD (do pipeline ghi). */
export async function GET() {
  try {
    return NextResponse.json({ pricing: await readGnamePricing() });
  } catch {
    return NextResponse.json({ pricing: [] });
  }
}
