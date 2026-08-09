import { NextRequest, NextResponse } from "next/server";
import { readAll, addEntry, AddInput } from "@/lib/withdrawal-db";

export const dynamic = "force-dynamic";   // dữ liệu tiền — luôn đọc realtime, không cache

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as AddInput;
    if (!body.withdrawnAt || typeof body.amount !== "number" || !body.status) {
      return NextResponse.json(
        { error: "Thiếu trường bắt buộc: withdrawnAt, amount, status" },
        { status: 400 }
      );
    }
    if (!["paid", "progressing", "under_review"].includes(body.status)) {
      return NextResponse.json({ error: "status không hợp lệ" }, { status: 400 });
    }
    const entry = await addEntry(body);
    return NextResponse.json({ ok: true, entry });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
