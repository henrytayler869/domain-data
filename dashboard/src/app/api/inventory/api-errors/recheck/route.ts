import { NextRequest, NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";
import { upsertAssessments } from "@/lib/ahrefs-db";

/**
 * POST /api/inventory/api-errors/recheck   Body: { domains: string[] }
 *   Gửi lại danh sách domain (bị "API error") tới webhook N8N để chấm lại DataForSEO,
 *   đồng thời đánh dấu assessment "DFS pending" (rating/category=null) → domain rời
 *   khỏi tab Check Lỗi ngay; N8N trả kết quả mới sẽ ghi đè.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { domains?: string[] };
    const domains = Array.from(new Set((body.domains ?? []).map((d) => d.toLowerCase().trim()).filter(Boolean)));
    if (!domains.length) return NextResponse.json({ error: "Không có domain để check lại" }, { status: 400 });

    const { n8nWebhookUrl } = await readSettings();
    if (!n8nWebhookUrl) return NextResponse.json({ error: "Chưa cấu hình Webhook N8N trong Cài đặt" }, { status: 400 });

    const now = new Date().toISOString();
    const BATCH = 140;
    let sent = 0;
    for (let i = 0; i < domains.length; i += BATCH) {
      const batch = domains.slice(i, i + BATCH);
      const res = await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: batch, source: "api-error-recheck", ts: now }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        // xóa category "API error" + đánh dấu chờ → rời tab Check Lỗi; N8N sẽ ghi đè.
        await upsertAssessments(batch.map((d) => ({ targetDomain: d, rating: null, category: null, detail: "DFS pending", excludedAt: null })));
        sent += batch.length;
      }
    }
    if (!sent) return NextResponse.json({ error: "Webhook N8N không nhận (0 gửi được)" }, { status: 502 });
    return NextResponse.json({ ok: true, sent });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
