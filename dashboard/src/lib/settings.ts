/**
 * Dashboard Settings — stored in Apify KV Store ("dashboard-settings").
 * Passwords/API keys are never returned to the client after being saved.
 */

const APIFY_TOKEN = process.env.APIFY_TOKEN!;
const STORE_NAME = "dashboard-settings";
const STORE_KEY = "SETTINGS";
const APIFY_BASE = "https://api.apify.com/v2";

export interface Settings {
  dataforseoLogin: string;
  dataforseoPassword: string; // stored server-side only
}

let _storeId: string | null = null;

async function getStoreId(): Promise<string> {
  if (_storeId) return _storeId;

  const r = await fetch(
    `${APIFY_BASE}/key-value-stores?token=${APIFY_TOKEN}&limit=100`,
    { cache: "no-store" }
  );
  const data = await r.json();
  const match = (data.data?.items ?? []).find(
    (s: { name: string; id: string }) => s.name === STORE_NAME
  );
  if (match) {
    _storeId = match.id as string;
    return _storeId!;
  }

  const cr = await fetch(
    `${APIFY_BASE}/key-value-stores?token=${APIFY_TOKEN}&name=${STORE_NAME}`,
    { method: "POST" }
  );
  const cdata = await cr.json();
  _storeId = cdata.data.id as string;
  return _storeId!;
}

export async function readSettings(): Promise<Settings> {
  const envDefaults: Settings = {
    dataforseoLogin: process.env.DATAFORSEO_LOGIN ?? "",
    dataforseoPassword: process.env.DATAFORSEO_PASSWORD ?? "",
  };

  try {
    const storeId = await getStoreId();
    const r = await fetch(
      `${APIFY_BASE}/key-value-stores/${storeId}/records/${STORE_KEY}?token=${APIFY_TOKEN}`,
      { cache: "no-store" }
    );
    if (r.status === 404) return envDefaults;
    const data = await r.json();
    return {
      dataforseoLogin: data.dataforseoLogin || envDefaults.dataforseoLogin,
      dataforseoPassword: data.dataforseoPassword || envDefaults.dataforseoPassword,
    };
  } catch {
    return envDefaults;
  }
}

export async function writeSettings(settings: Partial<Settings>): Promise<void> {
  const current = await readSettings();
  const merged: Settings = {
    dataforseoLogin: settings.dataforseoLogin ?? current.dataforseoLogin,
    dataforseoPassword:
      settings.dataforseoPassword?.trim()
        ? settings.dataforseoPassword
        : current.dataforseoPassword,
  };

  const storeId = await getStoreId();
  await fetch(
    `${APIFY_BASE}/key-value-stores/${storeId}/records/${STORE_KEY}?token=${APIFY_TOKEN}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(merged),
    }
  );
}
