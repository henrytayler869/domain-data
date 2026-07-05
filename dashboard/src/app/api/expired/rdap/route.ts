import { NextRequest, NextResponse } from "next/server";
import { checkRdapMany } from "@/lib/rdap";
import { readAll, updateRdap } from "@/lib/expired-db";

/**
 * POST /api/expired/rdap
 *   Body: { domains?: string[] }  — nếu rỗng thì check TẤT CẢ candidate status='new'.
 *   Tra RDAP cho từng domain → cập nhật rdap_status / rdap_checked_at / drop_eta.
 *   Trả { checked, summary: { <status>: count } }.
 *
 * Chỉ check domain CÓ trong expired_candidates (giao với danh sách gửi lên) để
 * updateRdap không đụng domain lạ.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { domains?: string[] };
    const all = await readAll();
    const existing = new Set(all.map((e) => e.domain));

    let domains: string[];
    if (body.domains?.length) {
      domains = Array.from(new Set(
        body.domains.map((d) => d.toLowerCase().trim()).filter((d) => existing.has(d)),
      ));
    } else {
      domains = all.filter((e) => e.status === "new").map((e) => e.domain);
    }
    if (!domains.length) return NextResponse.json({ checked: 0, summary: {} });

    const results = await checkRdapMany(domains, 5);
    await updateRdap(results.map((r) => ({ domain: r.domain, rdapStatus: r.status, dropEta: r.dropEta })));

    const summary: Record<string, number> = {};
    for (const r of results) summary[r.status] = (summary[r.status] ?? 0) + 1;
    return NextResponse.json({ checked: results.length, summary });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
