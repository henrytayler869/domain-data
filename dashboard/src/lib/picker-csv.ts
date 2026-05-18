/**
 * RFC4180 CSV parser + SpamZilla/ExpiredDomains export mapping + scoring.
 * Handles quoted fields with embedded commas and newlines.
 */

export interface PickerThresholds {
  tfMin: number;
  cfMin: number;
  rdMin: number;
  daMin: number;
  ageMin: number;
  szScoreMin: number;
  szDropsMax: number;
}

export interface PickerWeights {
  tf: number;
  cf: number;
  rd: number;
  da: number;
  age: number;
  szScore: number;
  szDrops: number;
}

export const DEFAULT_THRESHOLDS: PickerThresholds = {
  tfMin: 15,
  cfMin: 10,
  rdMin: 30,
  daMin: 15,
  ageMin: 5,
  szScoreMin: 20,
  szDropsMax: 3,
};

export type PresetName = "conservative" | "balanced" | "aggressive" | "custom";

export const THRESHOLD_PRESETS: Record<Exclude<PresetName, "custom">, PickerThresholds> = {
  conservative: {
    tfMin: 25,
    cfMin: 18,
    rdMin: 60,
    daMin: 25,
    ageMin: 8,
    szScoreMin: 35,
    szDropsMax: 2,
  },
  balanced: DEFAULT_THRESHOLDS,
  aggressive: {
    tfMin: 8,
    cfMin: 5,
    rdMin: 15,
    daMin: 8,
    ageMin: 3,
    szScoreMin: 10,
    szDropsMax: 5,
  },
};

export const PRESET_LABELS: Record<Exclude<PresetName, "custom">, string> = {
  conservative: "Bảo thủ",
  balanced: "Cân bằng",
  aggressive: "Hung hăng",
};

/** Reverse-lookup: given a threshold object, find a matching preset (or 'custom'). */
export function detectPreset(t: PickerThresholds): PresetName {
  for (const name of Object.keys(THRESHOLD_PRESETS) as (keyof typeof THRESHOLD_PRESETS)[]) {
    const p = THRESHOLD_PRESETS[name];
    if (
      p.tfMin === t.tfMin &&
      p.cfMin === t.cfMin &&
      p.rdMin === t.rdMin &&
      p.daMin === t.daMin &&
      p.ageMin === t.ageMin &&
      p.szScoreMin === t.szScoreMin &&
      p.szDropsMax === t.szDropsMax
    ) {
      return name;
    }
  }
  return "custom";
}

export const DEFAULT_WEIGHTS: PickerWeights = {
  tf: 2,
  cf: 1,
  rd: 10,
  da: 1.5,
  age: 2,
  szScore: 1,
  szDrops: 5,
};

export interface PickerRow {
  domain: string;
  source: string;
  tf: number;
  cf: number;
  bl: number;
  rd: number;
  da: number;
  pa: number;
  age: number;
  szScore: number;
  szDrops: number;
  semTraffic: number;
  semKeywords: number;
  price: string;
  expires: string;
  score: number;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"') {
        if (next === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\r") {
        // ignore — handled by \n
      } else if (c === "\n") {
        row.push(field); field = "";
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
  }
  // Final field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ─── Mapping ──────────────────────────────────────────────────────────────────

const COL_MAP: Record<string, string> = {
  "Name": "domain",
  "Source": "source",
  "TF": "tf",
  "CF": "cf",
  "Majestic BL": "bl",
  "Majestic RD": "rd",
  "Moz DA": "da",
  "Moz PA": "pa",
  "Age": "age",
  "SZ Score": "szScore",
  "SZ Drops": "szDrops",
  "SEM Traffic": "semTraffic",
  "SEM Keywords": "semKeywords",
  "Price": "price",
  "Expires": "expires",
};

function num(v: string): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

export function mapRows(rows: string[][]): PickerRow[] {
  if (rows.length < 2) return [];
  const header = rows[0];

  // Build index: csv column index → field name
  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = COL_MAP[h.trim()];
    if (key) idx[key] = i;
  });

  if (idx.domain === undefined) {
    throw new Error("CSV thiếu cột 'Name' (domain)");
  }

  const out: PickerRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    if (!cols || cols.length === 0) continue;
    const domain = (cols[idx.domain] ?? "").trim().toLowerCase();
    if (!domain) continue;

    out.push({
      domain,
      source: (cols[idx.source] ?? "").trim(),
      tf: num(cols[idx.tf]),
      cf: num(cols[idx.cf]),
      bl: num(cols[idx.bl]),
      rd: num(cols[idx.rd]),
      da: num(cols[idx.da]),
      pa: num(cols[idx.pa]),
      age: num(cols[idx.age]),
      szScore: num(cols[idx.szScore]),
      szDrops: num(cols[idx.szDrops]),
      semTraffic: num(cols[idx.semTraffic]),
      semKeywords: num(cols[idx.semKeywords]),
      price: (cols[idx.price] ?? "").trim(),
      expires: (cols[idx.expires] ?? "").trim(),
      score: 0,
    });
  }
  return out;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export function computeScore(row: PickerRow, w: PickerWeights = DEFAULT_WEIGHTS): number {
  const rdLog = Math.log10(row.rd + 1);
  return (
    row.tf * w.tf +
    row.cf * w.cf +
    rdLog * w.rd +
    row.da * w.da +
    row.age * w.age +
    row.szScore * w.szScore -
    row.szDrops * w.szDrops
  );
}

export function applyScores(
  rows: PickerRow[],
  weights: PickerWeights = DEFAULT_WEIGHTS
): PickerRow[] {
  return rows.map((r) => ({ ...r, score: computeScore(r, weights) }));
}

export function passesThresholds(row: PickerRow, t: PickerThresholds): boolean {
  return (
    row.tf >= t.tfMin &&
    row.cf >= t.cfMin &&
    row.rd >= t.rdMin &&
    row.da >= t.daMin &&
    row.age >= t.ageMin &&
    row.szScore >= t.szScoreMin &&
    row.szDrops <= t.szDropsMax
  );
}

// ─── Ref Domain Blacklist (defaults) ─────────────────────────────────────────
// Các domain chỉ là marketplace/parking/platform/subdomain hosting/PBN footprint —
// gần như chắc chắn không phải backlink chất lượng cho aged domain.
export const REF_BLACKLIST: string[] = [
  // Marketplaces / parking
  "za.com",
  // Platform / subdomain hosting
  "blogspot.com",
  "wordpress.com",
  "weebly.com",
  "pages.dev",
  "squarespace.com",
  "amazonaws.com",
  "cloudfront.net",
  "azurewebsites.net",
  "netlify.app",
  "vercel.app",
  // CentralNic marketplaces
  "sa.com",
  "eu.com",
  "us.com",
  "uk.com",
  "in.net",
  // Free hosting / PBN footprints
  "google.com",       // sites.google.com, docs.google.com, Translate cache
  "wixsite.com",      // free subdomain hosting
  "hatena.ne.jp",     // Hatena Blog (JP) — parasite SEO
  "typepad.com",      // legacy blog hosting, abandoned/spam
  "heylink.me",       // link-in-bio service — strong PBN/gambling footprint
];

export const REF_BLACKLIST_SET: Set<string> = new Set(
  REF_BLACKLIST.map((d) => d.toLowerCase())
);

export function isBlacklistedRef(domain: string): boolean {
  return REF_BLACKLIST_SET.has(domain.toLowerCase().trim());
}

// ─── Ahrefs CSV ──────────────────────────────────────────────────────────────
// Format: target_domain,ref_domain,domain_rating

export interface AhrefsCsvRow {
  targetDomain: string;
  refDomain: string;
  domainRating: number;
}

export function parseAhrefsCsv(text: string): AhrefsCsvRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const tIdx = header.indexOf("target_domain");
  const rIdx = header.indexOf("ref_domain");
  const drIdx = header.indexOf("domain_rating");

  if (tIdx < 0 || rIdx < 0 || drIdx < 0) {
    throw new Error(
      "CSV thiếu cột — cần đủ: target_domain, ref_domain, domain_rating"
    );
  }

  const out: AhrefsCsvRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    if (!cols || cols.length === 0) continue;
    const target = (cols[tIdx] ?? "").trim().toLowerCase();
    const ref = (cols[rIdx] ?? "").trim().toLowerCase();
    if (!target || !ref) continue;
    const dr = parseInt((cols[drIdx] ?? "0").trim(), 10);
    out.push({
      targetDomain: target,
      refDomain: ref,
      domainRating: isNaN(dr) ? 0 : dr,
    });
  }
  return out;
}

// ─── Unified CSV (Ahrefs + Assessment) ───────────────────────────────────────
// Columns: target_domain, checked_at, refs, rating, category, detail
// `refs` format: "domain1 (DR 92); domain2 (DR 91); ..."

export interface UnifiedCsvRow {
  targetDomain: string;
  checkedAt: string;
  refs: { domain: string; dr: number }[];
  rating: string;
  category: string;
  detail: string;
}

export function parseUnifiedCsv(text: string): UnifiedCsvRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  // Accept both lowercase and Vietnamese display names
  const findIdx = (...keys: string[]) => {
    for (const k of keys) {
      const i = header.indexOf(k.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };

  const tIdx = findIdx("target_domain", "domain", "target domain");
  const cIdx = findIdx("checked_at", "checked", "checked at");
  const rIdx = findIdx("refs", "ref domains");
  const ratingIdx = findIdx("rating", "đánh giá");
  const catIdx = findIdx("category", "phân loại");
  const detailIdx = findIdx("detail", "chi tiết");

  if (tIdx < 0) throw new Error("CSV thiếu cột target_domain");
  if (rIdx < 0 && ratingIdx < 0) {
    throw new Error("CSV thiếu cột refs hoặc rating — không có dữ liệu để upload");
  }

  const out: UnifiedCsvRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    if (!cols || cols.length === 0) continue;
    const target = (cols[tIdx] ?? "").trim().toLowerCase();
    if (!target) continue;

    out.push({
      targetDomain: target,
      checkedAt: (cIdx >= 0 ? cols[cIdx] : "")?.trim() || "",
      refs: parseRefsCell(cols[rIdx] ?? ""),
      rating: (ratingIdx >= 0 ? cols[ratingIdx] : "")?.trim() || "",
      category: (catIdx >= 0 ? cols[catIdx] : "")?.trim() || "",
      detail: (detailIdx >= 0 ? cols[detailIdx] : "")?.trim() || "",
    });
  }
  return out;
}

// Parse "domain1 (DR 92); domain2 (DR 91); ..." → [{domain, dr}, ...]
export function parseRefsCell(cell: string): { domain: string; dr: number }[] {
  if (!cell?.trim()) return [];
  const out: { domain: string; dr: number }[] = [];
  // Split on ; (preferred) or | (fallback) or newline
  const parts = cell.split(/\s*[;|\n]\s*/).filter(Boolean);
  for (const p of parts) {
    // Match: "domain.com (DR 92)" or "domain.com DR 92" or "domain.com 92"
    const m = p.match(/^([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\s*[\s(]*(?:dr\s*)?(\d{1,3})\)?/i);
    if (m) {
      out.push({
        domain: m[1].toLowerCase().trim(),
        dr: Math.max(0, Math.min(100, parseInt(m[2], 10))),
      });
    }
  }
  return out;
}
