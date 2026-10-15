import { NextRequest, NextResponse } from "next/server";
import { readReconcileState, isTickHealthy, TICK_STALE_MINUTES } from "@/lib/pipeline-status";
import { supabase } from "@/lib/supabase";

// Số domain mỗi tầng xử lý xong trong 1 giờ qua. Backlog ở trạng thái cân bằng (vào ≈ ra)
// nên đứng yên dù pipeline vẫn chạy — thông lượng mới cho thấy nó có đang chạy hay không.
async function lastHourThroughput() {
  const sb = supabase();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count: c, error } = await q;
    if (error) throw new Error(error.message);
    return c ?? 0;
  };
  const [wayback, gname, rated] = await Promise.all([
    count(sb.from("wayback_results").select("*", { count: "exact", head: true }).gte("checked_at", since)),
    count(sb.from("gname_checks").select("*", { count: "exact", head: true }).gte("checked_at", since)),
    count(sb.from("target_assessment").select("*", { count: "exact", head: true }).gte("updated_at", since).not("rating", "is", null)),
  ]);
  return { wayback, gname, rated };
}

export const dynamic = "force-dynamic";   // heartbeat realtime — không prerender snapshot cũ

/**
 * GET /api/pipeline/status
 *   → trạng thái bộ điều phối tự lành (heartbeat + tồn đọng mỗi tầng). Session-gated
 *   (nằm ngoài /api/n8n, /api/auth → proxy yêu cầu đăng nhập). Webapp poll để hiện
 *   bảng theo dõi + cảnh báo khi tick ngừng chạy.
 */
// ?throughput=1 → kèm `lastHour` (chỉ khung "Pipeline nền" cần; thanh cảnh báo các trang khỏi tốn query).
export async function GET(request: NextRequest) {
  try {
    const state = await readReconcileState();
    const healthy = isTickHealthy(state);
    const ageMin = state.lastTickAt
      ? Math.round((Date.now() - new Date(state.lastTickAt).getTime()) / 60000)
      : null;
    const lastHour = request.nextUrl.searchParams.get("throughput") === "1"
      ? await lastHourThroughput().catch(() => null)
      : undefined;
    return NextResponse.json({ ...state, healthy, ageMin, staleAfterMin: TICK_STALE_MINUTES, lastHour });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
