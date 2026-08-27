import { NextRequest, NextResponse } from "next/server";
import { readApifyConfig, readApifySettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const AB = "https://api.apify.com/v2";

// GET ?id=<accountId> — test token 1 tài khoản (hoặc active nếu không có id):
// trả username + credit (usage/limit) + actor truy cập được không.
export async function GET(request: NextRequest) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    let token = "", actorId = "";
    if (id) {
      const cfg = await readApifyConfig();
      const a = cfg.accounts.find((x) => x.id === id);
      if (!a) return NextResponse.json({ ok: false, error: "Không tìm thấy tài khoản" });
      token = a.token; actorId = a.actorId;
    } else {
      const s = await readApifySettings();
      token = s.apifyToken; actorId = s.apifyActorId;
    }
    if (!token) return NextResponse.json({ ok: false, error: "Chưa có token" });

    const me = await fetch(`${AB}/users/me?token=${token}`, { cache: "no-store" });
    const meBody = await me.json().catch(() => ({}));
    if (!me.ok) return NextResponse.json({ ok: false, error: `Token không hợp lệ (${me.status})` });
    const username = meBody?.data?.username ?? null;

    let monthlyUsageUsd: number | null = null;
    let maxMonthlyUsageUsd: number | null = null;
    let maxConcurrentRuns: number | null = null;
    try {
      const lim = await (await fetch(`${AB}/users/me/limits?token=${token}`, { cache: "no-store" })).json();
      const L = lim?.data ?? {};
      monthlyUsageUsd = L.current?.monthlyUsageUsd ?? L.currentUsageCycle?.usageUsd ?? null;
      maxMonthlyUsageUsd = L.limits?.maxMonthlyUsageUsd ?? null;
      maxConcurrentRuns = L.limits?.maxConcurrentActorJobs ?? L.limits?.actorMaxConcurrentRuns ?? null;
    } catch { /* limits optional */ }

    let actorOk = false;
    try {
      const a = await fetch(`${AB}/acts/${encodeURIComponent(actorId)}?token=${token}`, { cache: "no-store" });
      actorOk = a.ok;
    } catch { /* ignore */ }

    return NextResponse.json({ ok: true, username, monthlyUsageUsd, maxMonthlyUsageUsd, maxConcurrentRuns, actorId, actorOk });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Lỗi kết nối" });
  }
}
