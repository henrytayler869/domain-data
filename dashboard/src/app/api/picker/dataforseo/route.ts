import { NextRequest, NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";

/**
 * POST /api/picker/dataforseo
 *   Body: { domains: string[] }
 *   Gửi danh sách domain Clean tới webhook N8N (cấu hình trong Cài đặt) để check
 *   DataForSEO. N8N nhận payload { domains, source, ts }.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { domains?: string[] };
    const domains = Array.from(new Set(
      (body.domains ?? []).map((d) => d.toLowerCase().trim()).filter(Boolean),
    ));
    if (!domains.length) return NextResponse.json({ error: "Không có domain để gửi" }, { status: 400 });

    const { n8nWebhookUrl } = await readSettings();
    if (!n8nWebhookUrl) {
      return NextResponse.json({ error: "Chưa cấu hình Webhook N8N trong Cài đặt" }, { status: 400 });
    }

    const res = await fetch(n8nWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domains, source: "domain-picker", ts: new Date().toISOString() }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Webhook N8N trả ${res.status}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sent: domains.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
