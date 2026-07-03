"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sprout, Upload, Search, ArrowUpDown, Loader2, Download, Copy,
  ShoppingCart, Ban, ExternalLink, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ExpiredCandidate, ExpiredStatus } from "@/lib/expired-db";

type SortKey = "finalScore" | "wpLinks" | "ccRank" | "referringDomains" | "backlinks" | "spamScore" | "firstYear" | "domain";
interface Toast { id: number; msg: string; err: boolean }

type WaybackRow = {
  targetDomain: string; snapshotCount: number | null; hasBetting: boolean; hasAdult: boolean;
  errorReason: string | null;
};
type WaybackRun = { runId: string; status: string; targets: string[] };

// RFC-4180 parse (header snake_case = keys của ImportRow).
function parseCsv(text: string): Record<string, string>[] {
  const t = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c === "\r") { /* skip */ }
    else f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0] || !r[0].trim()) continue;
    const o: Record<string, string> = {};
    header.forEach((h, j) => { o[h] = (r[j] ?? "").trim(); });
    out.push(o);
  }
  return out;
}

export default function ExpiredPage() {
  const [entries, setEntries] = useState<ExpiredCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [waybackResults, setWaybackResults] = useState<WaybackRow[]>([]);
  const [waybackRuns, setWaybackRuns] = useState<WaybackRun[]>([]);
  const [waybackStarting, setWaybackStarting] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"new" | "all" | "bought" | "excluded">("new");
  const [minScore, setMinScore] = useState("");
  const [maxSpam, setMaxSpam] = useState("");
  const [minRef, setMinRef] = useState("");
  const [onlyWp, setOnlyWp] = useState(false);
  const [filterWayback, setFilterWayback] = useState<"all" | "clean" | "flagged" | "unchecked">("all");
  const [sortKey, setSortKey] = useState<SortKey>("finalScore");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const [buyOpen, setBuyOpen] = useState(false);
  const [buyPrice, setBuyPrice] = useState("13.99");
  const [buying, setBuying] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const tid = useRef(0);
  const toast = useCallback((msg: string, err = false) => {
    const id = ++tid.current;
    setToasts((p) => [...p, { id, msg, err }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, wr, wru] = await Promise.all([
        fetch("/api/expired"), fetch("/api/wayback/results"), fetch("/api/wayback/runs"),
      ]);
      const ed = await e.json();
      setEntries(Array.isArray(ed) ? ed : []);
      setWaybackResults((await wr.json()).rows ?? []);
      setWaybackRuns((await wru.json()).runs ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const wbByDomain = useMemo(() => {
    const m = new Map<string, WaybackRow>();
    for (const r of waybackResults) m.set(r.targetDomain, r);
    return m;
  }, [waybackResults]);
  const inFlightWb = useMemo(() => {
    const s = new Set<string>();
    for (const r of waybackRuns) if (r.status === "READY" || r.status === "RUNNING") for (const d of r.targets) s.add(d);
    return s;
  }, [waybackRuns]);

  const searchTokens = useMemo(
    () => search.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
    [search],
  );
  const searchSet = useMemo(() => new Set(searchTokens), [searchTokens]);

  const filtered = useMemo(() => {
    const minS = minScore.trim() ? Number(minScore) : null;
    const maxSp = maxSpam.trim() ? Number(maxSpam) : null;
    const minR = minRef.trim() ? Number(minRef) : null;
    const list = entries.filter((e) => {
      if (filterStatus !== "all" && e.status !== filterStatus) return false;
      if (searchTokens.length === 1 && !e.domain.includes(searchTokens[0])) return false;
      if (searchTokens.length > 1 && !searchSet.has(e.domain)) return false;
      if (minS != null && (e.finalScore ?? -Infinity) < minS) return false;
      if (maxSp != null && (e.spamScore ?? 0) > maxSp) return false;
      if (minR != null && (e.referringDomains ?? 0) < minR) return false;
      if (onlyWp && (e.wpLinks ?? 0) < 1) return false;
      const wb = wbByDomain.get(e.domain);
      const flagged = !!(wb && (wb.hasBetting || wb.hasAdult));
      if (filterWayback === "flagged" && !flagged) return false;
      if (filterWayback === "clean" && !(wb && !flagged && (wb.snapshotCount ?? 0) > 0)) return false;
      if (filterWayback === "unchecked" && wb) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === "number" || typeof bv === "number" || av == null || bv == null) {
        const an = (av as number) ?? -Infinity, bn = (bv as number) ?? -Infinity;
        return (an - bn) * sortDir;
      }
      return String(av).localeCompare(String(bv)) * sortDir;
    });
  }, [entries, filterStatus, searchTokens, searchSet, minScore, maxSpam, minRef, onlyWp, filterWayback, wbByDomain, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const paged = useMemo(() => filtered.slice(safePage * pageSize, (safePage + 1) * pageSize), [filtered, safePage]);
  useEffect(() => { setPage(0); }, [filterStatus, search, minScore, maxSpam, minRef, onlyWp, filterWayback, sortKey, sortDir]);

  const stats = useMemo(() => {
    let nw = 0, bo = 0, ex = 0;
    for (const e of entries) { if (e.status === "new") nw++; else if (e.status === "bought") bo++; else if (e.status === "excluded") ex++; }
    return { total: entries.length, nw, bo, ex };
  }, [entries]);

  const toggle = (d: string) => setSelected((p) => { const n = new Set(p); n.has(d) ? n.delete(d) : n.add(d); return n; });
  const toggleAll = () => setSelected((p) => {
    const vis = paged.map((e) => e.domain);
    const all = vis.length > 0 && vis.every((d) => p.has(d));
    const n = new Set(p); vis.forEach((d) => (all ? n.delete(d) : n.add(d))); return n;
  });

  const handleSort = (k: SortKey) => { if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(k); setSortDir(-1); } };

  // ─── Import CSV ───
  const doImport = useCallback(async (text: string) => {
    const rows = parseCsv(text);
    if (!rows.length) { toast("❌ CSV rỗng / sai định dạng (cần header final_*.csv)", true); return; }
    setImporting(true);
    try {
      let imported = 0, total = 0;
      const CHUNK = 2000;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await fetch("/api/expired/import", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: rows.slice(i, i + CHUNK) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Import lỗi");
        imported += data.imported ?? 0; total = data.total ?? total;
      }
      toast(`✅ Import ${imported.toLocaleString()} domain · tổng ${total.toLocaleString()}`);
      setImportOpen(false);
      await load();
    } catch (e) {
      toast(`❌ ${e instanceof Error ? e.message : "Lỗi"}`, true);
    } finally { setImporting(false); }
  }, [toast, load]);

  const onFile = (f: File | null) => { if (f) f.text().then(doImport); };

  // ─── Wayback trigger (batch 10, concurrency 5) — như Kho/Picker ───
  const startWayback = useCallback(async (targets: string[]) => {
    if (!targets.length) return;
    setWaybackStarting(true);
    const BATCH = 10, CONC = 5;
    const batches: string[][] = [];
    for (let i = 0; i < targets.length; i += BATCH) batches.push(targets.slice(i, i + BATCH));
    let cursor = 0, ok = 0;
    const worker = async () => {
      while (cursor < batches.length) {
        const i = cursor++;
        try {
          const res = await fetch("/api/wayback/runs", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targets: batches[i] }),
          });
          if (res.ok) ok++;
        } catch { /* ignore */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, batches.length) }, () => worker()));
    toast(`✅ Trigger Wayback ${ok}/${batches.length} run · ${targets.length} domain`);
    try {
      const wr = await fetch("/api/wayback/runs"); setWaybackRuns((await wr.json()).runs ?? []);
    } catch { /* ignore */ }
    setWaybackStarting(false);
  }, [toast]);

  // ─── Buy → inventory + status bought ───
  const doBuy = useCallback(async () => {
    const domains = Array.from(selected);
    if (!domains.length) return;
    const price = buyPrice.trim() === "" ? null : Number(buyPrice);
    setBuying(true);
    try {
      const entriesPayload = domains.map((d) => ({
        domain: d, purchasePrice: isNaN(price as number) ? null : price,
        source: "expired-pipeline", rating: null, category: null, isBackorder: false,
      }));
      const res = await fetch("/api/inventory/add", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: entriesPayload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lỗi");
      await fetch("/api/expired/status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains, status: "bought" }),
      });
      setEntries((prev) => prev.map((e) => (selected.has(e.domain) ? { ...e, status: "bought" as ExpiredStatus } : e)));
      setSelected(new Set()); setBuyOpen(false);
      toast(`✅ Đã mua ${domains.length} domain @ $${price?.toFixed(2) ?? "0"} · lưu Kho`);
    } catch (e) {
      toast(`❌ ${e instanceof Error ? e.message : "Lỗi"}`, true);
    } finally { setBuying(false); }
  }, [selected, buyPrice, toast]);

  const setStatusSel = useCallback(async (status: ExpiredStatus) => {
    const domains = Array.from(selected);
    if (!domains.length) return;
    const snap = entries;
    setEntries((prev) => prev.map((e) => (selected.has(e.domain) ? { ...e, status } : e)));
    setSelected(new Set());
    try {
      const res = await fetch("/api/expired/status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains, status }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Lỗi");
      toast(`✅ Đã đổi ${domains.length} domain → ${status}`);
    } catch (e) { setEntries(snap); toast(`❌ ${e instanceof Error ? e.message : "Lỗi"}`, true); }
  }, [selected, entries, toast]);

  const pushToPicker = useCallback(() => {
    const domains = Array.from(selected);
    if (!domains.length) return;
    try {
      localStorage.setItem("dompicker.transfer", JSON.stringify({ domains, ts: Date.now() }));
      toast(`✅ Đã chuyển ${domains.length} domain → mở Domain Picker`);
      window.open("/domain-picker", "_blank");
    } catch { toast("❌ Không mở được", true); }
  }, [selected, toast]);

  const scopeForExport = useMemo(
    () => (selected.size > 0 ? filtered.filter((e) => selected.has(e.domain)) : filtered),
    [filtered, selected],
  );
  const exportCsv = useCallback(() => {
    if (!scopeForExport.length) return;
    const cols = ["domain", "final_score", "wp_links", "cc_rank", "referring_domains", "backlinks", "spam_score", "first_year", "drop_date", "status"];
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [cols.join(",")];
    for (const e of scopeForExport) lines.push([e.domain, e.finalScore, e.wpLinks, e.ccRank, e.referringDomains, e.backlinks, e.spamScore, e.firstYear, e.dropDate, e.status].map(esc).join(","));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `expired-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [scopeForExport]);

  const copyList = useCallback(async () => {
    const text = scopeForExport.map((e) => e.domain).join("\n");
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    toast(`✅ Copy ${scopeForExport.length} domain`);
  }, [scopeForExport, toast]);

  const wbCell = (d: string) => {
    if (inFlightWb.has(d)) return <span className="text-blue-600 text-xs inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />chạy</span>;
    const wb = wbByDomain.get(d);
    if (!wb) return <span className="text-muted-foreground text-xs">—</span>;
    if (wb.hasBetting || wb.hasAdult) return <span className="text-rose-600 text-xs">🚨 {wb.hasBetting ? "Bet" : ""}{wb.hasAdult ? "Adult" : ""}</span>;
    if ((wb.snapshotCount ?? 0) === 0) return <span className="text-amber-600 text-xs">no snap</span>;
    return <span className="text-emerald-600 text-xs">✓ clean</span>;
  };

  const Th = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <th className={cn("px-2 py-2 font-medium cursor-pointer select-none", right && "text-right")} onClick={() => handleSort(k)}>
      <span className="inline-flex items-center gap-1">{label}<ArrowUpDown className="h-3 w-3 opacity-40" /></span>
    </th>
  );

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Sprout className="h-6 w-6 text-emerald-600" />Domain Drop</h1>
          <p className="text-sm text-muted-foreground mt-1">Kết quả Expired Domain Pipeline (final_*.csv) → review → Wayback → Mua.</p>
        </div>
        <Button size="sm" onClick={() => setImportOpen((v) => !v)} className="gap-1.5">
          <Upload className="h-4 w-4" />Import final CSV
        </Button>
      </div>

      {importOpen && (
        <div className="rounded-xl border bg-card p-4 flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Chọn file <code>final_&lt;date&gt;.csv</code> từ pipeline (hoặc kéo thả).</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0] ?? null)} className="text-sm" />
          {importing && <span className="text-xs text-blue-600 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Đang import…</span>}
          <p className="text-[11px] text-amber-600">Lần đầu: chạy <code>dashboard/supabase/expired_candidates.sql</code> trong Supabase SQL Editor để tạo bảng.</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { l: "Tổng", v: stats.total, c: "" },
          { l: "Mới", v: stats.nw, c: "text-emerald-600" },
          { l: "Đã mua", v: stats.bo, c: "text-blue-600" },
          { l: "Loại trừ", v: stats.ex, c: "text-rose-600" },
        ].map((s) => (
          <div key={s.l} className="rounded-lg border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground uppercase">{s.l}</p>
            <p className={cn("text-2xl font-bold", s.c)}>{s.v.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Tìm / dán nhiều domain…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
        </div>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
          <option value="new">Mới</option><option value="all">Tất cả</option><option value="bought">Đã mua</option><option value="excluded">Loại trừ</option>
        </select>
        <select value={filterWayback} onChange={(e) => setFilterWayback(e.target.value as typeof filterWayback)} className="h-8 rounded-md border border-input bg-background px-2 text-xs" title="Wayback">
          <option value="all">Wayback: tất cả</option><option value="clean">🟢 Clean</option><option value="flagged">🚨 Flagged</option><option value="unchecked">— Chưa check</option>
        </select>
        <Input placeholder="min score" value={minScore} onChange={(e) => setMinScore(e.target.value)} className="h-8 w-24 text-xs" />
        <Input placeholder="max spam" value={maxSpam} onChange={(e) => setMaxSpam(e.target.value)} className="h-8 w-24 text-xs" />
        <Input placeholder="min ref" value={minRef} onChange={(e) => setMinRef(e.target.value)} className="h-8 w-24 text-xs" />
        <label className="flex items-center gap-1.5 text-xs cursor-pointer px-2 h-8 rounded-md border border-input">
          <input type="checkbox" checked={onlyWp} onChange={(e) => setOnlyWp(e.target.checked)} />có WP
        </label>
        <Button size="sm" variant="outline" onClick={exportCsv} className="gap-1.5 h-8"><Download className="h-3.5 w-3.5" />CSV</Button>
        <Button size="sm" variant="outline" onClick={copyList} className="gap-1.5 h-8"><Copy className="h-3.5 w-3.5" />Copy</Button>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} chọn:</span>
          <Button size="sm" variant="outline" disabled={waybackStarting} onClick={() => startWayback(Array.from(selected))} className="gap-1.5 text-purple-700 border-purple-400/60">
            {waybackStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "🕰️"} Check Wayback
          </Button>
          <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setBuyOpen(true)}><ShoppingCart className="h-3.5 w-3.5" />Mua</Button>
          <Button size="sm" variant="outline" onClick={() => setStatusSel("excluded")} className="gap-1.5 text-rose-700 border-rose-400/60"><Ban className="h-3.5 w-3.5" />Loại trừ</Button>
          <Button size="sm" variant="outline" onClick={pushToPicker} className="gap-1.5"><ExternalLink className="h-3.5 w-3.5" />Mở Picker</Button>
        </div>
      )}

      {/* Buy form */}
      {buyOpen && (
        <div className="rounded-xl border bg-card p-4 flex items-end gap-3 flex-wrap">
          <div><p className="text-xs text-muted-foreground mb-1">Giá mua ($) cho {selected.size} domain</p>
            <Input value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} className="h-8 w-32" /></div>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" disabled={buying} onClick={doBuy}>
            {buying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Lưu Kho
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBuyOpen(false)}>Hủy</Button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-x-auto">
        {loading ? (
          <p className="text-center py-12 text-muted-foreground">Đang tải…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2 w-8"><input type="checkbox" checked={paged.length > 0 && paged.every((e) => selected.has(e.domain))} onChange={toggleAll} /></th>
                <Th k="domain" label="Domain" />
                <Th k="finalScore" label="Score" right />
                <Th k="wpLinks" label="WP" right />
                <Th k="ccRank" label="CC rank" right />
                <Th k="referringDomains" label="Ref" right />
                <Th k="backlinks" label="BL" right />
                <Th k="spamScore" label="Spam" right />
                <Th k="firstYear" label="Từ" right />
                <th className="px-2 py-2">Wayback</th>
                <th className="px-2 py-2">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((e) => (
                <tr key={e.domain} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-2 py-1.5"><input type="checkbox" checked={selected.has(e.domain)} onChange={() => toggle(e.domain)} /></td>
                  <td className="px-2 py-1.5 font-medium"><a href={`https://${e.domain}`} target="_blank" rel="noreferrer" className="hover:underline">{e.domain}</a></td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{e.finalScore?.toFixed(1) ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{e.wpLinks || 0}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{e.ccRank?.toLocaleString() ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{e.referringDomains?.toLocaleString() ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{e.backlinks?.toLocaleString() ?? "—"}</td>
                  <td className={cn("px-2 py-1.5 text-right tabular-nums", (e.spamScore ?? 0) >= 30 && "text-rose-600")}>{e.spamScore ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{e.firstYear ?? "—"}</td>
                  <td className="px-2 py-1.5">{wbCell(e.domain)}</td>
                  <td className="px-2 py-1.5">
                    <span className={cn("text-xs px-1.5 py-0.5 rounded",
                      e.status === "bought" ? "bg-blue-100 text-blue-700" : e.status === "excluded" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700")}>{e.status}</span>
                  </td>
                </tr>
              ))}
              {paged.length === 0 && <tr><td colSpan={11} className="text-center py-10 text-muted-foreground">Không có domain. Import <code>final_*.csv</code> để bắt đầu.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {filtered.length > pageSize && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>‹</Button>
          <span>Trang {safePage + 1}/{totalPages} · {filtered.length.toLocaleString()} domain</span>
          <Button size="sm" variant="outline" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>›</Button>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
        {toasts.map((t) => (
          <div key={t.id} className={cn("rounded-md px-4 py-2 text-sm shadow-lg", t.err ? "bg-rose-600 text-white" : "bg-foreground text-background")}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
