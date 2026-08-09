import { NextResponse } from "next/server";
import { readAll } from "@/lib/inventory-db";

// KHÔNG cache: route đọc Kho realtime. Nếu để Next.js prerender (GET không tham số →
// bị coi là static), trang Kho sẽ hiện snapshot cũ, thiếu domain vừa mua ở trang khác.
export const dynamic = "force-dynamic";

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
