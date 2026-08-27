import { updateEntry } from "@/lib/inventory-db";
import { readTargetSummaryFor } from "@/lib/ahrefs-db";
import { readAll as readRefBlacklist } from "@/lib/ref-blacklist-db";
import { valuateByRefs } from "@/lib/valuation";

// Parse ref { domain, dr } từ chuỗi detail (fallback khi domain không có ref rows).
function parseDetailRefs(detail: string | null | undefined): { domain: string; dr: number }[] {
  if (!detail) return [];
  const body = detail.includes("|") ? detail.slice(detail.indexOf("|") + 1) : detail;
  const out: { domain: string; dr: number }[] = [];
  for (const part of body.split(/[;\n]+/)) {
    const m = part.match(/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\s*\(\s*DR\s*(\d+)/i);
    if (m) out.push({ domain: m[1].toLowerCase(), dr: Number(m[2]) });
  }
  return out;
}

/**
 * Tự định giá (expected_sell_price) cho các domain vừa mua — dùng chung logic với nút
 * "Định giá" ở Kho: refs SẠCH (đã lọc ref_blacklist) → valuateByRefs. Gọi ở MỌI nơi
 * ghi nhận mua domain (Mua thật qua Gname + ghi nhận "Đã mua" thủ công) để expected
 * price luôn có sẵn, không phải bấm định giá tay. Idempotent — gọi lại vẫn ra cùng giá.
 *
 * Không ném lỗi: caller nên bọc try/catch, vì việc mua/lưu Kho đã thành công không được
 * bị chặn chỉ vì định giá lỗi.
 */
export async function autoValuateDomains(domainsRaw: string[]): Promise<void> {
  const domains = Array.from(
    new Set(domainsRaw.map((d) => d.trim().toLowerCase()).filter(Boolean))
  );
  if (!domains.length) return;

  const [summaries, blacklist] = await Promise.all([
    readTargetSummaryFor(domains),
    readRefBlacklist(),
  ]);
  const blset = new Set(blacklist.map((b) => b.domain.toLowerCase()));
  const byDomain = new Map(summaries.map((s) => [s.targetDomain.toLowerCase(), s]));

  for (const d of domains) {
    const s = byDomain.get(d);
    const base = s && s.refs.length ? s.refs : parseDetailRefs(s?.detail);
    const refs = base.filter((r) => !blset.has(r.domain));
    await updateEntry(d, { expectedSellPrice: valuateByRefs(refs, d) });
  }
}
