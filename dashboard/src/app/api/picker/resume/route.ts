import { NextRequest, NextResponse } from "next/server";
import { readResumeCandidates } from "@/lib/picker-resume";

/**
 * GET /api/picker/resume?hours=12
 *   Trả các domain "mua được + clean" gần đây (kèm rating nếu có) để khôi phục
 *   Bước 6 sau khi tab bị đóng/reload giữa chừng. (Session-gated.)
 */
export async function GET(request: NextRequest) {
  try {
    const hoursRaw = Number(request.nextUrl.searchParams.get("hours"));
    const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? Math.min(hoursRaw, 72) : 12;
    const candidates = await readResumeCandidates(hours);
    return NextResponse.json({ total: candidates.length, candidates });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
