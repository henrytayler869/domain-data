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

// ─── Apify (app_settings key="apify") ───────────────────────────────────────────
// Cho phép đổi tài khoản Apify khi hết credit mà KHÔNG cần sửa .env.local + redeploy.
// Đọc DB trước → fallback env (APIFY_TOKEN / APIFY_WAYBACK_ACTOR_ID).

const APIFY_KEY = "apify";
const DEFAULT_ACTOR = "henry_tayler_869~wayback-machine-actor";

export interface ApifySettings {
  apifyToken: string;      // token tài khoản ĐANG active (server-side only)
  apifyActorId: string;
}

export interface ApifyAccount {
  id: string;
  label: string;
  token: string;           // server-side only
  actorId: string;
}

export interface ApifyConfig {
  accounts: ApifyAccount[];
  activeId: string | null;
}

const apifyEnvDefaults = (): ApifySettings => ({
  apifyToken: process.env.APIFY_TOKEN ?? "",
  apifyActorId: process.env.APIFY_WAYBACK_ACTOR_ID ?? DEFAULT_ACTOR,
});

/** Config đầy đủ (raw token — server only). Tự migrate shape cũ single-token. */
export async function readApifyConfig(): Promise<ApifyConfig> {
  try {
    const sb = supabase();
    const { data, error } = await sb.from(TABLE).select("value").eq("key", APIFY_KEY).maybeSingle();
    if (error) throw new Error(error.message);
    const v = (data?.value ?? null) as (Partial<ApifyConfig> & Partial<ApifySettings>) | null;
    if (v && Array.isArray(v.accounts)) {
      const accounts = v.accounts.filter((a): a is ApifyAccount => !!a && !!a.id);
      return { accounts, activeId: v.activeId ?? accounts[0]?.id ?? null };
    }
    // Migrate shape cũ { apifyToken, apifyActorId } → 1 tài khoản
    if (v && v.apifyToken) {
      const acc: ApifyAccount = { id: "acc1", label: "Tài khoản 1", token: v.apifyToken, actorId: v.apifyActorId || DEFAULT_ACTOR };
      return { accounts: [acc], activeId: acc.id };
    }
  } catch { /* bảng chưa có / lỗi tạm — trả rỗng, resolver dùng env */ }
  return { accounts: [], activeId: null };
}

export async function writeApifyConfig(cfg: ApifyConfig): Promise<void> {
  const sb = supabase();
  const { error } = await sb
    .from(TABLE)
    .upsert({ key: APIFY_KEY, value: cfg, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/** Token/actor của tài khoản ĐANG ACTIVE → fallback env. apify-wayback dùng hàm này. */
export async function readApifySettings(): Promise<ApifySettings> {
  const cfg = await readApifyConfig();
  const active = cfg.accounts.find((a) => a.id === cfg.activeId) ?? cfg.accounts[0] ?? null;
  const env = apifyEnvDefaults();
  return {
    apifyToken: active?.token || env.apifyToken,
    apifyActorId: active?.actorId || env.apifyActorId || DEFAULT_ACTOR,
  };
}

// ─── Mutators (dùng bởi /api/settings/apify) ────────────────────────────────────
export async function apifyAddAccount(label: string, token: string, actorId: string): Promise<void> {
  const cfg = await readApifyConfig();
  const id = crypto.randomUUID();
  cfg.accounts.push({
    id,
    label: label.trim() || `Tài khoản ${cfg.accounts.length + 1}`,
    token: token.trim(),
    actorId: actorId.trim() || DEFAULT_ACTOR,
  });
  if (!cfg.activeId) cfg.activeId = id;   // tài khoản đầu tiên → active luôn
  await writeApifyConfig(cfg);
}

export async function apifyUpdateAccount(id: string, patch: { label?: string; token?: string; actorId?: string }): Promise<void> {
  const cfg = await readApifyConfig();
  const a = cfg.accounts.find((x) => x.id === id);
  if (!a) return;
  if (patch.label?.trim()) a.label = patch.label.trim();
  if (patch.token?.trim()) a.token = patch.token.trim();
  if (patch.actorId?.trim()) a.actorId = patch.actorId.trim();
  await writeApifyConfig(cfg);
}

export async function apifySetActive(id: string): Promise<void> {
  const cfg = await readApifyConfig();
  if (cfg.accounts.some((a) => a.id === id)) {
    cfg.activeId = id;
    await writeApifyConfig(cfg);
  }
}

export async function apifyDeleteAccount(id: string): Promise<void> {
  const cfg = await readApifyConfig();
  cfg.accounts = cfg.accounts.filter((a) => a.id !== id);
  if (cfg.activeId === id) cfg.activeId = cfg.accounts[0]?.id ?? null;
  await writeApifyConfig(cfg);
}
