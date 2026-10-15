"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// Shape khớp GET /api/partner-credits. Định nghĩa local để không kéo lib server vào bundle client.
interface ApifyCredit { label: string; active: boolean; usageUsd: number | null; limitUsd: number | null; error: string | null }
type AiProvider = "claude" | "openai";
interface AiStatus { ok: boolean; status: "ok" | "no_credit" | "invalid_key" | "not_configured" | "error"; error: string | null }
interface OpenaiBalance { balanceUsd: number | null; spentUsd: number | null; since: string | null; error: string | null }
interface PartnerCredits {
  fetchedAt: string;
  apify: { ok: boolean; accounts: ApifyCredit[]; error: string | null };
  ai: { active: AiProvider | null; claude: AiStatus; openai: AiStatus; openaiBalance?: OpenaiBalance | null };
  dataforseo: { ok: boolean; balanceUsd: number | null; error: string | null };
}

const POLL_MS = 15 * 60 * 1000;
const LOW_USD = 5; // còn dưới $5 → tô vàng

const AI_NAME: Record<AiProvider, string> = { claude: "Claude", openai: "OpenAI" };
const AI_BILLING: Record<AiProvider, string> = {
  claude: "https://console.anthropic.com/settings/billing",
  openai: "https://platform.openai.com/settings/organization/billing/overview",
};
const AI_STATUS: Record<AiStatus["status"], string> = {
  ok: "Còn credit", no_credit: "Hết credit", invalid_key: "Key lỗi", not_configured: "Chưa cấu hình", error: "Lỗi kiểm tra",
};

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

  // Provider đang chạy (OpenAI chính, Claude dự phòng); hỏng cả 2 → hiện OpenAI (provider chính).
  const ai = data?.ai;
  const aiShown: AiProvider = ai?.active ?? "openai";
  const aiOther: AiProvider = aiShown === "claude" ? "openai" : "claude";
  const ob = aiShown === "openai" ? ai?.openaiBalance ?? null : null;
  const sinceText = ob?.since ? new Date(ob.since).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) : "";
  // Dòng phụ: số tiền (nếu có) + trạng thái key + provider kia.
  const aiValue = !ai ? "…"
    : ob?.balanceUsd != null && ai.openai.status !== "invalid_key" ? `≈ ${usd(ob.balanceUsd)} còn`
    : AI_STATUS[ai[aiShown].status];
  const aiValueClass = !ai ? ""
    : ob?.balanceUsd != null && ai.openai.status !== "invalid_key" ? tone(ob.balanceUsd)
    : ai[aiShown].ok ? "text-emerald-700" : "text-red-600";
  const aiDetail = !ai ? null
    : ob?.error ? `Admin key lỗi: ${ob.error}`
    : ob?.spentUsd != null ? `${ob.balanceUsd != null ? "đã tiêu" : "tháng này đã tiêu"} ${usd(ob.spentUsd)} từ ${sinceText}${ai[aiShown].ok ? "" : ` · ${AI_STATUS[ai[aiShown].status]}`}`
    : ai[aiShown].ok
      ? aiShown === "openai" ? "Thêm Admin key + số dư trong Settings để hiện số tiền" : "Không có API xem số dư — bấm tiêu đề để xem"
      : ai[aiShown].error;

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
          title={`AI · ${AI_NAME[aiShown]}${ai?.active ? " (đang chạy)" : ""}`}
          href={AI_BILLING[aiShown]}
          value={aiValue}
          valueClass={aiValueClass}
          sub={ai && <>{aiDetail}{" · "}{AI_NAME[aiOther]}: {AI_STATUS[ai[aiOther].status]}</>}
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
