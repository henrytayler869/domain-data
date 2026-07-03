import { NextRequest, NextResponse } from "next/server";
import { setStatus, ExpiredStatus } from "@/lib/expired-db";

export async function POST(request: NextRequest) {
  try {
    const { domains, status } = (await request.json()) as {
      domains?: string[];
      status?: ExpiredStatus;
    };
    if (!Array.isArray(domains) || !domains.length) {
      return NextResponse.json({ error: "Cần domains[]" }, { status: 400 });
    }
    if (!["new", "bought", "excluded"].includes(status ?? "")) {
      return NextResponse.json({ error: "status không hợp lệ" }, { status: 400 });
    }
    const result = await setStatus(domains, status as ExpiredStatus);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
