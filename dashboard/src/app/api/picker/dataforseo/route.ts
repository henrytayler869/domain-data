import { NextRequest, NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";
import { rateDomains } from "@/lib/rating-engine";
import { upsertAssessments } from "@/lib/ahrefs-db";

/**
 * POST /api/picker/dataforseo
 *   Body: { domains: string[] }
 *   Chấm rating danh sách domain Clean NGAY trong webapp (DataForSEO + Claude Haiku),
 *   thay cho việc gửi webhook N8N trước đây.
 *
 * Route này đi qua trình duyệt → Cloudflare (giới hạn ~100s) nên chỉ chấm đồng bộ tối đa
 * CAP domain/lần; phần dư đánh dấu "DFS pending" để reconciler (cron nội bộ) chấm dần.
 */
const SYNC_CAP = 40;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { domains?: string[] };
    const domains = Array.from(new Set(
      (body.domains ?? []).map((d) => d.toLowerCase().trim()).filter(Boolean),
    ));
    if (!domains.length) return NextResponse.json({ error: "Không có domain để chấm" }, { status: 400 });

    const s = await readSettings();
    if (!s.anthropicApiKey || !s.dataforseoLogin || !s.dataforseoPassword) {
      return NextResponse.json(
        { error: "Chưa cấu hình Anthropic API key + DataForSEO trong Cài đặt" },
        { status: 400 },
      );
    }

    const toRateNow = domains.slice(0, SYNC_CAP);
    const overflow = domains.slice(SYNC_CAP);

    const r = await rateDomains(toRateNow, {
      dfsLogin: s.dataforseoLogin,
      dfsPassword: s.dataforseoPassword,
      anthropicApiKey: s.anthropicApiKey,
    });

    // Phần dư → placeholder "DFS pending" cho reconciler chấm ở các tick sau (không mất domain).
    if (overflow.length) {
      await upsertAssessments(overflow.map((d) => ({ targetDomain: d, rating: null, category: null, detail: "DFS pending", excludedAt: null })));
    }

    return NextResponse.json({ ok: true, sent: r.rated, queued: overflow.length, errors: r.errors });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
