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
  ArrowUpDown,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DomainResult } from "@/app/api/aged-domain/analyze/route";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DbEntry {
  domain: string;
  dr: number;
}

interface ToastItem {
  id: number;
  message: string;
  isError: boolean;
}

type V1SortKey = "domain" | "dbMatches" | "totalRefDomains" | "maxDbDr";

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgedDomainPage() {
  // ── Form inputs ──────────────────────────────────────────────────────────────
  const [domainsText, setDomainsText] = useState("");
  const [minDr, setMinDr] = useState(30);
  const [limitPerDomain, setLimitPerDomain] = useState(100);
  const [minQualified, setMinQualified] = useState(0); // 0 = show all

  // ── Analysis state ───────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [v1Results, setV1Results] = useState<DomainResult[] | null>(null);
  const [v1Cost, setV1Cost] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Sort & expand ────────────────────────────────────────────────────────────
  const [v1SortKey, setV1SortKey] = useState<V1SortKey>("dbMatches");
  const [v1SortDir, setV1SortDir] = useState<1 | -1>(-1);

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // ── Backlink DB ─────────────────────────────────────────────────────────────
  const [dbEntries, setDbEntries] = useState<DbEntry[]>([]);
  const [dbOpen, setDbOpen] = useState(false);
  const [dbManualDomain, setDbManualDomain] = useState("");
  const [dbManualDr, setDbManualDr] = useState("");
  const [dbCsvText, setDbCsvText] = useState("");
  const [dbImportOpen, setDbImportOpen] = useState(false);
  const [dbSearch, setDbSearch] = useState("");
  const [backfilling, setBackfilling] = useState(false);

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

  // ─── Analyze (V1 — DataforSEO) ───────────────────────────────────────────────

  const analyzeV1 = useCallback(async () => {
    const domains = domainsText.split("\n").map((d) => d.trim()).filter(Boolean);
    if (!domains.length) return;

    setLoading(true);
    setError(null);
    setV1Results(null);
    setV1Cost(null);
    setExpandedRows(new Set());

    try {
      const res = await fetch("/api/aged-domain/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains, minDr, limitPerDomain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Phân tích thất bại");
      setV1Results(data.results ?? []);
      setV1Cost(data.cost ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setLoading(false);
    }
  }, [domainsText, minDr, limitPerDomain]);


  const handleAnalyze = analyzeV1;

  // ─── Sort helper ──────────────────────────────────────────────────────────────

  function handleV1Sort(key: V1SortKey) {
    if (v1SortKey === key) setV1SortDir((d) => (d === 1 ? -1 : 1));
    else { setV1SortKey(key); setV1SortDir(-1); }
  }

  // ─── Filtered + sorted results ────────────────────────────────────────────────

  const displayedV1 = v1Results
    ? [...v1Results]
        .filter((r) => r.dbMatches >= minQualified)
        .sort((a, b) => {
          const getVal = (r: DomainResult) =>
            v1SortKey === "maxDbDr" ? r.maxDbDr : (r[v1SortKey as keyof DomainResult] ?? 0);
          const av = getVal(a) as number | string;
          const bv = getVal(b) as number | string;
          if (typeof av === "number" && typeof bv === "number") return (av - bv) * v1SortDir;
          return String(av).localeCompare(String(bv)) * v1SortDir;
        })
    : [];

  // ─── CSV import ───────────────────────────────────────────────────────────────

  async function importCsv() {
    const lines = dbCsvText.trim().split("\n");
    const entries: DbEntry[] = [];
    for (const line of lines) {
      const parts = line.split(",").map((s) => s.trim());
      if (parts.length >= 2) {
        const domain = parts[0].replace(/^["']|["']$/g, "");
        const dr = parseInt(parts[1]);
        if (domain && !isNaN(dr)) entries.push({ domain, dr });
      }
    }
    if (!entries.length) { showToast("❌ Không parse được dữ liệu CSV", true); return; }
    try {
      const data = await addToDb(entries);
      setDbCsvText("");
      setDbImportOpen(false);
      showToast(`✅ Import ${data?.added ?? 0} domain mới (${entries.length} dòng)`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  const filteredDb = [...dbEntries]
    .filter((e) => !dbSearch || e.domain.includes(dbSearch.toLowerCase()))
    .sort((a, b) => b.dr - a.dr);

  const domainCount = domainsText.split("\n").filter((s) => s.trim()).length;

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6">

      {/* ── Header ─────────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Aged Domain — Phân tích Backlink</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Paste domain → phân tích Referring Domains → lọc domain đạt điều kiện DR.
        </p>
      </div>

      {/* ── DB empty warning ────────────────────────────────────────────────── */}
      {dbEntries.length === 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            <strong>Backlink DB đang trống.</strong>{" "}
            DataforSEO cần DB để tra cứu DR. Hãy thêm domain tham chiếu (Domain + DR) vào DB,
            hoặc dùng <strong>Domain Picker</strong> với Ahrefs MCP để lấy DR trực tiếp.
          </span>
        </div>
      )}

      {/* ── Config card ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <p className="text-xs text-muted-foreground mb-4">
          DataforSEO → danh sách Referring Domains → đối chiếu Backlink DB để lấy DR → lọc.
          (Option Ahrefs đã chuyển sang <strong>Domain Picker</strong>.)
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              DR tối thiểu
            </label>
            <Input type="number" min={0} max={100} value={minDr}
              onChange={(e) => setMinDr(Number(e.target.value))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Ref. domains / target
            </label>
            <Input type="number" min={1} max={1000} value={limitPerDomain}
              onChange={(e) => setLimitPerDomain(Number(e.target.value))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              DB Matches tối thiểu
              <span className="ml-1 text-muted-foreground/60">(0 = tất cả)</span>
            </label>
            <Input type="number" min={0} value={minQualified}
              onChange={(e) => setMinQualified(Number(e.target.value))} />
          </div>
          <div className="flex flex-col justify-end">
            <p className="text-xs text-muted-foreground mb-1">
              {domainCount} domain · DB: {dbEntries.length} entries
            </p>
            <Button onClick={handleAnalyze} disabled={loading || !domainCount} className="gap-2 w-full">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {loading ? "Đang phân tích..." : "Phân tích"}
            </Button>
          </div>
        </div>

        {/* Domain textarea */}
        <div>
          <label className="block text-sm font-medium mb-1">
            Danh sách Domain{" "}
            <span className="text-muted-foreground font-normal">(mỗi dòng một domain)</span>
          </label>
          <textarea
            value={domainsText}
            onChange={(e) => setDomainsText(e.target.value)}
            rows={6}
            placeholder={"example.com\nanotherdomain.net\n..."}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
          />
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────────────────── */}
      {v1Results !== null && (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center justify-between px-5 py-4 border-b flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium">
                {displayedV1.length} / {v1Results.length} domain
                {minQualified > 0 && (
                  <span className="text-muted-foreground"> (DB Matches ≥ {minQualified})</span>
                )}
              </span>
              {v1Cost !== null && (
                <Badge variant="secondary" className="text-xs">
                  Cost: ${v1Cost.toFixed(4)}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-blue-600 dark:text-blue-400">DB Match</span>
              {" "}= Referring Domain có trong DB với DR ≥ {minDr}
            </p>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <th className="px-4 py-3 w-8" />
                  <SortTh label="Domain" col="domain" current={v1SortKey} dir={v1SortDir} onSort={() => handleV1Sort("domain")} />
                  <SortTh label="DB Matches" col="dbMatches" current={v1SortKey} dir={v1SortDir} onSort={() => handleV1Sort("dbMatches")} />
                  <SortTh label="Total Ref. Domains" col="totalRefDomains" current={v1SortKey} dir={v1SortDir} onSort={() => handleV1Sort("totalRefDomains")} />
                  <SortTh label="Max DR (DB)" col="maxDbDr" current={v1SortKey} dir={v1SortDir} onSort={() => handleV1Sort("maxDbDr")} />
                </tr>
              </thead>
              <tbody>
                {displayedV1.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-muted-foreground text-sm">
                      Không có domain nào đạt điều kiện DB Matches ≥ {minQualified}
                    </td>
                  </tr>
                ) : (
                  displayedV1.map((item) => {
                    const expanded = expandedRows.has(item.domain);
                    return (
                      <Fragment key={item.domain}>
                        <tr
                          className={cn(
                            "border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer",
                            item.error && "opacity-60"
                          )}
                          onClick={() =>
                            setExpandedRows((prev) => {
                              const next = new Set(prev);
                              expanded ? next.delete(item.domain) : next.add(item.domain);
                              return next;
                            })
                          }
                        >
                          <td className="px-4 py-3 text-muted-foreground">
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </td>
                          <td className="px-4 py-3 font-mono font-medium">
                            {item.domain}
                            {item.error && (
                              <span className="ml-2 text-xs text-destructive">({item.error})</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <QualifiedBadge count={item.dbMatches} />
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {item.totalRefDomains.toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <DrBadge dr={item.maxDbDr} />
                          </td>
                        </tr>
                        {expanded && item.topDomains.length > 0 && (
                          <tr className="bg-muted/20 border-b border-border/30">
                            <td colSpan={5} className="px-6 py-4">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                                Top Referring Domains (DataforSEO)
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {item.topDomains.map((td) => (
                                  <div
                                    key={td.domain}
                                    className={cn(
                                      "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs",
                                      td.inDb
                                        ? "border-blue-300 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-700"
                                        : "border-border bg-muted/30"
                                    )}
                                  >
                                    {td.dbDr !== null
                                      ? <DrBadge dr={td.dbDr} small />
                                      : <span className="inline-flex items-center font-bold rounded-full text-xs px-1.5 py-0.5 bg-muted text-muted-foreground">?</span>
                                    }
                                    <span className="font-mono">{td.domain}</span>
                                    <span className="text-muted-foreground">({td.backlinks} links)</span>
                                    {td.inDb && (
                                      <span title="Có trong Backlink DB">
                                        <Database className="h-3 w-3 text-blue-500" />
                                      </span>
                                    )}
                                    <a
                                      href={`https://${td.domain}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-muted-foreground hover:text-primary"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
              Cơ sở dữ liệu domain tham chiếu <strong>(Domain, DR)</strong>.
              Option 1 tra cứu DR của Referring Domains tại đây.
              Option 2 có thể <strong>tự động enrich</strong> DB sau mỗi lần phân tích.
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
                DB trống — thêm domain tham chiếu để bắt đầu so sánh (Option 1),
                hoặc dùng Option 2 để tự động enrich
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

function SortTh({ label, col, current, dir, onSort }: {
  label: string; col: string; current: string; dir: 1 | -1; onSort: () => void;
}) {
  const active = current === col;
  return (
    <th
      onClick={onSort}
      className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:bg-muted/50 whitespace-nowrap"
    >
      <span className="flex items-center gap-1">
        {label}
        <ArrowUpDown className={cn("h-3 w-3", active ? "text-primary" : "opacity-30")} />
        {active && <span className="text-primary">{dir === -1 ? "↓" : "↑"}</span>}
      </span>
    </th>
  );
}

function QualifiedBadge({ count }: { count: number }) {
  return (
    <span className={cn(
      "inline-flex items-center justify-center min-w-[2.5rem] px-2.5 py-1 rounded-full text-sm font-bold",
      count >= 5
        ? "bg-blue-600 text-white"
        : count >= 1
          ? "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
          : "bg-muted text-muted-foreground"
    )}>
      {count}
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

