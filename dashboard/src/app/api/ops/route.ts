import { NextRequest, NextResponse } from "next/server";
import { readOps, writeOps } from "@/lib/ops-settings";

export const dynamic = "force-dynamic";

const mask = (s: string) => (s.length <= 8 ? "••••" : `${s.slice(0, 4)}••••${s.slice(-4)}`);

/** GET — cấu hình vận hành (token Telegram KHÔNG trả về client). */
export async function GET() {
  try {
    const o = await readOps();
    return NextResponse.json({
      hasTelegramToken: !!o.telegramBotToken,
      telegramTokenHint: o.telegramBotToken ? mask(o.telegramBotToken) : "",
      telegramChatId: o.telegramChatId,
      vpsExpiresAt: o.vpsExpiresAt,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

/** POST { telegramBotToken?, telegramChatId?, vpsExpiresAt? } — token trống = giữ nguyên. */
export async function POST(request: NextRequest) {
  try {
    const b = (await request.json().catch(() => ({}))) as { telegramBotToken?: string; telegramChatId?: string; vpsExpiresAt?: string | null };
    const patch: Parameters<typeof writeOps>[0] = {};
    if (typeof b.telegramBotToken === "string") patch.telegramBotToken = b.telegramBotToken;
    if (typeof b.telegramChatId === "string") patch.telegramChatId = b.telegramChatId.trim();
    if (b.vpsExpiresAt !== undefined) {
      if (b.vpsExpiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(b.vpsExpiresAt)) return NextResponse.json({ error: "Ngày không hợp lệ (yyyy-mm-dd)" }, { status: 400 });
      patch.vpsExpiresAt = b.vpsExpiresAt || null;
    }
    await writeOps(patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
