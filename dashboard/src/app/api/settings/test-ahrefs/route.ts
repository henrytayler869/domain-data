import { NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";

// GET — test Ahrefs API key via subscription-info endpoint
export async function GET() {
  try {
    const s = await readSettings();
    if (!s.ahrefsApiKey) {
      return NextResponse.json(
        { ok: false, error: "Chưa cấu hình Ahrefs API Key" },
        { status: 400 }
      );
    }

    const r = await fetch(
      "https://api.ahrefs.com/v3/subscription-info/limits-and-usage",
      {
        headers: {
          Authorization: `Bearer ${s.ahrefsApiKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    // Parse friendly error messages
    if (!r.ok) {
      if (r.status === 401) {
        return NextResponse.json({
          ok: false,
          error: "API Key không hợp lệ hoặc đã hết hạn. Kiểm tra lại tại app.ahrefs.com/account/api",
        });
      }
      const text = await r.text().catch(() => `HTTP ${r.status}`);
      return NextResponse.json({ ok: false, error: `HTTP ${r.status}: ${text}` });
    }

    const data = await r.json();
    // Response schema: { limits_and_usage: { subscription, units_usage_api_key, units_limit_api_key, ... } }
    const info = data.limits_and_usage ?? {};
    return NextResponse.json({
      ok: true,
      plan: info.subscription ?? null,
      unitsUsed: info.units_usage_api_key ?? null,
      unitsLimit: info.units_limit_api_key ?? null,   // null = unlimited
      expiresAt: info.api_key_expiration_date ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
