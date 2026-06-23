"use client";

import { useState, useCallback, useEffect, useRef, Fragment } from "react";
import {
  Search,
  ChevronDown,
  ChevronRight,
  Database,
  Trash2,
  Plus,
  X,
  Upload,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TargetSummary } from "@/lib/ahrefs-db";
import { parseUnifiedCsv } from "@/lib/picker-csv";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DbEntry {
  domain: string;
  dr: number;
  traffic?: number | null;
}

interface ToastItem {
  id: number;
  message: string;
  isError: boolean;
}

// Một dòng kết quả tra cứu đánh giá theo domain.
interface LookupRow {
  domain: string;
  found: boolean;
  rating: string | null;
  category: string | null;
  detail: string | null;
  refsCount: number;
  maxDr: number;
  refs: { domain: string; dr: number }[];
  cond: 0 | 1 | 2;
  evItems: { domain: string; dr: number; traffic: number | null }[];
  purchased: boolean;           // có trong Kho Domain chưa
  expectedPrice: number | null; // giá dự kiến đã set bên Kho (null = chưa set)
}

// Backlink mạnh: ĐK1 = ref DR>90; ĐK2 = ref DR70-89 traffic ≥ 1M.
const STRONG_TRAFFIC_MIN = 1_000_000;
function backlinkEvidence(
  refs: { domain: string; dr: number }[],
  trafficMap: Map<string, number>,
): { cond: 0 | 1 | 2; items: { domain: string; dr: number; traffic: number | null }[] } {
  const dr90 = refs.filter((r) => r.dr > 90);
  if (dr90.length) return { cond: 1, items: dr90.map((r) => ({ domain: r.domain, dr: r.dr, traffic: null })) };
  const dr7089 = refs
    .map((r) => ({ domain: r.domain, dr: r.dr, traffic: trafficMap.get(r.domain.toLowerCase()) ?? 0 }))
    .filter((r) => r.dr >= 70 && r.dr <= 89 && r.traffic >= STRONG_TRAFFIC_MIN)
    .sort((a, b) => b.traffic - a.traffic);
  if (dr7089.length) return { cond: 2, items: dr7089 };
  return { cond: 0, items: [] };
}
function fmtTraffic(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "K";
  return String(n);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgedDomainPage() {
  // ── Backlink DB ─────────────────────────────────────────────────────────────
  const [dbEntries, setDbEntries] = useState<DbEntry[]>([]);
  const [dbOpen, setDbOpen] = useState(true);
  const [dbManualDomain, setDbManualDomain] = useState("");
  const [dbManualDr, setDbManualDr] = useState("");
  const [dbCsvText, setDbCsvText] = useState("");
  const [dbImportOpen, setDbImportOpen] = useState(false);
  const [dbSearch, setDbSearch] = useState("");
  const [backfilling, setBackfilling] = useState(false);

  // ── Tra cứu đánh giá nhiều domain ─────────────────────────────────────────────
  const [lookupText, setLookupText] = useState("");
  const [lookupRows, setLookupRows] = useState<LookupRow[] | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [importingEval, setImportingEval] = useState(false);
  const [expandedLookup, setExpandedLookup] = useState<Set<string>>(new Set());
  const [lookupFilter, setLookupFilter] = useState<"all" | "tot" | "tb" | "bad" | "none">("all");
  const [copiedLookup, setCopiedLookup] = useState(false);
  // Multi-select + mua (lưu Kho Domain) trong bảng tra cứu.
  const [selectedLookup, setSelectedLookup] = useState<Set<string>>(new Set());
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseRows, setPurchaseRows] = useState<Record<string, string>>({});
  const [purchaseBulk, setPurchaseBulk] = useState("");
  const [savingPurchase, setSavingPurchase] = useState(false);

  // ── Toasts ──────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

  // ─── Toast helper ─────────────────────────────────────────────────────────────

  const showToast = useCallback((message: string, isError = false) => {
    const id = ++toastIdRef.current;
    setToasts((p) => [...p, { id, message, isError }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
  }, []);

  // ─── Backlink DB ──────────────────────────────────────────────────────────────

  const loadDb = useCallback(async () => {
    try {
      const res = await fetch("/api/aged-domain/db");
      const data = await res.json();
      setDbEntries(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadDb(); }, [loadDb]);

  const addToDb = useCallback(async (entries: DbEntry[]) => {
    if (!entries.length) return null;
    const res = await fetch("/api/aged-domain/db/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await loadDb();
    return data;
  }, [loadDb]);

  const removeFromDb = useCallback(async (domain: string) => {
    await fetch(`/api/aged-domain/db/${encodeURIComponent(domain)}`, { method: "DELETE" });
    await loadDb();
  }, [loadDb]);

  const clearDb = useCallback(async () => {
    if (!dbEntries.length) return;
    if (!confirm(`Xóa toàn bộ ${dbEntries.length} entries khỏi DB?`)) return;
    await fetch("/api/aged-domain/db", { method: "DELETE" });
    await loadDb();
    showToast("🗑️ Đã xóa toàn bộ Backlink DB");
  }, [dbEntries.length, loadDb, showToast]);

  // ─── Tra cứu đánh giá nhiều domain ─────────────────────────────────────────────
  // Dán list domain → đối chiếu store đánh giá (ahrefs_results + target_assessment)
  // → xem lại rating/category/refs/DR + ĐK1/ĐK2 cho từng domain (kể cả đã mua/đã loại).
  const runLookup = useCallback(async (explicitDomains?: string[]) => {
    const seen = new Set<string>();
    const domains: string[] = [];
    const source = explicitDomains ?? lookupText.split(/[\n,;\s]+/);
    for (const line of source) {
      const d = String(line).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d) || seen.has(d)) continue;
      seen.add(d);
      domains.push(d);
    }
    if (!domains.length) { showToast("❌ Không có domain hợp lệ trong ô tra cứu", true); return; }
    setLookupLoading(true);
    try {
      const [sumRes, trafRes, invRes, blRes] = await Promise.all([
        fetch("/api/ahrefs-results/db/by-targets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targets: domains }),
        }),
        fetch("/api/backlink-db/traffic"),
        fetch("/api/inventory"),
        fetch("/api/ref-blacklist"),
      ]);
      const sumData = await sumRes.json();
      const trafData = await trafRes.json();
      const invData = await invRes.json();
      const blData = await blRes.json();
      const summaries: TargetSummary[] = Array.isArray(sumData) ? sumData : [];
      const map = new Map(summaries.map((s) => [s.targetDomain.toLowerCase(), s]));
      const trafficMap = new Map<string, number>();
      for (const r of (trafData?.rows ?? []) as { domain: string; traffic: number }[]) {
        trafficMap.set(r.domain.toLowerCase(), r.traffic);
      }
      // Ref Domain Blacklist — lọc giống Kho Domain để 2 chỗ thống nhất maxDR/refs/ĐK.
      const blSet = new Set(
        (Array.isArray(blData) ? blData : []).map((e: { domain?: string }) => (e.domain ?? "").toLowerCase()),
      );
      // Kho Domain → trạng thái Đã mua + giá dự kiến (expectedSellPrice).
      const invMap = new Map<string, number | null>();
      for (const e of (Array.isArray(invData) ? invData : []) as { domain: string; expectedSellPrice: number | null }[]) {
        invMap.set(e.domain.toLowerCase(), e.expectedSellPrice ?? null);
      }
      const rows: LookupRow[] = domains.map((domain) => {
        const purchased = invMap.has(domain);
        const expectedPrice = purchased ? (invMap.get(domain) ?? null) : null;
        const s = map.get(domain);
        if (!s) {
          return { domain, found: false, rating: null, category: null, detail: null, refsCount: 0, maxDr: 0, refs: [], cond: 0, evItems: [], purchased, expectedPrice };
        }
        // Lọc blacklist (s.refs đã sort DR desc → cleanRefs[0] là max DR).
        const cleanRefs = s.refs.filter((r) => !blSet.has(r.domain.toLowerCase()));
        const ev = backlinkEvidence(cleanRefs, trafficMap);
        return {
          domain,
          found: true,
          rating: s.rating,
          category: s.category,
          detail: s.detail,
          refsCount: cleanRefs.length,
          maxDr: cleanRefs.length ? cleanRefs[0].dr : 0,
          refs: cleanRefs,
          cond: ev.cond,
          evItems: ev.items,
          purchased,
          expectedPrice,
        };
      });
      setLookupRows(rows);
      const foundN = rows.filter((r) => r.found).length;
      showToast(`✅ Tra cứu ${rows.length} domain · ${foundN} có đánh giá · ${rows.length - foundN} chưa có`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setLookupLoading(false);
    }
  }, [lookupText, showToast]);

  // Import CSV kết quả đánh giá (định dạng Unified: target_domain,refs,rating,…)
  // → lưu vào store đánh giá (ahrefs_results + target_assessment). KHÔNG auto
  // loại trừ / auto Wayback (khác với Picker Upload Result) — chỉ bổ sung đánh giá.
  async function importEvalCsv(file: File) {
    setImportingEval(true);
    try {
      const unified = parseUnifiedCsv(await file.text());
      if (!unified.length) { showToast("❌ CSV không có dòng hợp lệ (cần cột target_domain + refs/rating)", true); return; }
      const rows: { targetDomain: string; refDomain: string; domainRating: number }[] = [];
      const assessments: { targetDomain: string; rating: string | null; category: string | null; detail: string | null }[] = [];
      for (const u of unified) {
        for (const r of u.refs) rows.push({ targetDomain: u.targetDomain, refDomain: r.domain, domainRating: r.dr });
        if (u.rating || u.category || u.detail) {
          assessments.push({ targetDomain: u.targetDomain, rating: u.rating || null, category: u.category || null, detail: u.detail || null });
        }
      }
      if (!rows.length && !assessments.length) { showToast("❌ Không có dữ liệu để import", true); return; }
      const res = await fetch("/api/ahrefs-results/db/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, assessments }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import thất bại");
      showToast(`✅ Import ${unified.length} domain · ${assessments.length} đánh giá · ${rows.length} ref`);
      // Nạp luôn toàn bộ domain vừa import vào bảng tra cứu để xem ngay tất cả.
      const importedDomains = unified.map((u) => u.targetDomain);
      setLookupText(importedDomains.join("\n"));
      await runLookup(importedDomains);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setImportingEval(false);
    }
  }

  // Lọc kết quả tra cứu theo đánh giá.
  const displayedLookup = (lookupRows ?? []).filter((row) => {
    if (lookupFilter === "all") return true;
    const r = (row.rating || "").toUpperCase();
    const rated = !!(row.rating && row.rating.trim());
    if (lookupFilter === "none") return !rated;             // chưa đánh giá
    if (lookupFilter === "tot") return r.includes("TỐT");   // đánh giá tốt
    if (lookupFilter === "tb") return r.includes("TRUNG BÌNH");
    if (lookupFilter === "bad") return r.includes("RỦI RO") || r.includes("XẤU");
    return true;
  });

  // Copy nhanh danh sách domain (đang lọc), mỗi dòng 1 domain.
  async function copyLookup() {
    if (!displayedLookup.length) return;
    const text = displayedLookup.map((r) => r.domain).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text; el.style.cssText = "position:fixed;top:-9999px;opacity:0";
      document.body.appendChild(el); el.select(); document.execCommand("copy"); document.body.removeChild(el);
    }
    setCopiedLookup(true);
    setTimeout(() => setCopiedLookup(false), 1500);
  }

  // Export kết quả tra cứu (đang lọc) → CSV: Domain | Ref Domain (DR) | Giá dự kiến.
  // Giá dự kiến lấy từ Kho Domain (expectedSellPrice); chưa set thì để trống.
  function exportLookupCsv() {
    if (!displayedLookup.length) { showToast("Không có dòng để export", true); return; }
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const header = "Domain,Ref Domain (DR),Giá dự kiến";
    const lines = displayedLookup.map((r) => {
      const refsStr = r.refs.map((x) => `${x.domain} (DR ${x.dr})`).join("; ");
      const price = r.expectedPrice != null ? r.expectedPrice : "";
      return [r.domain, refsStr, price].map(esc).join(",");
    });
    const csv = ["﻿" + header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lookup-danh-gia-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`✅ Export ${displayedLookup.length} domain`);
  }

  // ── Select + Đã mua (lưu Kho Domain) ──────────────────────────────────────────
  const toggleLookupSelect = (domain: string) => {
    setSelectedLookup((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain); else next.add(domain);
      return next;
    });
  };
  const toggleLookupSelectAll = () => {
    setSelectedLookup((prev) => {
      const visible = displayedLookup.map((r) => r.domain);
      const allSel = visible.length > 0 && visible.every((d) => prev.has(d));
      const next = new Set(prev);
      if (allSel) for (const d of visible) next.delete(d);
      else for (const d of visible) next.add(d);
      return next;
    });
  };

  // Mở form nhập giá — prefill giá mua cũ nếu domain đã có trong kho.
  function openPurchaseForm() {
    if (selectedLookup.size === 0) return;
    const init: Record<string, string> = {};
    for (const d of selectedLookup) init[d] = "";
    setPurchaseRows(init);
    setPurchaseBulk("");
    setPurchaseOpen(true);
  }
  function applyPurchaseBulk() {
    const v = purchaseBulk.trim();
    if (!v) return;
    setPurchaseRows((prev) => {
      const next = { ...prev };
      for (const d of Object.keys(next)) next[d] = v;
      return next;
    });
  }
  // Lưu vào Kho Domain (giống Domain Picker): snapshot rating/category từ kết quả tra cứu.
  async function savePurchase() {
    setSavingPurchase(true);
    try {
      const rowByDomain = new Map((lookupRows ?? []).map((r) => [r.domain, r]));
      const entries = Object.entries(purchaseRows).map(([domain, priceStr]) => {
        const r = rowByDomain.get(domain);
        const price = priceStr.trim() === "" ? null : Number(priceStr);
        return {
          domain,
          purchasePrice: isNaN(price as number) ? null : price,
          source: null,
          rating: r?.rating ?? null,
          category: r?.category ?? null,
          isBackorder: false,
        };
      });
      const res = await fetch("/api/inventory/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lưu thất bại");
      // Cập nhật trạng thái Đã mua ngay trong bảng (giá dự kiến set sau ở Kho).
      const boughtSet = new Set(entries.map((e) => e.domain));
      setLookupRows((prev) => prev ? prev.map((r) => boughtSet.has(r.domain) ? { ...r, purchased: true } : r) : prev);
      setPurchaseOpen(false);
      setSelectedLookup(new Set());
      showToast(`✅ Đã lưu ${entries.length} domain vào Kho Domain`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setSavingPurchase(false);
    }
  }

  // ─── CSV import ───────────────────────────────────────────────────────────────

  // Parse "domain,dr[,traffic]" — bỏ header + dòng dr không hợp lệ.
  function parseDrTrafficCsv(text: string): DbEntry[] {
    const entries: DbEntry[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split(",").map((s) => s.trim());
      const domain = (parts[0] ?? "").replace(/^["']|["']$/g, "").toLowerCase();
      if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain)) continue;
      const dr = parseInt(parts[1] ?? "", 10);
      if (isNaN(dr) || dr < 0 || dr > 100) continue;
      const trafficRaw = (parts[2] ?? "").replace(/[",]/g, "").replace(/traffic:/i, "").trim();
      const traffic = trafficRaw ? Math.round(parseFloat(trafficRaw)) : null;
      entries.push({ domain, dr, traffic: Number.isFinite(traffic as number) ? traffic : null });
    }
    return entries;
  }

  async function importCsv() {
    const entries = parseDrTrafficCsv(dbCsvText);
    if (!entries.length) { showToast("❌ Không parse được dữ liệu CSV (cần domain,dr[,traffic])", true); return; }
    try {
      const data = await addToDb(entries);
      setDbCsvText("");
      setDbImportOpen(false);
      showToast(`✅ Import ${data?.added ?? 0} mới · cập nhật ${entries.length} dòng (DR+Traffic)`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  const filteredDb = [...dbEntries]
    .filter((e) => !dbSearch || e.domain.includes(dbSearch.toLowerCase()))
    .sort((a, b) => b.dr - a.dr);

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6">

      {/* ── Header ─────────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Backlink DB</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Kho dữ liệu tham chiếu <strong>Domain → DR (+ traffic)</strong> để Domain Picker & n8n đối chiếu backlink.
          Việc check backlink nay chạy qua <strong>n8n (DataforSEO)</strong> — không gọi API trực tiếp trên web.
        </p>
      </div>

      {/* ── Tra cứu đánh giá nhiều domain ─────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Search className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wide">Tra cứu đánh giá (nhiều domain)</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Dán nhiều domain (mỗi dòng / phẩy / cách) → xem lại <strong>đánh giá + ref/DR + ĐK1/ĐK2</strong> đã lưu cho từng domain (kể cả đã mua / đã loại trừ).
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <textarea
            value={lookupText}
            onChange={(e) => setLookupText(e.target.value)}
            placeholder={"example.com\nanotherdomain.net\n..."}
            rows={3}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-col gap-2 sm:w-44">
            <Button onClick={() => runLookup()} disabled={lookupLoading || !lookupText.trim()} className="gap-2">
              {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {lookupLoading ? "Đang tra…" : "Tra cứu"}
            </Button>
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importEvalCsv(f); e.target.value = ""; }}
              />
              <span className={cn(
                "inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-emerald-400/60 text-emerald-700 dark:hover:bg-emerald-950 hover:bg-emerald-50 px-2.5 h-9 text-xs font-medium",
                importingEval && "opacity-60 pointer-events-none",
              )}>
                {importingEval ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {importingEval ? "Đang import…" : "Import đánh giá (CSV)"}
              </span>
            </label>
          </div>
        </div>

        {lookupRows !== null && (
          <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {displayedLookup.length} / {lookupRows.length} domain
            </span>
            <select
              value={lookupFilter}
              onChange={(e) => setLookupFilter(e.target.value as typeof lookupFilter)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs cursor-pointer"
              title="Lọc theo đánh giá"
            >
              <option value="all">Tất cả</option>
              <option value="tot">✅ Đánh giá tốt (TỐT)</option>
              <option value="tb">⚠️ TRUNG BÌNH</option>
              <option value="bad">⚠️/❌ Rủi ro / Xấu</option>
              <option value="none">Chưa đánh giá</option>
            </select>
            {selectedLookup.size > 0 && (
              <Button
                size="sm"
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={openPurchaseForm}
              >
                <Check className="h-3.5 w-3.5" />
                Đã mua ({selectedLookup.size})
              </Button>
            )}
            <Button size="sm" variant="outline" className="gap-1.5 ml-auto" onClick={copyLookup} disabled={!displayedLookup.length}>
              {copiedLookup ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedLookup ? "Đã copy!" : `Copy ${displayedLookup.length} domain`}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={exportLookupCsv} disabled={!displayedLookup.length}>
              <Upload className="h-3.5 w-3.5 rotate-180" />
              Export CSV
            </Button>
          </div>
          <div className="mt-2 rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      className="rounded cursor-pointer"
                      aria-label="Chọn tất cả"
                      checked={displayedLookup.length > 0 && displayedLookup.every((r) => selectedLookup.has(r.domain))}
                      onChange={toggleLookupSelectAll}
                    />
                  </th>
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Domain</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Trạng thái</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Đánh giá</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Phân loại</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Max DR</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Giá dự kiến</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Refs</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Backlink mạnh</th>
                </tr>
              </thead>
              <tbody>
                {displayedLookup.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-8 text-muted-foreground text-sm">Không có domain khớp bộ lọc</td></tr>
                ) : displayedLookup.map((row) => {
                  const expanded = expandedLookup.has(row.domain);
                  return (
                    <Fragment key={row.domain}>
                      <tr
                        className={cn("border-b border-border/30 hover:bg-muted/20 cursor-pointer align-top", !row.found && "opacity-60", selectedLookup.has(row.domain) && "bg-emerald-50/40 dark:bg-emerald-950/20")}
                        onClick={() => setExpandedLookup((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.domain)) next.delete(row.domain); else next.add(row.domain);
                          return next;
                        })}
                      >
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="rounded cursor-pointer"
                            aria-label={`Chọn ${row.domain}`}
                            checked={selectedLookup.has(row.domain)}
                            onChange={() => toggleLookupSelect(row.domain)}
                          />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.found ? (expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{row.domain}</td>
                        <td className="px-3 py-2">
                          {row.purchased ? (
                            <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-[10px] font-medium"><Check className="h-2.5 w-2.5" /> Đã mua</span>
                          ) : (
                            <span className="inline-block rounded bg-muted text-muted-foreground px-1.5 py-0.5 text-[10px] font-medium">Chưa mua</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.found ? <RatingBadge rating={row.rating} /> : <span className="text-xs text-muted-foreground italic">chưa có đánh giá</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px]">{row.category || <span className="opacity-40">—</span>}</td>
                        <td className="px-3 py-2">{row.found ? <DrBadge dr={row.maxDr} small /> : <span className="opacity-40">—</span>}</td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">{row.expectedPrice != null ? <span className="font-medium">${row.expectedPrice}</span> : <span className="opacity-40">—</span>}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{row.found ? row.refsCount.toLocaleString() : "—"}</td>
                        <td className="px-3 py-2 text-xs">
                          {row.cond === 1 ? (
                            <span className="inline-block rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-[10px] font-medium">✅ ĐK1 · {row.evItems.length} ref DR&gt;90</span>
                          ) : row.cond === 2 ? (
                            <span className="inline-block rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[10px] font-medium">🟡 ĐK2 · {row.evItems.length} ref ≥1M</span>
                          ) : <span className="opacity-40">—</span>}
                        </td>
                      </tr>
                      {expanded && row.found && (
                        <tr className="bg-muted/10 border-b border-border/30">
                          <td colSpan={10} className="px-6 py-3 text-xs space-y-2">
                            {row.detail && (
                              <p className="text-muted-foreground leading-snug whitespace-pre-wrap max-w-[700px]"><strong>Chi tiết:</strong> {row.detail}</p>
                            )}
                            {row.cond === 2 && row.evItems.length > 0 && (
                              <p className="font-mono text-[11px] text-muted-foreground">
                                ĐK2: {row.evItems.map((r) => `${r.domain} (DR ${r.dr}), ${fmtTraffic(r.traffic ?? 0)}`).join(" | ")}
                              </p>
                            )}
                            {row.refs.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {row.refs.slice(0, 60).map((r) => (
                                  <span key={r.domain} className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px]">
                                    {r.domain} <DrBadge dr={r.dr} small />
                                  </span>
                                ))}
                                {row.refs.length > 60 && <span className="text-muted-foreground">… +{row.refs.length - 60}</span>}
                              </div>
                            ) : <p className="text-muted-foreground italic">Không có ref khớp DB</p>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {/* ── Backlink DB Panel ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm">
        <button
          onClick={() => setDbOpen((o) => !o)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-muted/30 transition rounded-xl"
        >
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">Backlink DB</h2>
            <span className="bg-primary/10 text-primary text-xs font-bold px-2 py-0.5 rounded-full">
              {dbEntries.length} entries
            </span>
          </div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", dbOpen && "rotate-180")} />
        </button>

        {dbOpen && (
          <div className="border-t px-6 pb-6">
            <p className="text-xs text-muted-foreground pt-4 pb-4 leading-relaxed">
              Cơ sở dữ liệu domain tham chiếu <strong>(Domain → DR, traffic)</strong>.
              Domain Picker & workflow n8n đối chiếu ref domain với DB này để lấy DR/traffic.
              Bổ sung dữ liệu bằng <strong>Thêm</strong> / <strong>Import CSV</strong> / <strong>Backfill từ Ahrefs</strong>.
            </p>

            {/* Action row */}
            <div className="flex flex-wrap items-end gap-2 mb-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Domain</label>
                <Input
                  placeholder="example.com"
                  value={dbManualDomain}
                  onChange={(e) => setDbManualDomain(e.target.value)}
                  className="w-44 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">DR</label>
                <Input
                  type="number" placeholder="0–100"
                  value={dbManualDr}
                  onChange={(e) => setDbManualDr(e.target.value)}
                  className="w-24 text-sm"
                  min={0} max={100}
                />
              </div>
              <Button
                size="sm" variant="outline" className="gap-1.5"
                onClick={async () => {
                  const domain = dbManualDomain.trim().toLowerCase();
                  const dr = parseInt(dbManualDr);
                  if (!domain || isNaN(dr)) return;
                  try {
                    await addToDb([{ domain, dr }]);
                    setDbManualDomain("");
                    setDbManualDr("");
                    showToast(`✅ Đã thêm ${domain} (DR ${dr})`);
                  } catch (err) {
                    showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
                  }
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Thêm
              </Button>

              <Button
                size="sm" variant="outline" className="gap-1.5"
                onClick={() => setDbImportOpen((o) => !o)}
              >
                <Upload className="h-3.5 w-3.5" />
                Import CSV
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-purple-700 border-purple-400/60 hover:bg-purple-50 dark:hover:bg-purple-950"
                disabled={backfilling}
                onClick={async () => {
                  setBackfilling(true);
                  try {
                    const res = await fetch("/api/aged-domain/db/backfill", { method: "POST" });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error ?? "Backfill thất bại");
                    await loadDb();
                    showToast(
                      `✅ Backfill xong: ${data.upserted} upsert · ${data.skippedUnchanged} unchanged · total ${data.totalAfter} (từ ${data.ahrefsRowsScanned} ahrefs rows)`
                    );
                  } catch (err) {
                    showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
                  } finally {
                    setBackfilling(false);
                  }
                }}
                title="Quét toàn bộ ahrefs_results, lấy MAX(DR) cho mỗi ref_domain, upsert vào backlink_db. Idempotent."
              >
                <Database className="h-3.5 w-3.5" />
                {backfilling ? "Đang backfill…" : "Backfill từ Ahrefs"}
              </Button>

              <Button
                size="sm" variant="outline"
                className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10 ml-auto"
                onClick={clearDb}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Xóa tất cả
              </Button>
            </div>

            {/* CSV import */}
            {dbImportOpen && (
              <div className="mb-4 space-y-2 p-4 rounded-lg border bg-muted/20">
                <p className="text-xs text-muted-foreground">
                  Format mỗi dòng:{" "}
                  <code className="font-mono bg-muted px-1.5 py-0.5 rounded">domain.com,75</code>
                  {" "}(không cần header)
                </p>
                <textarea
                  value={dbCsvText}
                  onChange={(e) => setDbCsvText(e.target.value)}
                  rows={5}
                  placeholder={"example.com,78\nanothersite.org,55\n..."}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={importCsv} className="gap-1.5">
                    <Upload className="h-3.5 w-3.5" />
                    Import
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setDbImportOpen(false); setDbCsvText(""); }}>
                    Hủy
                  </Button>
                </div>
              </div>
            )}

            {/* Search */}
            {dbEntries.length > 0 && (
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Tìm domain trong DB..."
                  value={dbSearch}
                  onChange={(e) => setDbSearch(e.target.value)}
                  className="pl-8 text-sm h-8"
                />
              </div>
            )}

            {/* DB list */}
            {dbEntries.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">
                DB trống — thêm domain tham chiếu (Thêm / Import CSV / Backfill từ Ahrefs) để bắt đầu
              </p>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Domain</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-24">DR</th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDb.slice(0, 200).map((entry) => (
                      <tr key={entry.domain} className="border-b border-border/30 hover:bg-muted/30 group">
                        <td className="px-4 py-2 font-mono text-xs">{entry.domain}</td>
                        <td className="px-4 py-2"><DrBadge dr={entry.dr} small /></td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => removeFromDb(entry.domain)}
                            className="opacity-0 group-hover:opacity-100 transition text-destructive hover:opacity-80"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredDb.length > 200 && (
                  <p className="text-center text-xs text-muted-foreground py-2">
                    Hiển thị 200/{filteredDb.length} entries
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Form nhập giá (Đã mua → lưu Kho Domain) ──────────────────────────── */}
      {purchaseOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPurchaseOpen(false)}>
          <div className="bg-card rounded-xl border shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h3 className="text-sm font-semibold">Đã mua {Object.keys(purchaseRows).length} domain — nhập giá mua ($)</h3>
              <button onClick={() => setPurchaseOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="px-5 py-3 border-b flex items-center gap-2">
              <Input type="number" placeholder="Giá chung ($)" value={purchaseBulk} onChange={(e) => setPurchaseBulk(e.target.value)} className="w-36 text-sm" />
              <Button size="sm" variant="outline" onClick={applyPurchaseBulk} disabled={!purchaseBulk.trim()}>Áp dụng tất cả</Button>
              <span className="text-xs text-muted-foreground ml-auto">Để trống = chưa rõ giá</span>
            </div>
            <div className="flex-1 overflow-auto px-5 py-3 space-y-2">
              {Object.keys(purchaseRows).map((d) => (
                <div key={d} className="flex items-center gap-2">
                  <span className="flex-1 font-mono text-xs truncate" title={d}>{d}</span>
                  <Input
                    type="number" placeholder="Giá $"
                    value={purchaseRows[d]}
                    onChange={(e) => setPurchaseRows((prev) => ({ ...prev, [d]: e.target.value }))}
                    className="w-28 text-sm"
                  />
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPurchaseOpen(false)}>Hủy</Button>
              <Button size="sm" onClick={savePurchase} disabled={savingPurchase} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                {savingPurchase ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Lưu Kho Domain
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toasts ─────────────────────────────────────────────────────────────── */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white pointer-events-auto",
              t.isError ? "bg-destructive" : "bg-gray-800 dark:bg-gray-700"
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating) return <span className="text-xs text-muted-foreground italic">—</span>;
  const r = rating.toUpperCase();
  const color =
    r.includes("RẤT XẤU") ? "bg-red-200 dark:bg-red-950 text-red-800 dark:text-red-300"
    : r.includes("XẤU") ? "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300"
    : r.includes("RỦI RO") ? "bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300"
    : r.includes("TRUNG BÌNH") ? "bg-yellow-100 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300"
    : r.includes("TỐT") ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
    : "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", color)}>
      {rating}
    </span>
  );
}

function DrBadge({ dr, small = false }: { dr: number; small?: boolean }) {
  const color =
    dr >= 70 ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
    : dr >= 40 ? "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
    : dr >= 20 ? "bg-yellow-100 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300"
    : "bg-muted text-muted-foreground";
  return (
    <span className={cn(
      "inline-flex items-center font-bold rounded-full",
      small ? "text-xs px-1.5 py-0.5" : "text-sm px-2 py-0.5",
      color
    )}>
      {dr}
    </span>
  );
}

