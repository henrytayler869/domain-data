import { NextResponse } from "next/server";
import { getBackorderChannels } from "@/lib/gname";

/**
 * GET /api/gname/channels — danh sách kênh backorder Gname (giá + deposit + TLD).
 * Domain Picker Bước 3 dùng để lấy giá Channel 2 ($26) cho domain registered → backorder.
 */
export async function GET() {
  try {
    return NextResponse.json({ channels: await getBackorderChannels() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown" }, { status: 500 });
  }
}
