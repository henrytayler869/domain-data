/**
 * RDAP — tra trạng thái vòng đời domain (miễn phí, public).
 *
 * status chuẩn hoá:
 *   available        — RDAP 404 → domain đã drop, MUA ĐƯỢC NGAY.
 *   pendingDelete    — đang pending-delete → drop trong ≤5 ngày (KHẨN CẤP).
 *   redemptionPeriod — đang redemption → ≤~30 ngày nữa vào pending-delete.
 *   expiring         — hold / auto-renew grace → mới hết hạn, còn lâu.
 *   active           — còn đăng ký bình thường (có thể chủ đã gia hạn → dead lead).
 *   error            — RDAP lỗi / không đọc được.
 */

export type RdapStatus =
  | "available" | "pendingDelete" | "redemptionPeriod" | "expiring" | "active" | "error";

export interface RdapResult {
  domain: string;
  status: RdapStatus;
  expiration: string | null; // ISO từ event "expiration"
  dropEta: string | null;    // YYYY-MM-DD — ước lượng ngày mua được
  raw: string[];             // status array gốc (debug)
}

function rdapUrl(domain: string): string {
  const d = domain.toLowerCase().trim();
  // .org → PIR trực tiếp (nhanh, không redirect). TLD khác → bootstrap rdap.org.
  return d.endsWith(".org")
    ? `https://rdap.publicinterestregistry.org/rdap/domain/${d}`
    : `https://rdap.org/domain/${d}`;
}

function addDays(base: Date, n: number): string {
  return new Date(base.getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

export async function checkRdap(domain: string): Promise<RdapResult> {
  const d = domain.toLowerCase().trim();
  const now = new Date();
  try {
    const res = await fetch(rdapUrl(d), { headers: { Accept: "application/rdap+json" } });
    if (res.status === 404) {
      return { domain: d, status: "available", expiration: null, dropEta: addDays(now, 0), raw: [] };
    }
    if (!res.ok) {
      return { domain: d, status: "error", expiration: null, dropEta: null, raw: [`HTTP ${res.status}`] };
    }
    const j = await res.json();
    const raw: string[] = Array.isArray(j.status) ? j.status : [];
    const set = new Set(raw.map((s) => String(s).toLowerCase()));
    const events: Record<string, string> = {};
    for (const e of (j.events ?? [])) if (e?.eventAction && e?.eventDate) events[e.eventAction] = e.eventDate;
    const expiration = events["expiration"] ?? null;

    let status: RdapStatus;
    let dropEta: string | null = null;
    if (set.has("pending delete")) {
      status = "pendingDelete";
      dropEta = addDays(now, 5); // pending-delete kéo dài đúng 5 ngày
    } else if (set.has("redemption period")) {
      status = "redemptionPeriod";
      // Ước lượng: .org drop ~70 ngày sau hết hạn (grace + redemption + pending).
      dropEta = expiration ? addDays(new Date(expiration), 70) : addDays(now, 35);
    } else if (set.has("client hold") || set.has("server hold") ||
               set.has("auto renew period") || set.has("pending renew")) {
      status = "expiring";
    } else {
      status = "active";
    }
    return { domain: d, status, expiration, dropEta, raw };
  } catch (e) {
    return { domain: d, status: "error", expiration: null, dropEta: null, raw: [String(e).slice(0, 60)] };
  }
}

/** Check nhiều domain với giới hạn song song (tránh rate-limit RDAP). */
export async function checkRdapMany(domains: string[], concurrency = 5): Promise<RdapResult[]> {
  const out: RdapResult[] = new Array(domains.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < domains.length) {
      const i = cursor++;
      out[i] = await checkRdap(domains[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, domains.length) }, () => worker()));
  return out;
}
