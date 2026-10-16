/**
 * Phân tích anchor text TẤT ĐỊNH (không cần AI) cho rating domain.
 *
 * Lý do: gpt-4o-mini đánh giá anchor không ổn định — profile toàn anchor brand (dylanmaddux.com)
 * bị gọi "minor_spam"; profile brand + rác SEO tự động (gulledge.net) bị gọi "Gambling anchors"
 * dù không có anchor cá cược nào. Code đo tỉ lệ (theo số refdomain/backlink của từng anchor):
 *   brand   — chứa tên miền / tên thương hiệu (vd "Dylan Maddux", "www.dylanmaddux.com")
 *   neutral — anchor điều hướng vô hại ("About", "Instagram", "here", ảnh trống…)
 *   seo     — rác SEO tự động ("SEO Authority Backlinks for <domain>", "guest post", "DR/DA/TF")
 *   bad     — chủ đề cá cược / người lớn / thuốc / hàng giả / vay
 *   other   — còn lại (ngôn ngữ lạ, từ khoá lạ…) → để AI xem
 * AI chỉ được quyết định "heavy_spam"/"malicious" khi có anchor chủ đề xấu hoặc anchor lạ chiếm nhiều.
 */

export interface AnchorIn { text: string; weight: number }
export type AnchorQuality = "clean" | "minor_spam" | "mixed" | "heavy_spam" | "malicious" | "unknown";

export interface AnchorFeatures {
  total: number;
  brand: number; neutral: number; seo: number; bad: number; other: number;   // tỉ lệ 0..1
  badAnchors: string[];
}

const NEUTRAL = /^(about( us)?|home|homepage|website|web ?site|site|here|click here|link|this|read more|more|visit|instagram|facebook|twitter|youtube|linkedin|pinterest|portfolio|blog|contact( us)?|external info|source|official site|homepage link|\(no ?anchor\)|image|img|logo|\s*)$/i;
const SEO_SPAM = /(backlink|guest ?post|\bseo\b|domain rating|\bdr\b|\bda\b|\btf\b|trust ?flow|majestic|\bmoz\b|rank(ing|s)? higher|authority (link|backlink)|dofollow|link ?building|website worth|site worth|traffic boost|first page)/i;
// Chủ đề xấu — ranh giới từ UNICODE: \b của JS coi "é" là ngoài từ nên "spécialisé" từng
// khớp "cialis" (shih-tzu-elevage.com bị gắn chủ đề thuốc). Dùng lookaround \p{L}\p{N} + cờ u.
const BAD_TOPIC = new RegExp([
  "casino", "slots?", "poker", "judi", "togel", "sbobet", "gacor", "bandar", "baccarat", "roulette", "sportsbook",
  "bet(ting|s)?", "1xbet", "betting", "gambl\\w*", "jackpot", "lottery", "toto",
  "escort", "porn\\w*", "xxx", "sex", "sexy", "sexual", "sex(cam|chat|shop|toys?)", "nude\\w*", "hentai", "camgirl\\w*", "onlyfans",
  "viagra", "cialis", "levitra", "kamagra", "pharmacy", "pills?", "tramadol", "xanax",
  "replica", "fake (watches|bags)", "payday loans?", "cash loans?",
  "darknet", "dark web",
].map((w) => `(?<![\\p{L}\\p{N}])(?:${w})(?![\\p{L}\\p{N}])`).join("|") + "|博彩|赌|娱乐城|彩票|色情|av女优|성인|카지노|สล็อต|คาสิโน", "iu");

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

export function analyzeAnchors(domain: string, anchors: AnchorIn[]): AnchorFeatures {
  const label = domain.toLowerCase().replace(/^www\./, "").split(".")[0];     // "dylanmaddux"
  const labelN = norm(label);
  let total = 0, brand = 0, neutral = 0, seo = 0, bad = 0, other = 0;
  const badAnchors: string[] = [];
  for (const a of anchors) {
    const w = Math.max(1, Number(a.weight) || 1);
    const t = String(a.text ?? "").trim();
    total += w;
    if (BAD_TOPIC.test(t)) { bad += w; if (badAnchors.length < 5) badAnchors.push(t.slice(0, 80)); continue; }
    if (SEO_SPAM.test(t)) { seo += w; continue; }
    const tn = norm(t);
    // brand: anchor chứa nhãn tên miền (≥4 ký tự để tránh khớp bừa), hoặc nhãn chứa anchor (anchor ≥5 ký tự)
    if (labelN.length >= 4 && (tn.includes(labelN) || (tn.length >= 5 && labelN.includes(tn)))) { brand += w; continue; }
    if (NEUTRAL.test(t)) { neutral += w; continue; }
    other += w;
  }
  const p = (x: number) => (total ? x / total : 0);
  return { total, brand: p(brand), neutral: p(neutral), seo: p(seo), bad: p(bad), other: p(other), badAnchors };
}

/** Kết hợp đo đạc + ý kiến AI → chất lượng anchor cuối cùng. */
export function resolveAnchorQuality(f: AnchorFeatures, ai: AnchorQuality | null): AnchorQuality {
  if (f.total === 0) return "unknown";
  const aiBad = ai === "heavy_spam" || ai === "malicious";
  // Có anchor chủ đề xấu đáng kể → tin AI ở mức xấu; AI bảo sạch thì vẫn ít nhất "mixed".
  if (f.bad >= 0.05 || f.badAnchors.length >= 2) return aiBad || ai === "mixed" ? ai! : "mixed";
  // Rác SEO tự động ("SEO Authority Backlinks for <domain>"…) bám gần như mọi domain hết hạn →
  // coi là NHIỄU: tỉ lệ brand tính trên phần anchor CÒN LẠI; có rác SEO (≥5%) thì tối đa minor_spam (TB).
  const rest = 1 - f.seo;
  if (rest < 0.02) return "mixed";                          // ~100% rác SEO, không còn anchor nào để xét brand
  const good = (f.brand + f.neutral) / rest;
  const otherShare = f.other / rest;
  if (good >= 0.9) return f.seo >= 0.05 ? "minor_spam" : "clean";
  if (good >= 0.5) return aiBad && otherShare >= 0.3 ? ai! : "minor_spam";
  // Brand thiểu số trong phần còn lại: anchor lạ / ngôn ngữ khác áp đảo → AI phân xử mixed hay xấu.
  return aiBad || ai === "mixed" ? ai! : "mixed";
}
