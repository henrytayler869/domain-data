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
  n8nWebhookUrl: string;      // webhook N8N nhận domain Clean → DataForSEO (legacy; rating giờ chạy trong webapp)
  anthropicApiKey: string;    // stored server-side only — dùng cho rating (Claude Haiku) chạy thẳng trong webapp
  ahrefsToken1: string;       // MCP token Ahrefs #1 (ưu tiên) — server-side only
  ahrefsToken2: string;       // MCP token Ahrefs #2 (dự phòng) — server-side only
  ahrefsToken3: string;       // MCP token Ahrefs #3 (dự phòng) — server-side only
}

const envDefaults = (): Settings => ({
  dataforseoLogin: process.env.DATAFORSEO_LOGIN ?? "",
  dataforseoPassword: process.env.DATAFORSEO_PASSWORD ?? "",
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  ahrefsToken1: process.env.AHREFS_MCP_TOKEN_1 ?? "",
  ahrefsToken2: process.env.AHREFS_MCP_TOKEN_2 ?? "",
  ahrefsToken3: process.env.AHREFS_MCP_TOKEN_3 ?? "",
});

async function readFromSupabase(): Promise<Settings | null> {
  const sb = supabase();
  const { data, error } = await sb.from(TABLE).select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const v = (data?.value ?? null) as Partial<Settings> | null;
  if (!v || (!v.dataforseoLogin && !v.dataforseoPassword && !v.n8nWebhookUrl && !v.anthropicApiKey && !v.ahrefsToken1 && !v.ahrefsToken2 && !v.ahrefsToken3)) return null;
  return {
    dataforseoLogin: v.dataforseoLogin ?? "",
    dataforseoPassword: v.dataforseoPassword ?? "",
    n8nWebhookUrl: v.n8nWebhookUrl ?? "",
    anthropicApiKey: v.anthropicApiKey ?? "",
    ahrefsToken1: v.ahrefsToken1 ?? "",
    ahrefsToken2: v.ahrefsToken2 ?? "",
    ahrefsToken3: v.ahrefsToken3 ?? "",
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
      anthropicApiKey: "",
      ahrefsToken1: "",
      ahrefsToken2: "",
      ahrefsToken3: "",
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
    // Chỉ ghi đè khi có giá trị mới (giống password) — lưu field khác không xoá key.
    anthropicApiKey:
      settings.anthropicApiKey?.trim()
        ? settings.anthropicApiKey
        : current.anthropicApiKey,
    ahrefsToken1:
      settings.ahrefsToken1?.trim() ? settings.ahrefsToken1 : current.ahrefsToken1,
    ahrefsToken2:
      settings.ahrefsToken2?.trim() ? settings.ahrefsToken2 : current.ahrefsToken2,
    ahrefsToken3:
      settings.ahrefsToken3?.trim() ? settings.ahrefsToken3 : current.ahrefsToken3,
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

/** Config đầy đủ (raw token — server only). Tự migrate shape cũ + seed token ENV. */
export async function readApifyConfig(): Promise<ApifyConfig> {
  const env = apifyEnvDefaults();
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
    // Chưa có row (data null) + có token ENV → seed 1 lần thành "Tài khoản (ENV)" active,
    // để UI hiện đúng tài khoản pipeline đang chạy. Sau khi có row (kể cả rỗng) thì KHÔNG re-seed.
    if (data === null && env.apifyToken) {
      const acc: ApifyAccount = { id: crypto.randomUUID(), label: "Tài khoản (ENV)", token: env.apifyToken, actorId: env.apifyActorId };
      const cfg: ApifyConfig = { accounts: [acc], activeId: acc.id };
      try { await writeApifyConfig(cfg); } catch { /* bảng chưa có — bỏ qua */ }
      return cfg;
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

// ─── Auto-failover: tự đổi account khi active hết credit ─────────────────────────
const APIFY_API = "https://api.apify.com/v2";

/** true = còn dùng được · false = hết credit / token lỗi · null = không xác định (mạng). */
async function apifyAccountUsable(token: string): Promise<boolean | null> {
  if (!token) return false;
  try {
    const r = await fetch(`${APIFY_API}/users/me/limits?token=${token}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (r.status === 401 || r.status === 403) return false;      // token sai
    if (!r.ok) return null;
    const L = (await r.json())?.data ?? {};
    const usage = L.current?.monthlyUsageUsd ?? L.currentUsageCycle?.usageUsd ?? null;
    const max = L.limits?.maxMonthlyUsageUsd ?? null;
    if (usage == null || max == null) return true;               // không có trần → coi như dùng được
    return usage < max;                                          // dưới trần = còn credit
  } catch {
    return null;                                                 // lỗi mạng → không kết luận
  }
}

/**
 * Nếu account ĐANG ACTIVE hết credit / token lỗi → tự đổi sang account khác CÒN credit.
 * Bảo thủ: chỉ đổi khi active CHẮC CHẮN hỏng (false) VÀ có account khác CHẮC CHẮN tốt (true)
 * → tránh flapping vì lỗi mạng. Trả về thông tin đã đổi để reconciler log.
 */
export async function ensureUsableApifyAccount(): Promise<{ switched: boolean; from?: string; to?: string; reason?: string }> {
  const cfg = await readApifyConfig();
  if (cfg.accounts.length <= 1) return { switched: false };      // không có account khác để đổi
  const active = cfg.accounts.find((a) => a.id === cfg.activeId) ?? cfg.accounts[0] ?? null;
  if (!active) return { switched: false };
  const activeUsable = await apifyAccountUsable(active.token);
  if (activeUsable !== false) return { switched: false };        // còn dùng được / chưa rõ → giữ nguyên
  for (const acc of cfg.accounts) {
    if (acc.id === active.id) continue;
    if ((await apifyAccountUsable(acc.token)) === true) {
      cfg.activeId = acc.id;
      await writeApifyConfig(cfg);
      return { switched: true, from: active.label, to: acc.label, reason: "hết credit / token lỗi" };
    }
  }
  return { switched: false, reason: "tất cả account Apify đều hết credit / lỗi" };
}
