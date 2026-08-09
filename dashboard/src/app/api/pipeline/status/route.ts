import { NextResponse } from "next/server";
import { readReconcileState, isTickHealthy, TICK_STALE_MINUTES } from "@/lib/pipeline-status";

export const dynamic = "force-dynamic";   // heartbeat realtime — không prerender snapshot cũ

/**
 * GET /api/pipeline/status
 *   → trạng thái bộ điều phối tự lành (heartbeat + tồn đọng mỗi tầng). Session-gated
 *   (nằm ngoài /api/n8n, /api/auth → proxy yêu cầu đăng nhập). Webapp poll để hiện
 *   bảng theo dõi + cảnh báo khi tick ngừng chạy.
 */
export async function GET() {
  try {
    const state = await readReconcileState();
    const healthy = isTickHealthy(state);
    const ageMin = state.lastTickAt
      ? Math.round((Date.now() - new Date(state.lastTickAt).getTime()) / 60000)
      : null;
    return NextResponse.json({ ...state, healthy, ageMin, staleAfterMin: TICK_STALE_MINUTES });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
