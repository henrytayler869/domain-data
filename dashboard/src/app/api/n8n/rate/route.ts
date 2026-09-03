import { NextRequest, NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";
import { rateDomains } from "@/lib/rating-engine";
import { readTargetSummaryFor } from "@/lib/ahrefs-db";

/**
 * POST /api/n8n/rate   Body: { domains: string[] }
 *   Chấm rating 1 danh sách domain NGAY (Ahrefs ưu tiên → fallback DataForSEO → Haiku),
 *   đọc lại kết quả trả về. Dùng để test/chấm tay 1 batch nhỏ. Token-authed (gọi nội bộ).
 *
 * Auth: Authorization: Bearer <N8N_API_TOKEN> (giống các route /api/n8n/*).
 */
export async function POST(request: NextRequest) {
  try {
    const expected = process.env.N8N_API_TOKEN;
    if (!expected) return NextResponse.json({ error: "N8N_API_TOKEN chưa cấu hình" }, { status: 503 });
    const auth = request.headers.get("authorization") || "";
    const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    if ((bearer || request.headers.get("x-n8n-token") || "") !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { domains?: string[] };
    const domains = Array.from(new Set((body.domains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean))).slice(0, 20);
    if (!domains.length) return NextResponse.json({ error: "Cần domains: [...]" }, { status: 400 });

    const s = await readSettings();
    const r = await rateDomains(domains, {
      ahrefsTokens: [s.ahrefsToken1, s.ahrefsToken2].filter(Boolean),
      dfsLogin: s.dataforseoLogin,
      dfsPassword: s.dataforseoPassword,
      anthropicApiKey: s.anthropicApiKey,
    });

    // Đọc lại rating vừa ghi để xem kết quả.
    const summaries = await readTargetSummaryFor(domains);
    const byDomain = new Map(summaries.map((x) => [x.targetDomain.toLowerCase(), x]));
    const results = domains.map((d) => {
      const x = byDomain.get(d);
      return { domain: d, rating: x?.rating ?? null, category: x?.category ?? null, refs: x?.refs.length ?? 0, detail: (x?.detail ?? "").slice(0, 120) };
    });

    return NextResponse.json({ ok: true, source: r.source, rated: r.rated, errors: r.errors, results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
