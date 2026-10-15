/**
 * Cấu hình vận hành (app_settings key="ops"): Telegram nhận cảnh báo, hạn VPS, và trạng
 * thái cảnh báo đã gửi (chống spam). Tách khỏi settings.ts (credentials API) cho gọn.
 */

import { supabase } from "./supabase";

const TABLE = "app_settings";
const KEY = "ops";

export interface AlertMark { active: boolean; sentAt: string | null; msg: string }

export interface OpsSettings {
  telegramBotToken: string;   // server-side only
  telegramChatId: string;
  vpsExpiresAt: string | null; // ISO date (yyyy-mm-dd) — nhập tay, VPS không có API
  alerts: Record<string, AlertMark>;
  campaignDone: boolean;       // đã báo "đợt quét xong" cho lần backlog về 0 gần nhất
}

const EMPTY: OpsSettings = { telegramBotToken: "", telegramChatId: "", vpsExpiresAt: null, alerts: {}, campaignDone: false };

export async function readOps(): Promise<OpsSettings> {
  try {
    const { data, error } = await supabase().from(TABLE).select("value").eq("key", KEY).maybeSingle();
    if (error) throw new Error(error.message);
    return { ...EMPTY, ...((data?.value ?? {}) as Partial<OpsSettings>) };
  } catch {
    return { ...EMPTY };
  }
}

/** Gộp patch vào record hiện tại. Token để trống = giữ nguyên (giống các key khác). */
export async function writeOps(patch: Partial<OpsSettings>): Promise<OpsSettings> {
  const cur = await readOps();
  const next: OpsSettings = {
    ...cur,
    ...patch,
    telegramBotToken: patch.telegramBotToken?.trim() ? patch.telegramBotToken.trim() : cur.telegramBotToken,
  };
  const { error } = await supabase()
    .from(TABLE)
    .upsert({ key: KEY, value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return next;
}
