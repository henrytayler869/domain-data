import { NextResponse } from "next/server";
import { readOps } from "@/lib/ops-settings";
import { sendTelegram, vnTime } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** POST — gửi tin thử tới Telegram đã cấu hình. */
export async function POST() {
  const o = await readOps();
  const r = await sendTelegram(o.telegramBotToken, o.telegramChatId,
    `<b>DomainData · ${vnTime()}</b>\n\n✅ Tin thử: cảnh báo pipeline sẽ gửi về đây (sắp hết tiền, pipeline dừng, đợt quét xong).`);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
