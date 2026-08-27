import { NextRequest, NextResponse } from "next/server";
import { upsertEntries, AddInput } from "@/lib/inventory-db";
import { autoValuateDomains } from "@/lib/auto-valuate";

export async function POST(request: NextRequest) {
  try {
    const { entries }: { entries: AddInput[] } = await request.json();
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { error: "entries phải là mảng không rỗng" },
        { status: 400 }
      );
    }
    const result = await upsertEntries(entries);
    // Tự định giá ngay khi ghi nhận "Đã mua" thủ công — áp dụng mọi nút Mua.
    try { await autoValuateDomains(entries.map((e) => e.domain)); } catch { /* lỗi định giá không chặn việc lưu Kho */ }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
