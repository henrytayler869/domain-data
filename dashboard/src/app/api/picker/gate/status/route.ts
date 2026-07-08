import { NextRequest, NextResponse } from "next/server";
import { getGateJob } from "@/lib/gname-gate";

/**
 * GET /api/picker/gate/status?jobId=...
 *   Trả tiến độ + kết quả job gate (progress counts + result buckets).
 *   (Session-gated — poll từ Domain Picker.)
 */
export async function GET(request: NextRequest) {
  try {
    const jobId = request.nextUrl.searchParams.get("jobId");
    if (!jobId) return NextResponse.json({ error: "Cần jobId" }, { status: 400 });
    const job = await getGateJob(jobId);
    if (!job) return NextResponse.json({ error: "Job không tồn tại" }, { status: 404 });
    return NextResponse.json(job);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
