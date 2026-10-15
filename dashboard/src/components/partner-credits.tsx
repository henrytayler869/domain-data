"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// Shape khớp GET /api/partner-credits. Định nghĩa local để không kéo lib server vào bundle client.
interface ApifyCredit { label: string; active: boolean; usageUsd: number | null; limitUsd: number | null; error: string | null }
interface PartnerCredits {
  fetchedAt: string;
  apify: { ok: boolean; accounts: ApifyCredit[]; error: string | null };
  claude: { ok: boolean; status: "ok" | "no_credit" | "invalid_key" | "not_configured" | "error"; error: string | null };
  dataforseo: { ok: boolean; balanceUsd: number | null; error: string | null };
}

const POLL_MS = 15 * 60 * 1000;
const LOW_USD = 5; // còn dưới $5 → tô vàng

const usd = (n: number) => `$${n.toFixed(2)}`;
const remainingOf = (a: ApifyCredit) => (a.usageUsd != null && a.limitUsd != null ? Math.max(0, a.limitUsd - a.usageUsd) : null);
const tone = (left: number | null) => (left == null ? "" : left <= 0 ? "text-red-600" : left < LOW_USD ? "text-amber-600" : "text-emerald-700");

function Card({ title, value, valueClass, sub, href }: { title: string; value: string; valueClass?: string; sub?: React.ReactNode; href: string }) {
  return (
    <div className="rounded-lg border px-4 py-3 min-w-0">
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted-foreground uppercase hover:underline">{title}</a>
      <p className={cn("text-xl font-bold truncate", valueClass)}>{value}</p>
      {sub && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2 break-words">{sub}</div>}
    </div>
  );
}

async function fetchCredits(force: boolean): Promise<PartnerCredits | null> {
  try {
    const res = await fetch(`/api/partner-credits${force ? "?force=1" : ""}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as PartnerCredits) : null;
  } catch { return null; } // mạng lỗi tạm — giữ số cũ
}

/** 3 card credit partner — server cache 15', client poll 15'. */
export function PartnerCreditCards() {
  const [data, setData] = useState<PartnerCredits | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const d = await fetchCredits(false);
      if (alive && d) setData(d);
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const refresh = async () => {
    setLoading(true);
    const d = await fetchCredits(true);
    if (d) setData(d);
    setLoading(false);
  };

  const accounts = data?.apify.accounts ?? [];
  const active = accounts.find((a) => a.active) ?? accounts[0];
  const activeLeft = active ? remainingOf(active) : null;
  const totalLeft = accounts.reduce((s, a) => s + (remainingOf(a) ?? 0), 0);

  const claude = data?.claude;
  const claudeText = !claude ? "…" : {
    ok: "Còn credit", no_credit: "Hết credit", invalid_key: "Key lỗi", not_configured: "Chưa cấu hình", error: "Lỗi kiểm tra",
  }[claude.status];

  const dfs = data?.dataforseo;
  const updated = data ? new Date(data.fetchedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card
          title="Apify"
          href="https://console.apify.com/billing"
          value={!data ? "…" : activeLeft != null ? `${usd(activeLeft)} còn` : "Lỗi"}
          valueClass={data && activeLeft == null ? "text-red-600" : tone(activeLeft)}
          sub={data && !active ? data.apify.error : active?.error ?? (active && (
            <>
              {active.label}{active.usageUsd != null && active.limitUsd != null ? ` · đã dùng ${usd(active.usageUsd)}/${usd(active.limitUsd)}` : ""}
              {accounts.length > 1 && <> · {accounts.length} tài khoản, tổng còn {usd(totalLeft)}</>}
            </>
          ))}
        />
        <Card
          title="Claude API"
          href="https://console.anthropic.com/settings/billing"
          value={claudeText}
          valueClass={claude ? (claude.ok ? "text-emerald-700" : "text-red-600") : ""}
          sub={claude?.ok ? "Anthropic không có API xem số dư — bấm tiêu đề để xem" : claude?.error ?? undefined}
        />
        <Card
          title="DataforSEO"
          href="https://app.dataforseo.com/"
          value={!dfs ? "…" : dfs.balanceUsd != null ? `${usd(dfs.balanceUsd)} còn` : "Lỗi"}
          valueClass={dfs && dfs.balanceUsd == null ? "text-red-600" : tone(dfs?.balanceUsd ?? null)}
          sub={dfs?.error ?? undefined}
        />
      </div>
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        Credit cập nhật mỗi 15 phút{updated ? ` · lần cuối ${updated}` : ""}
        <button type="button" onClick={refresh} disabled={loading} className="hover:text-foreground disabled:opacity-50" title="Cập nhật ngay">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </button>
      </p>
    </div>
  );
}
