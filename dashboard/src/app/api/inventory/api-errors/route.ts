import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { readResultsFor } from "@/lib/wayback-db";

/**
 * GET /api/inventory/api-errors
 *   → { total, rows: [{ domain, rating, category, detail, wayback }] }
 *   Domain có category dạng "API error" (N8N gọi DataForSEO/Ahrefs lỗi lấy anchor/ref).
 *   Kèm trạng thái Wayback (clean/flagged/no-snap) để biết domain nào đáng check lại.
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

    // Trạng thái Wayback cho các domain này (scoped + song song).
    const wb = await readResultsFor(rows.map((r) => r.target_domain));
    const wbMap = new Map(wb.map((w) => [w.targetDomain.toLowerCase(), w]));

    return NextResponse.json({
      total: rows.length,
      rows: rows.map((r) => {
        const w = wbMap.get(r.target_domain.toLowerCase());
        return {
          domain: r.target_domain,
          rating: r.rating,
          category: r.category,
          detail: r.detail,
          wayback: w ? { snapshotCount: w.snapshotCount, hasBetting: w.hasBetting, hasAdult: w.hasAdult } : null,
        };
      }),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
