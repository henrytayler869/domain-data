import { NextRequest, NextResponse } from "next/server";
import { upsertMany, ImportRow } from "@/lib/expired-db";

export async function POST(request: NextRequest) {
  try {
    const { rows } = (await request.json()) as { rows?: ImportRow[] };
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "rows phải là mảng không rỗng" }, { status: 400 });
    }
    const result = await upsertMany(rows);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
