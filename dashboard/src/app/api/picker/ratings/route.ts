import { NextRequest, NextResponse } from "next/server";
import { readAssessmentsFor } from "@/lib/ahrefs-db";

/**
 * POST /api/picker/ratings
 *   Body: { domains: string[] }
 *   Trả rating (Tốt/Trung bình/xấu) từ target_assessment cho danh sách domain —
 *   Domain Picker Bước 6 dùng để lọc domain đáng mua (sau khi DataForSEO/N8N ghi rating).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { domains?: string[] };
    const domains = (body.domains ?? []).filter(Boolean);
    if (!domains.length) return NextResponse.json({ assessments: [] });
    return NextResponse.json({ assessments: await readAssessmentsFor(domains) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
