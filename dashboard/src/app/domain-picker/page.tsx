"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Upload, Loader2, Copy, ArrowRight, ArrowLeft, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseCsv } from "@/lib/picker-csv";

// ─── Flow 5 bước ──────────────────────────────────────────────────────────────
// 1 Nhập domain · 2 Loại đã mua (Kho) · 3 RDAP mua được?+giá · 4 Wayback (loại
//   Flagged/No-snap) · 5 Xuất Clean → DataForSEO (N8N webhook — cấu hình sau).

type Step = 1 | 2 | 3 | 4 | 5;
const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: "Nhập domain" },
  { id: 2, label: "Lọc mới" },
  { id: 3, label: "Mua được? + Giá" },
  { id: 4, label: "Wayback" },
  { id: 5, label: "Xuất DataForSEO" },
];

type RdapRow = { domain: string; status: string; dropEta: string | null };
type WaybackRow = { targetDomain: string; snapshotCount: number | null; hasBetting: boolean; hasAdult: boolean; errorReason: string | null };
type WaybackRun = { runId: string; status: string; targets: string[] };
type Price = { register: number | null; backorder: number | null; deposit: number | null };

function parseDomains(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of text.split(/[\s,;]+/)) {
    const d = tok.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d) && !seen.has(d)) { seen.add(d); out.push(d); }
  }
  return out;
}
const tldOf = (d: string) => d.split(".").pop() ?? "";
const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;

// Trích domain từ nội dung file. Nếu là CSV (Spamzilla export…) → parse đúng, lấy
// cột domain ("Name"/"Domain", hoặc cột nhiều giá trị giống domain nhất). Ngược lại
// (dán text thường) → quét token.
function extractFromFileText(text: string): string[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.includes(",") || firstLine.includes(";") || firstLine.includes("\t")) {
    try {
      const rows = parseCsv(text);
      if (rows.length >= 2) {
        const header = rows[0].map((h) => h.trim().toLowerCase());
        let col = header.findIndex((h) => h === "name" || h === "domain");
        if (col < 0) {
          // Không thấy header quen → chọn cột có nhiều giá trị giống domain nhất.
          const sample = rows.slice(1, 300);
          const counts = rows[0].map((_, i) => sample.filter((r) => DOMAIN_RE.test((r[i] ?? "").trim().toLowerCase())).length);
          col = counts.indexOf(Math.max(...counts));
        }
        if (col >= 0) {
          const seen = new Set<string>();
          const out: string[] = [];
          for (let r = 1; r < rows.length; r++) {
            const d = (rows[r][col] ?? "").trim().toLowerCase();
            if (DOMAIN_RE.test(d) && !seen.has(d)) { seen.add(d); out.push(d); }
          }
          if (out.length) return out;
        }
      }
    } catch { /* rơi xuống parse text thường */ }
  }
  return parseDomains(text);
}

export default function DomainPickerPage() {
  const [step, setStep] = useState<Step>(1);
  const [done, setDone] = useState<Set<Step>>(new Set());

  const [pasteText, setPasteText] = useState("");
  const [raw, setRaw] = useState<string[]>([]);                   // B1
  const [afterExclude, setAfterExclude] = useState<string[]>([]); // B2 → domain hoàn toàn mới
  const [b2, setB2] = useState<{ bought: string[]; flagged: string[]; nosnap: string[]; checked: string[] }>({ bought: [], flagged: [], nosnap: [], checked: [] });
  const fileRef = useRef<HTMLInputElement>(null);

  const [owned, setOwned] = useState<Set<string>>(new Set());       // đã mua (Kho)
  const [wbFlagged, setWbFlagged] = useState<Set<string>>(new Set());  // đã check Wayback: flagged
  const [wbNoSnap, setWbNoSnap] = useState<Set<string>>(new Set());    // đã check: no-snapshot
  const [wbChecked, setWbChecked] = useState<Set<string>>(new Set());  // MỌI domain đã check Wayback
  const [pricing, setPricing] = useState<Record<string, Price>>({});

  const [rdap, setRdap] = useState<Record<string, RdapRow>>({});
  const [rdapLoading, setRdapLoading] = useState(false);

  const [wbResults, setWbResults] = useState<WaybackRow[]>([]);
  const [wbRuns, setWbRuns] = useState<WaybackRun[]>([]);
  const [wbStarting, setWbStarting] = useState(false);

  const [toasts, setToasts] = useState<{ id: number; msg: string; err: boolean }[]>([]);
  const tid = useRef(0);
  const toast = useCallback((msg: string, err = false) => {
    const id = ++tid.current;
    setToasts((p) => [...p, { id, msg, err }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
  }, []);

  const advance = (to: Step) => { setDone((p) => new Set(p).add(step)); setStep(to); };

  // ── Load giá + Kho (1 lần) ──
  useEffect(() => {
    fetch("/api/gname/pricing").then((r) => r.json()).then((d) => {
      const m: Record<string, Price> = {};
      for (const p of d.pricing ?? []) m[String(p.tld).toLowerCase()] = { register: p.register, backorder: p.backorder, deposit: p.deposit };
      setPricing(m);
    }).catch(() => {});
    fetch("/api/inventory").then((r) => r.json()).then((d) => {
      setOwned(new Set((Array.isArray(d) ? d : []).map((e: { domain: string }) => String(e.domain).toLowerCase())));
    }).catch(() => {});
    fetch("/api/wayback/checked").then((r) => r.json()).then((d) => {
      const fl = new Set<string>(), ns = new Set<string>(), ch = new Set<string>();
      for (const c of d.checked ?? []) {
        const dm = String(c.domain).toLowerCase();
        ch.add(dm);
        if (c.flagged) fl.add(dm); else if (c.noSnapshot) ns.add(dm);
      }
      setWbFlagged(fl); setWbNoSnap(ns); setWbChecked(ch);
    }).catch(() => {});
  }, []);

  // ── Nhận domain từ Domain Drop ("Mở Picker") ──
  useEffect(() => {
    let payload: { domains?: unknown; ts?: number } | null = null;
    try { payload = JSON.parse(localStorage.getItem("dompicker.transfer") || "null"); } catch { /* ignore */ }
    try { localStorage.removeItem("dompicker.transfer"); } catch { /* ignore */ }
    if (!payload || !Array.isArray(payload.domains) || (payload.ts && Date.now() - payload.ts > 10 * 60_000)) return;
    setPasteText((payload.domains as string[]).join("\n"));
  }, []);

  // ── B1 → B2 ──
  const doStep1 = () => {
    const d = parseDomains(pasteText);
    if (!d.length) { toast("Không có domain hợp lệ", true); return; }
    setRaw(d);
    const bought: string[] = [], flagged: string[] = [], nosnap: string[] = [], checked: string[] = [], fresh: string[] = [];
    for (const dm of d) {
      if (owned.has(dm)) bought.push(dm);
      else if (wbFlagged.has(dm)) flagged.push(dm);
      else if (wbNoSnap.has(dm)) nosnap.push(dm);
      else if (wbChecked.has(dm)) checked.push(dm);   // đã check trước đó (kể cả clean) → không còn "mới"
      else fresh.push(dm);
    }
    setB2({ bought, flagged, nosnap, checked });
    setAfterExclude(fresh);
    advance(2);
  };
  const onFile = (f: File | null) => {
    if (!f) return;
    f.text().then((t) => {
      const doms = extractFromFileText(t);
      if (!doms.length) { toast("File không có domain hợp lệ", true); return; }
      setPasteText((p) => (p.trim() ? p.trim() + "\n" : "") + doms.join("\n"));
      toast(`✅ Đọc ${doms.length} domain từ file`);
    });
  };

  // ── B3: RDAP ──
  const runRdap = useCallback(async (domains: string[]) => {
    if (!domains.length) return;
    setRdapLoading(true);
    const BATCH = 25;
    const acc: Record<string, RdapRow> = {};
    for (let i = 0; i < domains.length; i += BATCH) {
      try {
        const res = await fetch("/api/rdap/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domains: domains.slice(i, i + BATCH) }) });
        const d = await res.json();
        for (const r of d.results ?? []) acc[r.domain] = r;
        setRdap({ ...acc });
      } catch { /* ignore */ }
    }
    setRdapLoading(false);
    toast("✅ RDAP xong");
  }, [toast]);

  // ── B4: Wayback ──
  const loadWb = useCallback(async () => {
    try {
      const [r1, r2] = await Promise.all([fetch("/api/wayback/results"), fetch("/api/wayback/runs")]);
      setWbResults((await r1.json()).rows ?? []);
      setWbRuns((await r2.json()).runs ?? []);
    } catch { /* ignore */ }
  }, []);
  const startWayback = useCallback(async (targets: string[]) => {
    if (!targets.length) return;
    setWbStarting(true);
    const BATCH = 10, CONC = 5;
    const batches: string[][] = [];
    for (let i = 0; i < targets.length; i += BATCH) batches.push(targets.slice(i, i + BATCH));
    let cursor = 0;
    const worker = async () => { while (cursor < batches.length) { const i = cursor++; try { await fetch("/api/wayback/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targets: batches[i] }) }); } catch { /* ignore */ } } };
    await Promise.all(Array.from({ length: Math.min(CONC, batches.length) }, () => worker()));
    await loadWb();
    setWbStarting(false);
    toast(`✅ Trigger Wayback ${targets.length} domain`);
  }, [loadWb, toast]);
  const pollWb = useCallback(async (runId: string) => { try { await fetch(`/api/wayback/runs/${encodeURIComponent(runId)}`); await loadWb(); } catch { /* ignore */ } }, [loadWb]);
  useEffect(() => {
    if (step !== 4) return;
    const running = wbRuns.filter((r) => r.status === "READY" || r.status === "RUNNING");
    if (!running.length) return;
    const id = setInterval(() => { for (const r of running) pollWb(r.runId); }, 10000);
    return () => clearInterval(id);
  }, [step, wbRuns, pollWb]);

  const wbByDomain = useMemo(() => { const m = new Map<string, WaybackRow>(); for (const r of wbResults) m.set(r.targetDomain, r); return m; }, [wbResults]);
  const inFlightWb = useMemo(() => { const s = new Set<string>(); for (const r of wbRuns) if (r.status === "READY" || r.status === "RUNNING") for (const d of r.targets) s.add(d); return s; }, [wbRuns]);
  const cleanDomains = useMemo(() => afterExclude.filter((d) => { const wb = wbByDomain.get(d); return !!wb && !wb.hasBetting && !wb.hasAdult && (wb.snapshotCount ?? 0) > 0; }), [afterExclude, wbByDomain]);
  const wbStats = useMemo(() => {
    let clean = 0, flagged = 0, nosnap = 0, pending = 0;
    for (const d of afterExclude) {
      const wb = wbByDomain.get(d);
      if (!wb) { pending++; continue; }
      if (wb.hasBetting || wb.hasAdult) flagged++;
      else if ((wb.snapshotCount ?? 0) === 0) nosnap++;
      else clean++;
    }
    return { clean, flagged, nosnap, pending };
  }, [afterExclude, wbByDomain]);

  const priceStr = (d: string): string => {
    const p = pricing[tldOf(d)]; const st = rdap[d]?.status;
    if (!p) return "—";
    if (st === "available" && p.register != null) return `$${p.register} đăng ký`;
    if ((st === "pendingDelete" || st === "redemptionPeriod" || st === "expiring") && p.backorder != null) return `$${p.backorder} BO`;
    return "—";
  };
  const rdapBadge = (d: string) => {
    const st = rdap[d]?.status; const eta = rdap[d]?.dropEta;
    if (!st) return <span className="text-muted-foreground text-xs">…</span>;
    if (st === "available") return <span className="text-emerald-700 font-bold text-xs">🟢 MUA ĐƯỢC</span>;
    if (st === "pendingDelete") return <span className="text-rose-700 font-bold text-xs">🔴 ≤5 ngày{eta ? ` (${eta})` : ""}</span>;
    if (st === "redemptionPeriod") return <span className="text-amber-600 text-xs">🟠 {eta ?? "redemption"}</span>;
    if (st === "expiring") return <span className="text-yellow-600 text-xs">🟡 {eta ?? "hết hạn"}</span>;
    if (st === "active") return <span className="text-muted-foreground text-xs">⚪ còn ĐK</span>;
    return <span className="text-muted-foreground text-xs">⚠️</span>;
  };
  const wbBadge = (d: string) => {
    if (inFlightWb.has(d)) return <span className="text-blue-600 text-xs inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />chạy</span>;
    const wb = wbByDomain.get(d);
    if (!wb) return <span className="text-muted-foreground text-xs">—</span>;
    if (wb.hasBetting || wb.hasAdult) return <span className="text-rose-600 text-xs">🚨 flagged</span>;
    if ((wb.snapshotCount ?? 0) === 0) return <span className="text-amber-600 text-xs">no snap</span>;
    return <span className="text-emerald-600 text-xs">✓ clean</span>;
  };

  const copyClean = useCallback(async () => {
    try { await navigator.clipboard.writeText(cleanDomains.join("\n")); } catch { /* ignore */ }
    toast(`✅ Copy ${cleanDomains.length} domain Clean`);
  }, [cleanDomains, toast]);

  const reset = () => { setStep(1); setDone(new Set()); setRaw([]); setAfterExclude([]); setB2({ bought: [], flagged: [], nosnap: [], checked: [] }); setRdap({}); };

  // ─── Render ───
  return (
    <div className="flex flex-col gap-5 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Domain Picker</h1>
        <p className="text-sm text-muted-foreground mt-1">Nhập domain → lọc domain mới → check mua được &amp; giá → Wayback → xuất Clean cho DataForSEO.</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-1 flex-wrap">
        {STEPS.map((s, i) => {
          const reachable = s.id <= step || done.has(s.id);
          return (
            <React.Fragment key={s.id}>
              <button disabled={!reachable} onClick={() => reachable && setStep(s.id)}
                className={cn("flex items-center gap-2 px-3 py-1.5 rounded-md text-sm",
                  s.id === step ? "bg-foreground text-background font-medium" : done.has(s.id) ? "text-emerald-700" : "text-muted-foreground",
                  reachable && s.id !== step && "hover:bg-muted")}>
                <span className={cn("h-5 w-5 rounded-full grid place-items-center text-xs border",
                  s.id === step ? "border-background" : done.has(s.id) ? "bg-emerald-600 text-white border-emerald-600" : "border-current")}>
                  {done.has(s.id) ? "✓" : s.id}
                </span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && <span className="text-muted-foreground">›</span>}
            </React.Fragment>
          );
        })}
        <Button size="sm" variant="ghost" onClick={reset} className="ml-auto gap-1.5 text-xs"><RotateCcw className="h-3.5 w-3.5" />Làm lại</Button>
      </div>

      {/* ── Bước 1 ── */}
      {step === 1 && (
        <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
          <p className="text-sm font-medium">Bước 1 — Dán hoặc upload danh sách domain</p>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={10}
            placeholder={"example.org\nanother-domain.com\n… mỗi dòng 1 domain (hoặc cách nhau bởi dấu phẩy/space)"}
            className="w-full rounded-md border border-input bg-background p-3 text-sm font-mono" />
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(e) => onFile(e.target.files?.[0] ?? null)} className="hidden" />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} className="gap-1.5"><Upload className="h-4 w-4" />Upload file</Button>
            <span className="text-xs text-muted-foreground">{parseDomains(pasteText).length} domain hợp lệ</span>
            <Button size="sm" onClick={doStep1} className="ml-auto gap-1.5" disabled={!parseDomains(pasteText).length}>Tiếp tục<ArrowRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* ── Bước 2 ── */}
      {step === 2 && (
        <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
          <p className="text-sm font-medium">Bước 2 — Loại domain đã xử lý → chỉ giữ domain HOÀN TOÀN MỚI</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {([["Nhập vào", raw.length, ""],
               ["Đã mua", b2.bought.length, "text-rose-600"],
               ["🚨 Flagged", b2.flagged.length, "text-rose-600"],
               ["No-snap", b2.nosnap.length, "text-amber-600"],
               ["Đã check", b2.checked.length, "text-amber-600"],
               ["✨ Mới", afterExclude.length, "text-emerald-600"]] as const).map(([l, v, c]) => (
              <div key={l} className="rounded-lg border px-3 py-2"><p className="text-[11px] text-muted-foreground uppercase">{l}</p><p className={cn("text-xl font-bold", c)}>{v}</p></div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Loại {raw.length - afterExclude.length} domain đã có (mua / flagged / no-snap / đã check) → chỉ <b>{afterExclude.length} domain mới</b> đi tiếp.</p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setStep(1)} className="gap-1.5"><ArrowLeft className="h-4 w-4" />Quay lại</Button>
            <Button size="sm" onClick={() => { advance(3); runRdap(afterExclude); }} className="ml-auto gap-1.5" disabled={!afterExclude.length}>Check mua được + giá<ArrowRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* ── Bước 3 ── */}
      {step === 3 && (
        <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Bước 3 — Mua được chưa? (RDAP) + giá Gname</p>
            {rdapLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
            <Button size="sm" variant="outline" onClick={() => runRdap(afterExclude)} className="ml-auto gap-1.5 h-8" disabled={rdapLoading}>Check lại RDAP</Button>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setStep(2)} className="gap-1.5"><ArrowLeft className="h-4 w-4" />Quay lại</Button>
            <Button size="sm" onClick={() => { advance(4); startWayback(afterExclude); }} className="ml-auto gap-1.5">Tiếp tục → Wayback<ArrowRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* ── Bước 4 ── */}
      {step === 4 && (
        <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Bước 4 — Wayback (Apify): loại 🚨 Flagged + no-snapshot</p>
            {(wbStarting || wbStats.pending > 0) && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
            <Button size="sm" variant="outline" onClick={() => startWayback(afterExclude.filter((d) => !wbByDomain.has(d) && !inFlightWb.has(d)))} className="ml-auto gap-1.5 h-8" disabled={wbStarting}>Check lại (chưa có)</Button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {([["✓ Clean", wbStats.clean, "text-emerald-600"], ["🚨 Flagged", wbStats.flagged, "text-rose-600"], ["No-snap", wbStats.nosnap, "text-amber-600"], ["Đang chạy", wbStats.pending, "text-blue-600"]] as const).map(([l, v, c]) => (
              <div key={l} className="rounded-lg border px-3 py-2"><p className="text-xs text-muted-foreground">{l}</p><p className={cn("text-xl font-bold", c)}>{v}</p></div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setStep(3)} className="gap-1.5"><ArrowLeft className="h-4 w-4" />Quay lại</Button>
            <Button size="sm" onClick={() => advance(5)} className="ml-auto gap-1.5" disabled={cleanDomains.length === 0}>Xuất {cleanDomains.length} Clean<ArrowRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* ── Bước 5 ── */}
      {step === 5 && (
        <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
          <p className="text-sm font-medium">Bước 5 — Xuất {cleanDomains.length} domain Clean cho DataForSEO</p>
          <p className="text-xs text-muted-foreground">Webhook N8N sẽ cấu hình trong Cài đặt sau. Trước mắt copy danh sách để check DataForSEO thủ công.</p>
          <textarea readOnly value={cleanDomains.join("\n")} rows={8} className="w-full rounded-md border border-input bg-muted/30 p-3 text-sm font-mono" />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setStep(4)} className="gap-1.5"><ArrowLeft className="h-4 w-4" />Quay lại</Button>
            <Button size="sm" onClick={copyClean} className="ml-auto gap-1.5" disabled={!cleanDomains.length}><Copy className="h-4 w-4" />Copy {cleanDomains.length} domain</Button>
          </div>
        </div>
      )}

      {/* ── Bảng domain (B3-5) ── */}
      {step >= 3 && afterExclude.length > 0 && (
        <div className="rounded-xl border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Domain</th>
                <th className="px-3 py-2">Mua được?</th>
                <th className="px-3 py-2">Giá</th>
                <th className="px-3 py-2">Wayback</th>
              </tr>
            </thead>
            <tbody>
              {afterExclude.map((d) => {
                const wb = wbByDomain.get(d);
                const excluded = !!wb && (wb.hasBetting || wb.hasAdult || (wb.snapshotCount ?? 0) === 0);
                return (
                  <tr key={d} className={cn("border-b last:border-0", excluded ? "opacity-45" : "hover:bg-muted/30")}>
                    <td className="px-3 py-1.5 font-medium"><a href={`https://${d}`} target="_blank" rel="noreferrer" className="hover:underline">{d}</a></td>
                    <td className="px-3 py-1.5">{rdapBadge(d)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-xs">{priceStr(d)}</td>
                    <td className="px-3 py-1.5">{wbBadge(d)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
        {toasts.map((t) => (<div key={t.id} className={cn("rounded-md px-4 py-2 text-sm shadow-lg", t.err ? "bg-rose-600 text-white" : "bg-foreground text-background")}>{t.msg}</div>))}
      </div>
    </div>
  );
}
