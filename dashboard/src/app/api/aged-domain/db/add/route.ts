import { NextRequest, NextResponse } from "next/server";
import { upsertEntries, DbEntry } from "@/lib/backlink-db";

// POST body: { entries: { domain: string, dr: number, traffic?: number }[] }
export async function POST(request: NextRequest) {
  try {
    const { entries: toAdd }: { entries: DbEntry[] } = await request.json();
    if (!Array.isArray(toAdd) || toAdd.length === 0) {
      return NextResponse.json(
        { error: "entries phải là mảng không rỗng" },
        { status: 400 }
      );
    }

    const result = await upsertEntries(toAdd);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
