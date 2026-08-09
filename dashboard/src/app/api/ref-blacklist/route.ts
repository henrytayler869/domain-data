import { NextResponse } from "next/server";
import { readAll, clearAll } from "@/lib/ref-blacklist-db";

export const dynamic = "force-dynamic";   // luôn đọc realtime, không prerender snapshot cũ

// GET — list all user-added blacklist entries
export async function GET() {
  try {
    const entries = await readAll();
    return NextResponse.json(entries);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// DELETE — clear all user-added entries (defaults stay)
export async function DELETE() {
  try {
    await clearAll();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
