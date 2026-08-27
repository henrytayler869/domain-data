import { NextRequest, NextResponse } from "next/server";
import {
  readApifyConfig,
  apifyAddAccount,
  apifyUpdateAccount,
  apifySetActive,
  apifyDeleteAccount,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

function mask(s: string): string {
  if (!s) return "";
  if (s.length <= 6) return "••••••";
  return s.slice(0, 4) + "••••••" + s.slice(-4);
}

// GET — danh sách tài khoản (token KHÔNG trả raw, chỉ hint) + activeId
export async function GET() {
  try {
    const cfg = await readApifyConfig();
    return NextResponse.json({
      activeId: cfg.activeId,
      accounts: cfg.accounts.map((a) => ({
        id: a.id,
        label: a.label,
        actorId: a.actorId,
        hasToken: !!a.token,
        tokenHint: mask(a.token),
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

// POST { action: "add"|"update"|"activate"|"delete", ... }
export async function POST(request: NextRequest) {
  try {
    const b = await request.json();
    switch (b.action) {
      case "add":
        if (!b.token?.trim()) return NextResponse.json({ error: "Thiếu token" }, { status: 400 });
        await apifyAddAccount(b.label ?? "", b.token ?? "", b.actorId ?? "");
        break;
      case "update":
        await apifyUpdateAccount(b.id, { label: b.label, token: b.token, actorId: b.actorId });
        break;
      case "activate":
        await apifySetActive(b.id);
        break;
      case "delete":
        await apifyDeleteAccount(b.id);
        break;
      default:
        return NextResponse.json({ error: "action không hợp lệ" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
