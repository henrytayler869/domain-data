/**
 * Định giá domain theo chất lượng backlink (referring domains đã lọc blacklist).
 * - Không có ref DR ≥ 90 → domain yếu → định giá thấp $15–$17 (giả-random ổn định).
 * - Có ref DR ≥ 90 → mỗi ref đóng góp điểm theo DR vượt ngưỡng 40 (hoặc điểm cố định
 *   nếu là authority/.gov/.edu); tổng × hệ số rồi kẹp [VALUATION_MIN, VALUATION_MAX].
 * Dùng chung cho Kho Domain (giá dự kiến) và Backlink DB (cột Giá khi export).
 */

export const VALUATION_MIN = 35;
export const VALUATION_MAX = 150;
const VALUATION_K = 0.2;

// Ref domain authority "mạnh" — điểm cố định cao hơn DR thô, ưu tiên backlink thật.
const PREMIUM_REFS: Record<string, number> = {
  "wikipedia.org": 200,
  "wikimedia.org": 170,
  "nytimes.com": 190,
  "bbc.com": 190,
  "bbc.co.uk": 190,
  "theguardian.com": 180,
  "forbes.com": 170,
  "cnn.com": 170,
  "reuters.com": 180,
  "bloomberg.com": 170,
  "apple.com": 180,
  "microsoft.com": 180,
  "github.com": 160,
  "mozilla.org": 160,
  "who.int": 190,
  "un.org": 190,
  "europa.eu": 180,
  "imdb.com": 150,
  "amazon.com": 160,
  "youtube.com": 150,
};

// Điểm 1 ref: ưu tiên list authority → TLD .gov/.edu → còn lại theo DR thô.
function refPoints(domain: string | undefined, dr: number): number {
  const d = (domain ?? "").toLowerCase().trim();
  if (d && PREMIUM_REFS[d] != null) return PREMIUM_REFS[d];
  if (/\.(gov|edu|mil)(\.[a-z]{2,3})?$/.test(d)) return 150; // cơ quan/đại học
  if (/\.(ac\.[a-z]{2})$/.test(d)) return 150;               // academic (ac.uk, ...)
  return Math.max(0, (dr ?? 0) - 40);
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Giá "domain yếu" (không có ref DR≥90): random ổn định trong [WEAK_MIN, WEAK_MAX].
export const WEAK_VALUATION_MIN = 15;
export const WEAK_VALUATION_MAX = 17;

export function valuateByRefs(refs: { domain?: string; dr: number }[], domain = ""): number {
  // Không có ref mạnh (DR ≥ 90) → domain yếu → định giá thấp $15–$17. Giả-random
  // ổn định theo domain (không đổi mỗi lần render / định giá lại).
  const hasStrong = refs.some((r) => (r.dr ?? 0) >= 90);
  if (!hasStrong) {
    const span = (WEAK_VALUATION_MAX - WEAK_VALUATION_MIN) * 100 + 1; // số cent khả dĩ
    const cents = hashStr(domain || "x") % span;                     // 0..span-1
    return Math.round((WEAK_VALUATION_MIN * 100 + cents)) / 100;      // 15.00..17.00
  }
  const points = refs.reduce((sum, r) => sum + refPoints(r.domain, r.dr), 0);
  const base = VALUATION_MIN + points * VALUATION_K;
  // Whole dollars kẹp [MIN, MAX-1] để cộng phần lẻ vẫn ≤ MAX và ≥ MIN.
  const whole = Math.min(VALUATION_MAX - 1, Math.max(VALUATION_MIN, Math.floor(base)));
  const tenths = (hashStr(domain) % 9) + 1; // 1..9 → không bao giờ .0
  return Math.round((whole + tenths / 10) * 100) / 100;
}
