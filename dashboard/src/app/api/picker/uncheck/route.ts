import { NextRequest, NextResponse } from "next/server";
import { deleteChecked } from "@/lib/ahrefs-db";

/**
 * POST /api/picker/uncheck
 *   Body: { domains: string[] }
 *   Bỏ đánh dấu "đã check" (xóa ref + assessment) cho danh sách domain → re-checkable.
 *   Dùng khi đang dev/thiếu dữ liệu, muốn chạy lại các domain đã check.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { domains?: string[] };
    const domains = (body.domains ?? []).filter(Boolean);
    if (!domains.length) return NextResponse.json({ error: "Cần domains: []" }, { status: 400 });
    const res = await deleteChecked(domains);
    return NextResponse.json({ ok: true, cleared: res.count });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
