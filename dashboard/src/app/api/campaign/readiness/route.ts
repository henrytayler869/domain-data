import { NextRequest, NextResponse } from "next/server";
import { computeReadiness } from "@/lib/campaign-readiness";

export const dynamic = "force-dynamic";

/**
 * GET /api/campaign/readiness?n=10000[&force=1]
 *   Số dư mọi công cụ trả tiền + checklist + ước tính chi phí cho n domain sắp quét.
 *   force=1 → bỏ cache 15' của credit Apify/DataForSEO. (Session-gated.)
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const nRaw = Number(sp.get("n"));
    const n = Number.isFinite(nRaw) && nRaw >= 0 ? Math.min(Math.round(nRaw), 1_000_000) : 10_000;
    return NextResponse.json(await computeReadiness(n, { forceCredits: sp.get("force") === "1" }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
