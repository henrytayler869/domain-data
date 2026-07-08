import { NextRequest, NextResponse } from "next/server";
import { startGateJob } from "@/lib/gname-gate";

/**
 * POST /api/picker/gate/start   Body: { domains: string[] }
 *   Tạo job check Gname chạy NỀN server-side → trả { jobId } ngay.
 *   Browser poll /api/picker/gate/status?jobId=... để theo tiến độ.
 *   (Session-gated — gọi từ Domain Picker.)
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { domains?: string[] };
    const domains = Array.isArray(body.domains) ? body.domains : [];
    if (!domains.length) {
      return NextResponse.json({ error: "Cần domains: []" }, { status: 400 });
    }
    const jobId = await startGateJob(domains);
    return NextResponse.json({ jobId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
