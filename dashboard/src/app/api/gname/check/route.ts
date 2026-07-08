import { NextRequest, NextResponse } from "next/server";
import { checkDomainsMany, statusOf } from "@/lib/gname";

/**
 * POST /api/gname/check
 *   Body: { domains: string[] }
 *   Gọi Gname `/api/domain/check` cho từng domain (server-side, cần IP đã whitelist
 *   trên Gname → chạy trên VPS). Trả `status` để Domain Picker Bước 3 dùng:
 *     available  — mua được ngay (giá register lấy từ bảng gname_pricing)
 *     premium    — available nhưng premium → không tự mua
 *     registered — đã có người đăng ký → chưa mua được
 *     error      — check lỗi (IP chưa whitelist / mạng / rate-limit)
 *
 *   Response: { results: [{ domain, status }] }  (cùng shape với /api/rdap/check cũ)
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { domains?: string[] };
    const domains = Array.from(new Set(
      (body.domains ?? []).map((d) => d.toLowerCase().trim()).filter(Boolean),
    ));
    if (!domains.length) return NextResponse.json({ results: [] });

    const checks = await checkDomainsMany(domains);
    const results = checks.map((c) => ({
      domain: c.domain,
      // backorderable (registered + đang rớt, Gname dropcatch) → "backorder"; registered thuần → không mua được
      status: statusOf(c),
      dropEta: c.deletionDate,
      ...(request.nextUrl.searchParams.get("debug") ? { code: c.code, msg: c.msg } : {}),
    }));
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
