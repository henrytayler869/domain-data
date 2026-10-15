/**
 * Cấu hình vận hành (app_settings key="ops"): hạn VPS (nhập tay — VPS không có API báo hạn),
 * dùng cho trang "Chuẩn bị đợt quét". Tách khỏi settings.ts (credentials API) cho gọn.
 */

import { supabase } from "./supabase";

const TABLE = "app_settings";
const KEY = "ops";

export interface OpsSettings {
  vpsExpiresAt: string | null; // yyyy-mm-dd
}

export async function readOps(): Promise<OpsSettings> {
  try {
    const { data, error } = await supabase().from(TABLE).select("value").eq("key", KEY).maybeSingle();
    if (error) throw new Error(error.message);
    const v = (data?.value ?? {}) as Partial<OpsSettings>;
    return { vpsExpiresAt: v.vpsExpiresAt ?? null };
  } catch {
    return { vpsExpiresAt: null };
  }
}

export async function writeOps(patch: Partial<OpsSettings>): Promise<OpsSettings> {
  const next: OpsSettings = { ...(await readOps()), ...patch };
  const { error } = await supabase()
    .from(TABLE)
    .upsert({ key: KEY, value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return next;
}
