/** Gửi tin nhắn Telegram (bot API). Trả lỗi dạng chuỗi thay vì ném — cảnh báo không được làm hỏng tick. */
export async function sendTelegram(token: string, chatId: string, html: string): Promise<{ ok: boolean; error: string | null }> {
  if (!token || !chatId) return { ok: false, error: "Chưa cấu hình Telegram" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    return j.ok ? { ok: true, error: null } : { ok: false, error: j.description ?? `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Giờ GMT+7 dạng "16/10 14:05" cho tin nhắn. */
export function vnTime(d = new Date()): string {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}
