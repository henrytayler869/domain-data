import { NextRequest, NextResponse } from "next/server";
import { checkRdapMany } from "@/lib/rdap";

/**
 * POST /api/rdap/check
 *   Body: { domains: string[] }
 *   Tra RDAP cho danh sách domain BẤT KỲ (không ghi DB) → dùng cho Domain Picker.
 *   Trả { results: [{ domain, status, dropEta, expiration }] }.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { domains?: string[] };
    const domains = Array.from(new Set(
      (body.domains ?? []).map((d) => d.toLowerCase().trim()).filter(Boolean),
    ));
    if (!domains.length) return NextResponse.json({ results: [] });
    const results = await checkRdapMany(domains, 5);
    return NextResponse.json({
      results: results.map((r) => ({ domain: r.domain, status: r.status, dropEta: r.dropEta, expiration: r.expiration })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
