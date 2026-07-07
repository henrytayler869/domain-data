import { NextRequest, NextResponse } from "next/server";
import { upsertAssessments } from "@/lib/ahrefs-db";

/**
 * POST /api/n8n/ingest-rating
 *
 * Endpoint dành cho n8n (nằm NGOÀI session-proxy — xem src/proxy.ts matcher).
 * N8N gọi về SAU KHI chạy Ahrefs/DataForSEO xong → ghi rating vào
 * target_assessment. Bước 6 của Domain Picker auto-poll sẽ tự nhận.
 *
 * Auth: bắt buộc header `Authorization: Bearer <N8N_API_TOKEN>` (hoặc
 * `x-n8n-token`). Nếu env N8N_API_TOKEN chưa set → 503 (không để hở ghi dữ liệu).
 *
 * Body: { results: [{ domain, rating, category?, detail? }] }
 *    hoặc 1 domain: { domain, rating, category?, detail? }
 * rating: "✅ TỐT" | "⚠️ TRUNG BÌNH" | "❌ XẤU" | …
 */
interface RatingIn {
  domain?: string;
  target_domain?: string;
  rating?: string | null;
  category?: string | null;
  detail?: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const expected = process.env.N8N_API_TOKEN;
    if (!expected) {
      return NextResponse.json(
        { error: "N8N_API_TOKEN chưa cấu hình trên server" },
        { status: 503 },
      );
    }
    const auth = request.headers.get("authorization") || "";
    const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const provided = bearer || request.headers.get("x-n8n-token") || "";
    if (provided !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { results?: RatingIn[] } & RatingIn;
    const arr: RatingIn[] = Array.isArray(body.results)
      ? body.results
      : body.domain || body.target_domain
        ? [body]
        : [];
    const rows = arr
      .map((r) => ({
        targetDomain: String(r.domain || r.target_domain || "").toLowerCase().trim(),
        rating: r.rating ?? null,
        category: r.category ?? null,
        detail: r.detail ?? "DataForSEO (N8N)",
        excludedAt: null as string | null,
      }))
      .filter((r) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(r.targetDomain));
    if (!rows.length) {
      return NextResponse.json({ error: "Cần results: [{ domain, rating }]" }, { status: 400 });
    }
    const res = await upsertAssessments(rows);
    return NextResponse.json({ ok: true, ingested: rows.length, total: res.total });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
