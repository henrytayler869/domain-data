import { NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";

// GET — test Ahrefs API key via subscription info endpoint
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

    if (!r.ok) {
      const text = await r.text().catch(() => `HTTP ${r.status}`);
      return NextResponse.json({ ok: false, error: `HTTP ${r.status}: ${text}` });
    }

    const data = await r.json();
    // Extract plan name + usage from response
    const sub = data.subscription ?? {};
    const usage = data.usage ?? {};
    return NextResponse.json({
      ok: true,
      plan: sub.plan_name ?? sub.plan ?? null,
      rowsLeft: usage.rows_left ?? null,
      rowsLimit: usage.rows_limit ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
