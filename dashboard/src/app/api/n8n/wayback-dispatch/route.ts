import { NextRequest, NextResponse } from "next/server";
import { dispatchTick } from "@/lib/wayback-dispatch";

/**
 * POST /api/n8n/wayback-dispatch
 *
 * 1 "tick" drip-feed Wayback (gọi định kỳ bởi scheduler — N8N Schedule mỗi ~20-30
 * phút, hoặc cron). Sweep run xong → gửi clean chưa rating qua DFS → dispatch thêm
 * Wayback lấp đầy 32 slot Apify. NGOÀI session-proxy (xem src/proxy.ts).
 *
 * Auth: header `Authorization: Bearer <N8N_API_TOKEN>` (hoặc `x-n8n-token`).
 */
export async function POST(request: NextRequest) {
  try {
    const expected = process.env.N8N_API_TOKEN;
    if (!expected) return NextResponse.json({ error: "N8N_API_TOKEN chưa cấu hình" }, { status: 503 });
    const auth = request.headers.get("authorization") || "";
    const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const provided = bearer || request.headers.get("x-n8n-token") || "";
    if (provided !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const summary = await dispatchTick();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
