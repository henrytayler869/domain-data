import { NextResponse } from "next/server";
import { readApifySettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const AB = "https://api.apify.com/v2";

// GET — test token Apify hiện tại: trả username + credit (usage/limit) + actor tồn tại?
export async function GET() {
  try {
    const { apifyToken, apifyActorId } = await readApifySettings();
    if (!apifyToken) return NextResponse.json({ ok: false, error: "Chưa có token Apify" });

    const me = await fetch(`${AB}/users/me?token=${apifyToken}`, { cache: "no-store" });
    const meBody = await me.json().catch(() => ({}));
    if (!me.ok) {
      return NextResponse.json({ ok: false, error: `Token không hợp lệ (${me.status})` });
    }
    const username = meBody?.data?.username ?? null;

    // Hạn mức / usage tháng
    let monthlyUsageUsd: number | null = null;
    let maxMonthlyUsageUsd: number | null = null;
    let maxConcurrentRuns: number | null = null;
    try {
      const lim = await (await fetch(`${AB}/users/me/limits?token=${apifyToken}`, { cache: "no-store" })).json();
      const L = lim?.data ?? {};
      monthlyUsageUsd = L.current?.monthlyUsageUsd ?? L.currentUsageCycle?.usageUsd ?? null;
      maxMonthlyUsageUsd = L.limits?.maxMonthlyUsageUsd ?? null;
      maxConcurrentRuns = L.limits?.maxConcurrentActorJobs ?? L.limits?.actorMaxConcurrentRuns ?? null;
    } catch { /* limits optional */ }

    // Actor tồn tại + truy cập được?
    let actorOk = false;
    try {
      const a = await fetch(`${AB}/acts/${encodeURIComponent(apifyActorId)}?token=${apifyToken}`, { cache: "no-store" });
      actorOk = a.ok;
    } catch { /* ignore */ }

    return NextResponse.json({
      ok: true,
      username,
      monthlyUsageUsd,
      maxMonthlyUsageUsd,
      maxConcurrentRuns,
      actorId: apifyActorId,
      actorOk,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Lỗi kết nối" });
  }
}
