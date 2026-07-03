import { NextResponse } from "next/server";
import { readAll } from "@/lib/expired-db";

export async function GET() {
  try {
    return NextResponse.json(await readAll());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
