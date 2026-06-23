"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Search,
  ChevronDown,
  Database,
  Trash2,
  Plus,
  X,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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

