/**
 * 5 mức rating chuẩn + chuẩn hoá chuỗi rating do AI / upload trả về.
 * Lý do: model đôi khi viết lệch ("✅ TỐI" thay vì "✅ TỐT", thiếu emoji, chữ thường)
 * → các bộ lọc dùng includes("TỐT") bỏ sót domain tốt. Mọi chỗ ghi target_assessment
 * đi qua normalizeRating (xem upsertAssessments).
 */

export const RATING = {
  TOT: "✅ TỐT",
  TRUNG_BINH: "⚠️ TRUNG BÌNH",
  RUI_RO: "⚠️ RỦI RO",
  XAU: "❌ XẤU",
  RAT_XAU: "❌ RẤT XẤU",
} as const;

export type Rating = (typeof RATING)[keyof typeof RATING];

/** Trả rating chuẩn; chuỗi lạ không nhận ra → giữ nguyên (không đoán bừa). */
export function normalizeRating(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const u = s.normalize("NFC").toUpperCase();
  // "❌ RẤU" = "RẤT XẤU" bị nuốt chữ (gặp 4 lần, đều là darknet/escort)
  if (u.includes("RẤT XẤU") || u.includes("RAT XAU") || u.includes("RẤU")) return RATING.RAT_XAU;
  if (u.includes("XẤU") || u.includes("XAU")) return RATING.XAU;
  if (u.includes("RỦI RO") || u.includes("RUI RO") || u.includes("RỦI R")) return RATING.RUI_RO;
  if (u.includes("TRUNG BÌNH") || u.includes("TRUNG BINH")) return RATING.TRUNG_BINH;
  // "TỐT" + biến thể gõ lệch hay gặp: "TỐI" (model), "TOT"
  if (/T[ỐO][TI]\b/.test(u) || u.includes("TỐT")) return RATING.TOT;
  return s;
}
