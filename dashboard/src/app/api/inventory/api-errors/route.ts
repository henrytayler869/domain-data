import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/inventory/api-errors → { total, rows: [{ domain, rating, category, detail }] }
 *   Domain có category dạng "API error" (N8N gọi DataForSEO/Ahrefs lỗi lấy anchor/ref
 *   → chấm không đầy đủ). Dùng cho tab "Check Lỗi" ở Kho Domain để check lại.
 */
export async function GET() {
  try {
    const sb = supabase();
    const rows: { target_domain: string; rating: string | null; category: string | null; detail: string | null }[] = [];
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("target_assessment")
        .select("target_domain,rating,category,detail")
        .ilike("category", "%API%error%")
        .order("target_domain", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      rows.push(...(data as typeof rows));
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return NextResponse.json({
      total: rows.length,
      rows: rows.map((r) => ({ domain: r.target_domain, rating: r.rating, category: r.category, detail: r.detail })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
