import { NextRequest, NextResponse } from "next/server";
import { readDb, readTrafficMap } from "@/lib/backlink-db";
import { rootDomain } from "@/lib/root-domain";

/**
 * POST /api/n8n/backlink-compare
 *
 * Endpoint dành cho n8n (nằm NGOÀI session-proxy — xem src/proxy.ts matcher).
 * n8n tự gọi DataforSEO lấy referring domains, rồi gửi list ref sang đây để
 * ĐỐI CHIẾU với backlink_db đã thu thập → trả DR + traffic.
 *
 * Auth: bắt buộc header `Authorization: Bearer <N8N_API_TOKEN>` (hoặc
 * `x-n8n-token`). Nếu env N8N_API_TOKEN chưa set → 503 (không để hở dữ liệu).
 *
 * Body: { target?: string, refs: string[] }
 *   - refs: ref domain thô từ DataforSEO (có thể là subdomain) → tự gộp về root.
 *
 * Response: {
 *   ok, target, total, matchedCount, unmatchedCount,
 *   matched:   [{ domain, dr, traffic }]  // có trong DB, sort DR desc
 *   unmatched: string[]                    // root chưa có trong DB
 *   refsString: "d1 (DR 95); d2 (DR 92); ..."   // sẵn cho cột refs của CSV
 *   maxDr, dk1Count                         // dk1Count = ref DR > 90
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const expected = process.env.N8N_API_TOKEN;
    if (!expected) {
      return NextResponse.json(
        { error: "N8N_API_TOKEN chưa cấu hình trên server" },
        { status: 503 },
      );
    }
    const auth = request.headers.get("authorization") || "";
    const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const provided = bearer || request.headers.get("x-n8n-token") || "";
    if (provided !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { target?: string; refs?: unknown };
    const rawRefs = Array.isArray(body.refs) ? body.refs : [];
    const target = typeof body.target === "string" ? body.target.toLowerCase().trim() : null;

    // Gộp ref về root + dedup.
    const roots = Array.from(new Set(
      rawRefs
        .map((r) => rootDomain(String(r ?? "")))
        .filter((r) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(r)),
    ));

    // Lookup DR + traffic từ backlink_db.
    const [dbEntries, trafficRows] = await Promise.all([readDb(), readTrafficMap()]);
    const drMap = new Map(dbEntries.map((e) => [e.domain.toLowerCase(), e.dr]));
    const trafficMap = new Map(trafficRows.map((r) => [r.domain.toLowerCase(), r.traffic]));

    const matched: { domain: string; dr: number; traffic: number | null }[] = [];
    const unmatched: string[] = [];
    for (const root of roots) {
      const dr = drMap.get(root);
      if (dr == null) {
        unmatched.push(root);
      } else {
        matched.push({ domain: root, dr, traffic: trafficMap.get(root) ?? null });
      }
    }
    matched.sort((a, b) => b.dr - a.dr);

    const refsString = matched.map((m) => `${m.domain} (DR ${m.dr})`).join("; ");
    const maxDr = matched.length ? matched[0].dr : 0;
    const dk1Count = matched.filter((m) => m.dr > 90).length;

    return NextResponse.json({
      ok: true,
      target,
      total: roots.length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      matched,
      unmatched,
      refsString,
      maxDr,
      dk1Count,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
