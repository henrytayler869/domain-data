import { NextRequest, NextResponse } from "next/server";
import { resolveAccount, getBackorderChannelsRaw } from "@/lib/gname";

export const dynamic = "force-dynamic";

// GET ?id=<accountId> — test 1 tài khoản Gname (trống = mặc định) bằng call chỉ-đọc
// /api/backorder/channel: kiểm tra appid/appkey đúng + IP server đã whitelist.
export async function GET(request: NextRequest) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    const acc = await resolveAccount(id || null);
    const r = await getBackorderChannelsRaw(acc);
    if (r.code !== 1) return NextResponse.json({ ok: false, error: r.msg || `code ${r.code}` });
    return NextResponse.json({ ok: true, appid: acc.appid, channels: Array.isArray(r.data) ? r.data.length : 0 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Lỗi kết nối" });
  }
}
