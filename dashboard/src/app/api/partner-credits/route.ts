import { NextRequest, NextResponse } from "next/server";
import { getPartnerCredits } from "@/lib/partner-credits";

export const dynamic = "force-dynamic";

/**
 * GET /api/partner-credits[?force=1]
 *   → credit Apify / DataforSEO (cache 15' trong DB; force=1 bỏ qua cache).
 *   Session-gated qua proxy.
 */
export async function GET(request: NextRequest) {
  try {
    const force = new URL(request.url).searchParams.get("force") === "1";
    const credits = await getPartnerCredits(force);
    delete credits.credsHash; // hash key không gửi xuống client
    return NextResponse.json(credits);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi" }, { status: 500 });
  }
}
