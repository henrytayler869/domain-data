import { NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";

// GET — test DataforSEO connection using saved credentials
export async function GET() {
  try {
    const s = await readSettings();
    if (!s.dataforseoLogin || !s.dataforseoPassword) {
      return NextResponse.json(
        { ok: false, error: "Chưa cấu hình DataforSEO credentials" },
        { status: 400 }
      );
    }

    const auth = Buffer.from(`${s.dataforseoLogin}:${s.dataforseoPassword}`).toString("base64");

    // Lightweight endpoint: get account info
    const r = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
    });

    const data = await r.json();

    if (!r.ok || data.status_code !== 20000) {
      return NextResponse.json({
        ok: false,
        error: data.status_message ?? `HTTP ${r.status}`,
      });
    }

    const userData = data.tasks?.[0]?.result?.[0] ?? {};
    return NextResponse.json({
      ok: true,
      login: s.dataforseoLogin,
      money_balance: userData.money_balance ?? null,
      api_calls_today: userData.api_calls_today ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
