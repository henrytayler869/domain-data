import { NextRequest, NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";
import { rateDomains } from "@/lib/rating-engine";
import { upsertAssessments } from "@/lib/ahrefs-db";

/**
 * POST /api/inventory/api-errors/recheck   Body: { domains: string[] }
 *   Chấm lại danh sách domain (bị "API error") NGAY trong webapp (DataForSEO + Claude
 *   Haiku), thay cho webhook N8N. Chấm đồng bộ tối đa CAP domain (Cloudflare ~100s);
 *   phần dư đánh dấu "DFS pending" → rời tab Check Lỗi ngay + reconciler chấm dần.
 */
const SYNC_CAP = 40;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { domains?: string[] };
    const domains = Array.from(new Set((body.domains ?? []).map((d) => d.toLowerCase().trim()).filter(Boolean)));
    if (!domains.length) return NextResponse.json({ error: "Không có domain để check lại" }, { status: 400 });

    const s = await readSettings();
    const hasRefSource = !!(s.ahrefsToken1 || s.ahrefsToken2 || (s.dataforseoLogin && s.dataforseoPassword));
    if (!s.anthropicApiKey || !hasRefSource) {
      return NextResponse.json({ error: "Chưa cấu hình Anthropic API key + (Ahrefs token hoặc DataForSEO) trong Cài đặt" }, { status: 400 });
    }

    const toRateNow = domains.slice(0, SYNC_CAP);
    const overflow = domains.slice(SYNC_CAP);

    // Phần dư: đánh dấu "DFS pending" ngay → xóa category "API error" → rời tab Check Lỗi;
    // reconciler chấm ở tick sau. (Làm trước để UI phản hồi kể cả khi rate lâu.)
    if (overflow.length) {
      await upsertAssessments(overflow.map((d) => ({ targetDomain: d, rating: null, category: null, detail: "DFS pending", excludedAt: null })));
    }

    const r = await rateDomains(toRateNow, {
      ahrefsTokens: [s.ahrefsToken1, s.ahrefsToken2].filter(Boolean),
      dfsLogin: s.dataforseoLogin,
      dfsPassword: s.dataforseoPassword,
      anthropicApiKey: s.anthropicApiKey,
    });

    return NextResponse.json({ ok: true, sent: r.rated, queued: overflow.length, errors: r.errors });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
