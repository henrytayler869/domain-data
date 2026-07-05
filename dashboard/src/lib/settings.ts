/**
 * Dashboard Settings — stored in Supabase (table: app_settings, key="dataforseo").
 * Passwords/API keys are never returned to the client after being saved.
 *
 * Migrated off Apify KV Store. A one-time lazy fallback still reads the old
 * Apify KV record if Supabase is empty, and copies it into Supabase so the
 * credential survives the move without the user re-entering it. That legacy
 * fallback can be deleted once everyone has migrated.
 */

import { supabase } from "./supabase";

const TABLE = "app_settings";
const KEY = "dataforseo";

export interface Settings {
  dataforseoLogin: string;
  dataforseoPassword: string; // stored server-side only
  n8nWebhookUrl: string;      // webhook N8N nhận domain Clean → DataForSEO
}

const envDefaults = (): Settings => ({
  dataforseoLogin: process.env.DATAFORSEO_LOGIN ?? "",
  dataforseoPassword: process.env.DATAFORSEO_PASSWORD ?? "",
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL ?? "",
});

async function readFromSupabase(): Promise<Settings | null> {
  const sb = supabase();
  const { data, error } = await sb.from(TABLE).select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const v = (data?.value ?? null) as Partial<Settings> | null;
  if (!v || (!v.dataforseoLogin && !v.dataforseoPassword && !v.n8nWebhookUrl)) return null;
  return {
    dataforseoLogin: v.dataforseoLogin ?? "",
    dataforseoPassword: v.dataforseoPassword ?? "",
    n8nWebhookUrl: v.n8nWebhookUrl ?? "",
  };
}

async function writeToSupabase(s: Settings): Promise<void> {
  const sb = supabase();
  const { error } = await sb
    .from(TABLE)
    .upsert({ key: KEY, value: s, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

// ─── Legacy: one-time read from the old Apify KV store ──────────────────────
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const LEGACY_STORE_NAME = "dashboard-settings";
const LEGACY_STORE_KEY = "SETTINGS";
const APIFY_BASE = "https://api.apify.com/v2";

async function readLegacyApify(): Promise<Settings | null> {
  if (!APIFY_TOKEN) return null;
  try {
    const r = await fetch(`${APIFY_BASE}/key-value-stores?token=${APIFY_TOKEN}&limit=100`, { cache: "no-store" });
    const data = await r.json();
    const match = (data.data?.items ?? []).find(
      (s: { name: string; id: string }) => s.name === LEGACY_STORE_NAME,
    );
    if (!match) return null;
    const rr = await fetch(
      `${APIFY_BASE}/key-value-stores/${match.id}/records/${LEGACY_STORE_KEY}?token=${APIFY_TOKEN}`,
      { cache: "no-store" },
    );
    if (!rr.ok) return null;
    const v = await rr.json();
    if (!v?.dataforseoLogin && !v?.dataforseoPassword) return null;
    return {
      dataforseoLogin: v.dataforseoLogin ?? "",
      dataforseoPassword: v.dataforseoPassword ?? "",
      n8nWebhookUrl: "",
    };
  } catch {
    return null;
  }
}

export async function readSettings(): Promise<Settings> {
  // 1) Supabase (nguồn chính). Bọc try riêng để nếu bảng chưa tồn tại / lỗi
  //    thì vẫn rơi xuống legacy fallback chứ không gãy.
  try {
    const fromSb = await readFromSupabase();
    if (fromSb) return fromSb;
  } catch { /* table missing or transient error — fall through */ }

  // 2) Legacy Apify KV → trả về + auto-migrate sang Supabase (1 lần).
  const legacy = await readLegacyApify();
  if (legacy) {
    try { await writeToSupabase(legacy); } catch { /* bảng có thể chưa tạo — bỏ qua */ }
    return legacy;
  }

  // 3) Env fallback.
  return envDefaults();
}

export async function writeSettings(settings: Partial<Settings>): Promise<void> {
  const current = await readSettings();
  const merged: Settings = {
    dataforseoLogin: settings.dataforseoLogin ?? current.dataforseoLogin,
    dataforseoPassword:
      settings.dataforseoPassword?.trim()
        ? settings.dataforseoPassword
        : current.dataforseoPassword,
    n8nWebhookUrl: settings.n8nWebhookUrl ?? current.n8nWebhookUrl,
  };
  await writeToSupabase(merged);
}
