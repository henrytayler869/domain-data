import { NextRequest, NextResponse } from "next/server";
import {
  readGnameConfig,
  gnameAddAccount,
  gnameUpdateAccount,
  gnameSetDefault,
  gnameDeleteAccount,
} from "@/lib/settings";
import { clearGnameAccountCache } from "@/lib/gname";

export const dynamic = "force-dynamic";

function mask(s: string): string {
  if (!s) return "";
  if (s.length <= 6) return "••••••";
  return s.slice(0, 3) + "••••••" + s.slice(-3);
}

// GET — danh sách tài khoản (appkey KHÔNG trả raw, chỉ hint) + defaultId.
// Trang mua (Domain Picker / Aged Domain) cũng gọi để hiện ô chọn tài khoản.
export async function GET() {
  try {
    const cfg = await readGnameConfig();
    return NextResponse.json({
      defaultId: cfg.defaultId,
      accounts: cfg.accounts.map((a) => ({
        id: a.id,
        label: a.label,
        appid: a.appid,
        hasAppkey: !!a.appkey,
        appkeyHint: mask(a.appkey),
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

// POST { action: "add"|"update"|"default"|"delete", ... }
export async function POST(request: NextRequest) {
  try {
    const b = await request.json();
    switch (b.action) {
      case "add":
        if (!b.appid?.trim() || !b.appkey?.trim()) return NextResponse.json({ error: "Thiếu appid hoặc appkey" }, { status: 400 });
        await gnameAddAccount(b.label ?? "", b.appid, b.appkey);
        break;
      case "update":
        await gnameUpdateAccount(b.id, { label: b.label, appid: b.appid, appkey: b.appkey });
        break;
      case "default":
        await gnameSetDefault(b.id);
        break;
      case "delete":
        await gnameDeleteAccount(b.id);
        break;
      default:
        return NextResponse.json({ error: "action không hợp lệ" }, { status: 400 });
    }
    clearGnameAccountCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
