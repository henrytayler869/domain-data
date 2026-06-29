import { NextRequest, NextResponse } from "next/server";
import { listCheckedTargets, listCheckedAmong } from "@/lib/ahrefs-db";

// GET — return list of unique target_domain values (for fast filter exclusion)
export async function GET() {
  try {
    const targets = await listCheckedTargets();
    return NextResponse.json({ targets });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST { domains } — return WHICH of the given domains are already checked.
// Scoped query (IN chunks) → tránh quét toàn bảng, nhanh hơn nhiều cho Picker.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { domains?: string[] };
    const domains = Array.isArray(body.domains) ? body.domains : [];
    const targets = await listCheckedAmong(domains);
    return NextResponse.json({ targets });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
