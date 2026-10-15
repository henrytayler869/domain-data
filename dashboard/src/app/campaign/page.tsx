"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Loader2, ExternalLink, Save, CheckCircle2, AlertTriangle, XCircle, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Level = "ok" | "warn" | "bad";
interface ToolRow { key: string; name: string; purpose: string; balance: string; need: string; level: Level; note: string | null; topupUrl: string | null }
interface CheckRow { key: string; label: string; level: Level; detail: string }
interface Readiness {
  at: string; n: number;
  funnel: { availPct: number; cleanPct: number; goodPct: number; toWayback: number; toRating: number; buyable: number; hours: number };
  costUsd: { apify: number; openai: number; dfsIfNoAhrefs: number; total: number };
  tools: ToolRow[]; checks: CheckRow[];
}

const LEVEL_UI: Record<Level, { icon: typeof CheckCircle2; cls: string; text: string }> = {
  ok: { icon: CheckCircle2, cls: "text-emerald-600", text: "Đủ" },
  warn: { icon: AlertTriangle, cls: "text-amber-600", text: "Cần xem" },
  bad: { icon: XCircle, cls: "text-rose-600", text: "Thiếu" },
};
const usd = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 2 : 0 })}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

function LevelBadge({ level }: { level: Level }) {
  const u = LEVEL_UI[level];
  return <span className={cn("inline-flex items-center gap-1 text-xs font-medium", u.cls)}><u.icon className="h-3.5 w-3.5" />{u.text}</span>;
}

export default function CampaignPage() {
  const [n, setN] = useState("10000");
  const [data, setData] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [vpsDate, setVpsDate] = useState("");
  const [opsMsg, setOpsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/campaign/readiness?n=${Number(n) || 0}${force ? "&force=1" : ""}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData(d);
    } catch (e) { setErr(e instanceof Error ? e.message : "Lỗi tải"); }
    finally { setLoading(false); }
  }, [n]);

  const loadOps = useCallback(async () => {
    try {
      const d = await (await fetch("/api/ops", { cache: "no-store" })).json();
      if (d.error) return;
      setVpsDate(d.vpsExpiresAt ?? "");
    } catch { /* ignore */ }
  }, []);

  // Tải 1 lần khi mở trang (không theo dõi n — bấm "Tính lại" để tính với số mới).
  useEffect(() => {
    const t = setTimeout(() => { load(); loadOps(); }, 0);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveOps = async (body: Record<string, unknown>, okText: string) => {
    setBusy(true); setOpsMsg(null);
    try {
      const r = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setOpsMsg({ ok: true, text: okText }); await loadOps(); load();
    } catch (e) { setOpsMsg({ ok: false, text: e instanceof Error ? e.message : "Lưu lỗi" }); }
    finally { setBusy(false); }
  };

  const bad = data ? [...data.tools, ...data.checks].filter((x) => x.level === "bad").length : 0;

  return (
    <div className="flex flex-col gap-5 p-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ClipboardCheck className="h-6 w-6" />Chuẩn bị đợt quét</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Mở trang này <b>trước mỗi đợt quét</b>: nhập số domain định quét → xem cần nạp bao nhiêu vào công cụ nào. Các bước chi tiết ở <code>RUNBOOK.md</code> trong repo.
        </p>
      </div>

      {/* Ước tính */}
      <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-sm font-medium mb-1.5">Số domain sắp quét</label>
            <Input type="number" min={0} value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} className="w-40" />
          </div>
          <Button onClick={() => load()} disabled={loading} className="gap-2">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Tính lại</Button>
          <Button variant="outline" onClick={() => load(true)} disabled={loading} className="gap-2">Làm mới số dư</Button>
          {data && <span className="text-xs text-muted-foreground ml-auto">Cập nhật {new Date(data.at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>}
        </div>
        {err && <p className="text-sm text-rose-600">{err}</p>}
        {data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {([
                ["Quét Wayback", data.funnel.toWayback.toLocaleString(), `${pct(data.funnel.availPct)} mua được`],
                ["Chấm rating", data.funnel.toRating.toLocaleString(), `${pct(data.funnel.cleanPct)} Wayback sạch`],
                ["Dự kiến đáng mua", `~${data.funnel.buyable.toLocaleString()}`, `${pct(data.funnel.goodPct)} Tốt/TB`],
                ["Thời gian chạy", `~${Math.ceil(data.funnel.hours / 24)} ngày`, `${data.funnel.hours.toLocaleString()} giờ Wayback`],
                ["Tổng chi phí", usd(data.costUsd.total), `Apify ${usd(data.costUsd.apify)} · OpenAI ${usd(data.costUsd.openai)}`],
              ] as const).map(([l, v, sub]) => (
                <div key={l} className="rounded-lg border px-3 py-2">
                  <p className="text-[11px] text-muted-foreground uppercase">{l}</p>
                  <p className="text-xl font-bold">{v}</p>
                  <p className="text-[11px] text-muted-foreground">{sub}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">Tỉ lệ lấy từ lịch sử trong DB. Chưa gồm tiền mua domain, phí gói tháng (Apify, Ahrefs) và VPS. Nếu Ahrefs hết unit, chấm rating qua DataForSEO tốn thêm tối đa {usd(data.costUsd.dfsIfNoAhrefs)}.</p>
          </>
        )}
      </div>

      {/* Công cụ */}
      {data && (
        <div className="rounded-xl border bg-card overflow-x-auto">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <p className="text-sm font-medium">Công cụ cần tiền</p>
            {bad > 0 ? <span className="text-xs text-rose-600">· {bad} mục thiếu — xử lý trước khi chạy</span> : <span className="text-xs text-emerald-600">· sẵn sàng</span>}
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr className="border-b">
              <th className="text-left font-medium px-4 py-2">Công cụ</th><th className="text-left font-medium px-4 py-2">Số dư hiện tại</th>
              <th className="text-left font-medium px-4 py-2">Cần cho đợt này</th><th className="text-left font-medium px-4 py-2">Trạng thái</th><th className="px-4 py-2" />
            </tr></thead>
            <tbody>
              {data.tools.map((t) => (
                <tr key={t.key} className="border-b last:border-0 align-top">
                  <td className="px-4 py-2.5"><p className="font-medium">{t.name}</p><p className="text-xs text-muted-foreground">{t.purpose}</p></td>
                  <td className="px-4 py-2.5">{t.balance}{t.note && <p className="text-xs text-muted-foreground mt-0.5">{t.note}</p>}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{t.need}</td>
                  <td className="px-4 py-2.5"><LevelBadge level={t.level} /></td>
                  <td className="px-4 py-2.5 text-right">{t.topupUrl && <a href={t.topupUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap">Nạp tiền<ExternalLink className="h-3 w-3" /></a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Checklist */}
      {data && (
        <div className="rounded-xl border bg-card p-4 flex flex-col gap-2">
          <p className="text-sm font-medium">Kiểm tra vận hành</p>
          {data.checks.map((c) => (
            <div key={c.key} className="flex items-center gap-3 text-sm">
              <LevelBadge level={c.level} /><span>{c.label}</span><span className="text-xs text-muted-foreground">— {c.detail}</span>
            </div>
          ))}
        </div>
      )}

      {/* Hạn VPS */}
      <div className="grid md:grid-cols-2 gap-5">
        <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium">Hạn VPS</p>
            <p className="text-xs text-muted-foreground">VPS không có API báo hạn — nhập ngày hết hạn trên panel nhà cung cấp để được nhắc trước {5} ngày.</p>
          </div>
          <Input type="date" value={vpsDate} onChange={(e) => setVpsDate(e.target.value)} className="w-48" />
          <div><Button size="sm" onClick={() => saveOps({ vpsExpiresAt: vpsDate || null }, "Đã lưu hạn VPS")} disabled={busy} className="gap-1.5"><Save className="h-3.5 w-3.5" />Lưu</Button></div>
        </div>
      </div>
      {opsMsg && <p className={cn("text-sm", opsMsg.ok ? "text-emerald-600" : "text-rose-600")}>{opsMsg.text}</p>}

      {/* Các bước */}
      <div className="rounded-xl border bg-card p-4 text-sm flex flex-col gap-1.5">
        <p className="font-medium mb-1">Các bước chạy 1 đợt quét</p>
        <p>1. Nhập số domain ở trên → nạp tiền các dòng <b>Thiếu</b> (bấm “Nạp tiền”), rồi “Làm mới số dư” tới khi hết đỏ.</p>
        <p>2. Kiểm tra vận hành đều <b>Đủ</b> (cron chạy, Gname kết nối, OpenAI key dùng được).</p>
        <p>3. Vào <b>Domain Picker</b> → dán/upload danh sách domain → <b>Chạy pipeline</b>. Có thể đóng trang, pipeline nền tự chạy tiếp.</p>
        <p>4. Theo dõi khung <b>Pipeline nền</b> trên Domain Picker (thanh đỏ trên đầu trang báo khi Wayback dừng / hết credit). Khi số “chờ Wayback” và “chờ chấm rating” về 0 là xong → Domain Picker → <b>Khôi phục từ DB</b> để xem domain đáng mua.</p>
        <p>5. Xong đợt: cân nhắc tạm ngưng các gói trả theo tháng (Apify, Ahrefs) tới đợt sau.</p>
      </div>
    </div>
  );
}
