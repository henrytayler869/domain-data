"use client";

import React, { useState, useCallback, useEffect, useRef, useMemo, useReducer } from "react";
import {
  Upload,
  Search,
  ChevronDown,
  ArrowUpDown,
  ExternalLink,
  Loader2,
  Database,
  Trash2,
  X,
  AlertCircle,
  FileSpreadsheet,
  Save,
  Filter as FilterIcon,
  Copy,
  Check,
  Download,
  Plus,
  Ban,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Stepper } from "@/components/ui/stepper";
import { cn } from "@/lib/utils";
import {
  parseCsv,
  mapRows,
  applyScores,
  passesThresholds,
  parseAhrefsCsv,
  parseUnifiedCsv,
  REF_BLACKLIST,
  type PickerRow,
} from "@/lib/picker-csv";
import type { PickerEntry } from "@/lib/picker-db";
import type { TargetSummary } from "@/lib/ahrefs-db";
import type { RefBlacklistEntry } from "@/lib/ref-blacklist-db";
import {
  wizardReducer,
  initialWizardState,
  saveSnapshot,
  loadSnapshot,
  WIZARD_STEPS,
  type WizardStep,
} from "./wizard-state";

// ─── Types ────────────────────────────────────────────────────────────────────

type SortKey = "score" | "domain" | "source" | "tf" | "cf" | "rd" | "da" | "age" | "szScore" | "szDrops" | "semTraffic";

interface ToastItem {
  id: number;
  message: string;
  isError: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DomainPickerPage() {
  // ── File / parsed rows ──────────────────────────────────────────────────────
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<PickerRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  // ── Wizard state (step + completed + presets + thresholds + weights + topN) ──
  const [wizard, dispatchWizard] = useReducer(wizardReducer, undefined, initialWizardState);
  const { thresholds, weights, topN, presetName } = wizard;

  // Hydrate from localStorage on mount, persist on every wizard change.
  useEffect(() => {
    const snap = loadSnapshot();
    if (snap) dispatchWizard({ type: "hydrate", snapshot: snap });
  }, []);

  useEffect(() => {
    saveSnapshot(wizard);
  }, [wizard]);

  // ── Sort ────────────────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  // ── DB ──────────────────────────────────────────────────────────────────────
  const [dbEntries, setDbEntries] = useState<PickerEntry[]>([]);
  const [dbOpen, setDbOpen] = useState(false);
  const [dbSearch, setDbSearch] = useState("");
  const [savingDb, setSavingDb] = useState(false);

  // ── Ahrefs Result DB ────────────────────────────────────────────────────────
  const [ahrefsSummary, setAhrefsSummary] = useState<TargetSummary[]>([]);
  // UI-only hide cutoff (timestamp). When set, only show targets with checkedAt > this.
  // Persisted in localStorage. Does NOT touch DB.
  const [viewClearedAt, setViewClearedAt] = useState<number | null>(null);
  // Targets from the most recent Ahrefs upload — always shown even if
  // their checked_at happens to be ≤ viewClearedAt due to clock skew
  // between client (sets viewClearedAt with Date.now()) and server
  // (writes checked_at with its own now()).
  const [justUploadedTargets, setJustUploadedTargets] = useState<Set<string>>(new Set());
  const [checkedTargets, setCheckedTargets] = useState<Set<string>>(new Set());
  const [ahrefsSearch, setAhrefsSearch] = useState("");
  const [ahrefsUploading, setAhrefsUploading] = useState(false);
  // Nguồn dữ liệu ref ở bước "Upload Result": Ahrefs (CSV) hoặc DataforSEO (API).
  const [resultSource, setResultSource] = useState<"ahrefs" | "dataforseo">("ahrefs");
  const [ingestingDfs, setIngestingDfs] = useState(false);
  // Ref domain DataforSEO trả về nhưng chưa có DR trong backlink_db — export
  // để user check DR thủ công rồi upload lại.
  const [dfsUnmatched, setDfsUnmatched] = useState<{ domain: string; backlinks: number }[]>([]);
  const [excludeChecked, setExcludeChecked] = useState(true);
  const [copiedAhrefsTargets, setCopiedAhrefsTargets] = useState(false);
  const [applyRefBlacklist, setApplyRefBlacklist] = useState(true);
  const [refBlacklistOpen, setRefBlacklistOpen] = useState(false);
  const [ahrefsSortKey, setAhrefsSortKey] = useState<"targetDomain" | "source" | "rating" | "category" | "checkedAt" | "refsCount">("refsCount");

  // ── Wayback Machine (step 4) ──────────────────────────────────────────────
  type WaybackRow = {
    targetDomain: string;
    snapshotCount: number | null;
    firstYear: string | null;
    lastYear: string | null;
    domainAge: number | null;
    hasBetting: boolean;
    hasAdult: boolean;
    contentHistory: Array<{ year: string; timestamp: string; summary: string; hasBetting: boolean; hasAdult: boolean; confidence: string; keywords: string[] }>;
    problematicSnapshots: Array<{ timestamp: string; url: string; title: string; summary: string; hasBetting: boolean; hasAdult: boolean; confidence: string; keywords: string[] }>;
    errorReason: string | null;
    checkedAt: string;
  };
  type WaybackRun = {
    runId: string;
    status: "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMING-OUT" | "TIMED-OUT" | "ABORTING" | "ABORTED";
    targets: string[];
    datasetId: string | null;
    startedAt: string;
    finishedAt: string | null;
    ingestedAt: string | null;
    error: string | null;
  };
  const [waybackResults, setWaybackResults] = useState<WaybackRow[]>([]);
  const [waybackRuns, setWaybackRuns] = useState<WaybackRun[]>([]);
  const [waybackStarting, setWaybackStarting] = useState(false);
  const [waybackExpanded, setWaybackExpanded] = useState<Set<string>>(new Set());
  const [ahrefsSortDir, setAhrefsSortDir] = useState<1 | -1>(-1);
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [filterRating, setFilterRating] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  // Separate filter for step 2 (Spamzilla picker) — sourced from scoredRows directly.
  const [step2FilterSource, setStep2FilterSource] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [filterPurchased, setFilterPurchased] = useState<"all" | "yes" | "no">("all");
  const [purchaseFormOpen, setPurchaseFormOpen] = useState(false);
  const [purchaseRows, setPurchaseRows] = useState<Record<string, string>>({}); // domain → price string
  // "purchase" = đã mua hẳn; "backorder" = chỉ đặt, chưa sở hữu.
  const [purchaseFormMode, setPurchaseFormMode] = useState<"purchase" | "backorder">("purchase");
  // Multi-select trong card Picker DB panel (độc lập với selectedTargets ở step 4).
  const [selectedDbDomains, setSelectedDbDomains] = useState<Set<string>>(new Set());
  const [purchaseBulkPrice, setPurchaseBulkPrice] = useState("");
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [excludingTargets, setExcludingTargets] = useState(false);
  const [inventory, setInventory] = useState<{ domain: string; purchasePrice: number | null }[]>([]);
  const [userBlacklist, setUserBlacklist] = useState<RefBlacklistEntry[]>([]);
  const [bulkAddText, setBulkAddText] = useState("");
  const [addingBulk, setAddingBulk] = useState(false);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);

  // ── Export helpers ──────────────────────────────────────────────────────────
  const [copiedDomains, setCopiedDomains] = useState(false);

  // ── Toasts ──────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

  const showToast = useCallback((message: string, isError = false) => {
    const id = ++toastIdRef.current;
    setToasts((p) => [...p, { id, message, isError }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
  }, []);

  // ─── Score recompute when weights change ─────────────────────────────────────
  const scoredRows = useMemo(() => applyScores(rawRows, weights), [rawRows, weights]);

  const thresholdQualified = useMemo(
    () => scoredRows.filter((r) => passesThresholds(r, thresholds)),
    [scoredRows, thresholds]
  );

  // Step 1: drop Ahrefs-checked targets (drives the "Excluded N đã check Ahrefs" badge).
  const qualifiedAfterChecked = useMemo(() => {
    if (!excludeChecked || checkedTargets.size === 0) return thresholdQualified;
    return thresholdQualified.filter((r) => !checkedTargets.has(r.domain));
  }, [thresholdQualified, excludeChecked, checkedTargets]);

  // Step 2: apply source filter on top. Final list feeds the table + count.
  const qualifiedRows = useMemo(() => {
    if (step2FilterSource === "all") return qualifiedAfterChecked;
    if (step2FilterSource === "none") return qualifiedAfterChecked.filter((r) => !r.source);
    return qualifiedAfterChecked.filter((r) => r.source === step2FilterSource);
  }, [qualifiedAfterChecked, step2FilterSource]);

  // Only counts Ahrefs-checked exclusions; source filter is shown separately.
  const excludedCount = thresholdQualified.length - qualifiedAfterChecked.length;

  const step2AvailableSources = useMemo(() => {
    const set = new Set<string>();
    for (const r of scoredRows) if (r.source) set.add(r.source);
    return Array.from(set).sort();
  }, [scoredRows]);

  // Reset to page 1 when the filter set or page size changes.
  useEffect(() => {
    setCurrentPage(1);
  }, [step2FilterSource, excludeChecked, topN, presetName, thresholds]);

  // Stable sorted list; pagination slices below.
  const sortedRows = useMemo(() => {
    return [...qualifiedRows].sort((a, b) => {
      const av = a[sortKey] as number | string;
      const bv = b[sortKey] as number | string;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
  }, [qualifiedRows, sortKey, sortDir]);

  // topN is the page size; topN === 0 means "no pagination, show all".
  const totalPages = topN > 0 ? Math.max(1, Math.ceil(sortedRows.length / topN)) : 1;
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  const displayedRows = useMemo(() => {
    if (topN === 0) return sortedRows;
    const start = (safePage - 1) * topN;
    return sortedRows.slice(start, start + topN);
  }, [sortedRows, topN, safePage]);

  // ─── DB ─────────────────────────────────────────────────────────────────────

  const loadDb = useCallback(async () => {
    try {
      const res = await fetch("/api/domain-picker/db");
      const data = await res.json();
      setDbEntries(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  }, []);

  const loadAhrefs = useCallback(async () => {
    try {
      const [sumRes, chkRes] = await Promise.all([
        fetch("/api/ahrefs-results/db"),
        fetch("/api/ahrefs-results/db/checked"),
      ]);
      const sumData = await sumRes.json();
      const chkData = await chkRes.json();
      setAhrefsSummary(Array.isArray(sumData) ? sumData : []);
      setCheckedTargets(new Set((chkData?.targets ?? []) as string[]));
    } catch { /* ignore */ }
  }, []);

  const loadWayback = useCallback(async () => {
    try {
      const [resultsRes, runsRes] = await Promise.all([
        fetch("/api/wayback/results"),
        fetch("/api/wayback/runs"),
      ]);
      const resultsData = await resultsRes.json();
      const runsData = await runsRes.json();
      setWaybackResults(resultsData.rows ?? []);
      setWaybackRuns(runsData.runs ?? []);
    } catch { /* ignore */ }
  }, []);

  const startWaybackCheck = useCallback(async (targets: string[]) => {
    if (!targets.length) return;
    setWaybackStarting(true);

    // Split into batches of 10 — Apify actor times out on large input
    // lists. Trigger với concurrency cap 5 để chạy nhanh nhưng không
    // dội Apify API quá tải.
    const BATCH_SIZE = 10;
    const CONCURRENCY = 5;
    const batches: string[][] = [];
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      batches.push(targets.slice(i, i + BATCH_SIZE));
    }

    if (batches.length > 1) {
      showToast(`🚀 Trigger ${batches.length} Wayback runs (${BATCH_SIZE} domain/run, ${targets.length} target)…`);
    }

    const results: PromiseSettledResult<unknown>[] = new Array(batches.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
      while (cursor < batches.length) {
        const i = cursor++;
        try {
          const res = await fetch("/api/wayback/runs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targets: batches[i] }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Start run thất bại");
          results[i] = { status: "fulfilled", value: data };
        } catch (e) {
          results[i] = { status: "rejected", reason: e };
        }
      }
    });

    try {
      await Promise.all(workers);
      const ok = results.filter((r) => r?.status === "fulfilled").length;
      const failed = results.filter((r) => r?.status === "rejected");
      if (failed.length === 0) {
        showToast(
          batches.length === 1
            ? `✅ Đã trigger Wayback run · ${targets.length} target`
            : `✅ Đã trigger ${ok} runs · ${targets.length} target (${BATCH_SIZE}/run)`,
        );
      } else {
        const firstErr = failed[0]?.status === "rejected" ? String((failed[0] as PromiseRejectedResult).reason).slice(0, 80) : "unknown";
        showToast(`⚠️ ${ok}/${batches.length} runs OK · ${failed.length} lỗi (${firstErr})`, true);
      }
      await loadWayback();
    } finally {
      setWaybackStarting(false);
    }
  }, [loadWayback, showToast]);

  const pollWaybackRun = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/wayback/runs/${encodeURIComponent(runId)}`);
      const data = await res.json();
      if (!res.ok) return;
      // Refresh both lists so newly ingested results show up.
      if (data.ingested?.count) {
        const ex = data.ingested.autoExcluded ?? 0;
        showToast(
          ex > 0
            ? `✅ Wayback ingested ${data.ingested.count} kết quả · 🚫 auto loại trừ ${ex} flagged`
            : `✅ Wayback ingested ${data.ingested.count} kết quả`,
        );
        if (ex > 0) {
          // Auto-exclude must also beat the re-upload visibility bypass,
          // same as a manual "Loại trừ" — otherwise targets uploaded in this
          // session keep showing despite excluded_at being set.
          const exDomains: string[] = data.ingested.autoExcludedDomains ?? [];
          if (exDomains.length > 0) {
            setJustUploadedTargets((prev) => {
              if (prev.size === 0) return prev;
              const next = new Set(prev);
              for (const d of exDomains) next.delete(d);
              return next;
            });
          }
          // Refresh Ahrefs list so flagged rows drop out of the picker immediately.
          await loadAhrefs();
        }
      }
      await loadWayback();
    } catch { /* ignore */ }
  }, [loadWayback, loadAhrefs, showToast]);

  // Auto-poll any RUNNING runs every 10s while user is on step 4.
  useEffect(() => {
    if (wizard.step !== 4) return;
    const running = waybackRuns.filter((r) => r.status === "READY" || r.status === "RUNNING");
    if (running.length === 0) return;
    const id = setInterval(() => {
      for (const r of running) pollWaybackRun(r.runId);
    }, 10000);
    return () => clearInterval(id);
  }, [wizard.step, waybackRuns, pollWaybackRun]);

  const loadUserBlacklist = useCallback(async () => {
    try {
      const res = await fetch("/api/ref-blacklist");
      const data = await res.json();
      setUserBlacklist(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  }, []);

  const loadInventory = useCallback(async () => {
    try {
      const res = await fetch("/api/inventory");
      const data = await res.json();
      setInventory(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  }, []);

  const purchasedSet = useMemo(
    () => new Set(inventory.map((e) => e.domain)),
    [inventory]
  );

  useEffect(() => { loadDb(); loadAhrefs(); loadUserBlacklist(); loadInventory(); loadWayback(); }, [loadDb, loadAhrefs, loadUserBlacklist, loadInventory, loadWayback]);

  useEffect(() => {
    try {
      const v = localStorage.getItem("ahrefs.viewClearedAt");
      if (v) setViewClearedAt(parseInt(v, 10) || null);
    } catch { /* ignore */ }
  }, []);

  const updateViewClearedAt = useCallback((ts: number | null) => {
    setViewClearedAt(ts);
    try {
      if (ts == null) localStorage.removeItem("ahrefs.viewClearedAt");
      else localStorage.setItem("ahrefs.viewClearedAt", String(ts));
    } catch { /* ignore */ }
  }, []);

  const saveAllToDb = useCallback(async () => {
    if (!scoredRows.length) return;
    setSavingDb(true);
    try {
      const entries: Omit<PickerEntry, "addedAt">[] = scoredRows.map((r) => ({
        domain: r.domain,
        source: r.source,
        tf: r.tf,
        cf: r.cf,
        bl: r.bl,
        rd: r.rd,
        da: r.da,
        pa: r.pa,
        age: r.age,
        szScore: r.szScore,
        szDrops: r.szDrops,
        semTraffic: r.semTraffic,
        semKeywords: r.semKeywords,
        price: r.price,
        expires: r.expires,
        score: r.score,
      }));
      const res = await fetch("/api/domain-picker/db/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lưu thất bại");
      await loadDb();
      showToast(`✅ Đã lưu: ${data.added} mới, ${data.updated} cập nhật (tổng ${data.total} entries)`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setSavingDb(false);
    }
  }, [scoredRows, loadDb, showToast]);

  const removeFromDb = useCallback(async (domain: string) => {
    await fetch(`/api/domain-picker/db/${encodeURIComponent(domain)}`, { method: "DELETE" });
    await loadDb();
  }, [loadDb]);

  const clearDb = useCallback(async () => {
    if (!dbEntries.length) return;
    if (!confirm(`Xóa toàn bộ ${dbEntries.length} entries khỏi Picker DB?`)) return;
    await fetch("/api/domain-picker/db", { method: "DELETE" });
    await loadDb();
    showToast("🗑️ Đã xóa toàn bộ Picker DB");
  }, [dbEntries.length, loadDb, showToast]);

  // ─── Ahrefs Result DB handlers ──────────────────────────────────────────────

  const uploadAhrefsCsv = useCallback(async (file: File) => {
    setAhrefsUploading(true);
    try {
      const text = await file.text();

      // Try unified format first (6 columns), fall back to legacy 3-column ahrefs format
      let unifiedRows: ReturnType<typeof parseUnifiedCsv> = [];
      let legacyRows: ReturnType<typeof parseAhrefsCsv> = [];
      let unifiedErr: string | null = null;
      try {
        unifiedRows = parseUnifiedCsv(text);
      } catch (e) {
        unifiedErr = e instanceof Error ? e.message : "parse error";
      }
      if (!unifiedRows.length) {
        try {
          legacyRows = parseAhrefsCsv(text);
        } catch {
          // Both parsers failed
          throw new Error(unifiedErr ?? "CSV không đúng format");
        }
      }

      // Build payload from unified rows
      let refsRows: { targetDomain: string; refDomain: string; domainRating: number }[] = [];
      let assessments: { targetDomain: string; rating: string | null; category: string | null; detail: string | null }[] = [];

      if (unifiedRows.length) {
        for (const u of unifiedRows) {
          for (const r of u.refs) {
            refsRows.push({ targetDomain: u.targetDomain, refDomain: r.domain, domainRating: r.dr });
          }
          if (u.rating || u.category || u.detail) {
            assessments.push({
              targetDomain: u.targetDomain,
              rating: u.rating || null,
              category: u.category || null,
              detail: u.detail || null,
            });
          }
        }
      } else {
        // legacy format
        refsRows = legacyRows.map((r) => ({
          targetDomain: r.targetDomain,
          refDomain: r.refDomain,
          domainRating: r.domainRating,
        }));
      }

      if (!refsRows.length && !assessments.length) {
        throw new Error("CSV không có dòng dữ liệu hợp lệ");
      }

      const res = await fetch("/api/ahrefs-results/db/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: refsRows, assessments }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload thất bại");
      // Remember which targets just landed so the viewClearedAt filter
      // doesn't accidentally hide them (clock skew between client/server).
      const uploadedTargets = new Set<string>([
        ...refsRows.map((r) => r.targetDomain),
        ...assessments.map((a) => a.targetDomain),
      ]);
      setJustUploadedTargets(uploadedTargets);
      await loadAhrefs();
      const refStat = data.refs;
      const assessStat = data.assessments;
      const parts: string[] = [];
      if (refStat?.uniqueTargets) parts.push(`${refStat.uniqueTargets} target · ${refStat.total} ref rows`);
      if (assessStat?.total) parts.push(`${assessStat.total} assessment`);
      showToast(`✅ Upload OK · ${parts.join(" · ") || "no data"}`);
      // Auto-advance to step 4 — user is now reviewing & deciding.
      dispatchWizard({ type: "advance", from: 3 });
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setAhrefsUploading(false);
    }
  }, [loadAhrefs, showToast]);

  // DataforSEO ingest: lấy ref domain cho list domain trong picker (scoredRows),
  // server đối sánh DR từ backlink_db rồi ghi vào ahrefs_results như Ahrefs.
  const ingestDataforseo = useCallback(async () => {
    const targets = scoredRows.map((r) => r.domain);
    if (targets.length === 0) {
      showToast("Không có domain nào trong danh sách (upload Spamzilla ở bước 1)", true);
      return;
    }
    if (!confirm(
      `Chạy DataforSEO cho ${targets.length} domain?\n` +
      `Mỗi domain tốn credit DataforSEO. Ref domain sẽ được đối sánh DR từ dữ liệu đã thu thập (backlink_db).`,
    )) return;
    setIngestingDfs(true);
    try {
      const res = await fetch("/api/ahrefs-results/db/ingest-dataforseo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "DataforSEO ingest thất bại");
      // Các target vừa ingest luôn hiển thị (vượt qua viewClearedAt bypass).
      setJustUploadedTargets(new Set(targets.map((t) => t.toLowerCase())));
      await loadAhrefs();
      // Lưu ref chưa có DR để export.
      setDfsUnmatched(Array.isArray(data.unmatchedRefs) ? data.unmatchedRefs : []);
      const refStat = data.refs;
      const parts = [`${data.targetsRequested} target`];
      if (refStat?.total) parts.push(`${refStat.total} ref rows khớp DR`);
      parts.push(`${data.refsMatched}/${data.refsSeen} ref match`);
      if (data.unmatchedUnique) parts.push(`${data.unmatchedUnique} ref chưa có DR`);
      if (data.dataforseoCost) parts.push(`$${Number(data.dataforseoCost).toFixed(4)} DfS`);
      showToast(`✅ DataforSEO OK · ${parts.join(" · ")}`);
      if (Array.isArray(data.errors) && data.errors.length) {
        showToast(`⚠️ ${data.errors.length} batch lỗi: ${String(data.errors[0]).slice(0, 60)}`, true);
      }
      dispatchWizard({ type: "advance", from: 3 });
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setIngestingDfs(false);
    }
  }, [scoredRows, loadAhrefs, showToast]);

  // Export ref domain DataforSEO chưa có DR → CSV "domain,dr,backlinks".
  // User điền cột dr rồi upload lại ở Aged Domain → Backlink DB → Import CSV
  // (đọc domain,dr; cột backlinks bỏ qua). Sau đó re-run DataforSEO sẽ match.
  const exportUnmatchedRefs = useCallback(() => {
    if (dfsUnmatched.length === 0) return;
    const header = "domain,dr,backlinks";
    const rows = dfsUnmatched.map((r) => `${r.domain},,${r.backlinks}`);
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `dataforseo-refs-no-dr-${ts}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`✅ Export ${dfsUnmatched.length} ref chưa có DR → điền cột dr rồi Import ở Aged Domain`);
  }, [dfsUnmatched, showToast]);

  const removeAhrefsTarget = useCallback(async (domain: string) => {
    await fetch(`/api/ahrefs-results/db/${encodeURIComponent(domain)}`, { method: "DELETE" });
    await loadAhrefs();
  }, [loadAhrefs]);

  const effectiveBlacklist = useMemo(
    () => new Set(userBlacklist.map((e) => e.domain.toLowerCase())),
    [userBlacklist]
  );

  // Source map: target_domain → source (from picker_domains)
  const sourceMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of dbEntries) if (e.source) m.set(e.domain, e.source);
    return m;
  }, [dbEntries]);

  // Severity rank for rating sort (high = worse)
  const RATING_RANK: Record<string, number> = {
    "❌ RẤT XẤU": 5, "❌ XẤU": 4, "⚠️ RỦI RO": 3, "⚠️ TRUNG BÌNH": 2, "✅ TỐT": 1,
  };

  const filteredAhrefs = useMemo(() => {
    const bySearch = ahrefsSummary.filter((t) => {
      const isJustUploaded = justUploadedTargets.has(t.targetDomain);
      // Manually excluded — domain already bought by someone else, hide entirely.
      // BUT re-uploading the domain in the same session means the user wants to
      // re-evaluate, so bypass this filter for just-uploaded targets.
      if (t.excluded && !isJustUploaded) return false;
      // UI-only hide: skip entries last-checked at-or-before viewClearedAt.
      // Also bypassed for just-uploaded targets — clock skew between client
      // Date.now() and server now() makes the timestamp comparison unreliable.
      if (viewClearedAt != null && !isJustUploaded) {
        const t0 = new Date(t.checkedAt).getTime();
        if (t0 <= viewClearedAt) return false;
      }
      if (ahrefsSearch && !t.targetDomain.includes(ahrefsSearch.toLowerCase())) return false;
      if (filterRating !== "all") {
        if (filterRating === "none") {
          if (t.rating) return false;
        } else if (t.rating !== filterRating) return false;
      }
      if (filterSource !== "all") {
        const src = sourceMap.get(t.targetDomain) ?? "";
        if (filterSource === "none") {
          if (src) return false;
        } else if (src !== filterSource) return false;
      }
      if (filterPurchased !== "all") {
        const isPurchased = purchasedSet.has(t.targetDomain);
        if (filterPurchased === "yes" && !isPurchased) return false;
        if (filterPurchased === "no" && isPurchased) return false;
      }
      return true;
    });
    const enriched = bySearch.map((t) => {
      const cleanRefs = applyRefBlacklist
        ? t.refs.filter((r) => !effectiveBlacklist.has(r.domain))
        : t.refs;
      return {
        ...t,
        refs: cleanRefs,
        refsCount: applyRefBlacklist ? cleanRefs.length : t.refsCount,
        maxDr: applyRefBlacklist ? (cleanRefs.length ? cleanRefs[0].dr : 0) : t.maxDr,
        source: sourceMap.get(t.targetDomain) ?? "",
      };
    });
    const visible = enriched.filter((t) => t.refsCount > 0);

    return [...visible].sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (ahrefsSortKey === "rating") {
        av = a.rating ? (RATING_RANK[a.rating] ?? 0) : 0;
        bv = b.rating ? (RATING_RANK[b.rating] ?? 0) : 0;
      } else if (ahrefsSortKey === "checkedAt") {
        av = new Date(a.checkedAt).getTime();
        bv = new Date(b.checkedAt).getTime();
      } else {
        av = (a[ahrefsSortKey] ?? "") as string | number;
        bv = (b[ahrefsSortKey] ?? "") as string | number;
      }
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * ahrefsSortDir;
      return String(av).localeCompare(String(bv)) * ahrefsSortDir;
    });
  }, [ahrefsSummary, ahrefsSearch, applyRefBlacklist, effectiveBlacklist, sourceMap, ahrefsSortKey, ahrefsSortDir, filterRating, filterSource, filterPurchased, purchasedSet, viewClearedAt, justUploadedTargets]);

  const handleAhrefsSort = (key: typeof ahrefsSortKey) => {
    if (ahrefsSortKey === key) setAhrefsSortDir((d) => (d === 1 ? -1 : 1));
    else { setAhrefsSortKey(key); setAhrefsSortDir(-1); }
  };

  const toggleTargetSelection = useCallback((domain: string) => {
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }, []);

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedTargets((prev) => {
      const visibleDomains = filteredAhrefs.slice(0, 200).map((t) => t.targetDomain);
      const allSelected = visibleDomains.length > 0 && visibleDomains.every((d) => prev.has(d));
      if (allSelected) {
        const next = new Set(prev);
        for (const d of visibleDomains) next.delete(d);
        return next;
      }
      const next = new Set(prev);
      for (const d of visibleDomains) next.add(d);
      return next;
    });
  }, [filteredAhrefs]);

  const clearSelection = useCallback(() => setSelectedTargets(new Set()), []);

  const availableSources = useMemo(() => {
    const set = new Set<string>();
    for (const e of dbEntries) if (e.source) set.add(e.source);
    return Array.from(set).sort();
  }, [dbEntries]);

  // Open purchase form: prefill rows from selectedTargets
  const openPurchaseForm = useCallback((mode: "purchase" | "backorder" = "purchase") => {
    if (selectedTargets.size === 0) return;
    const init: Record<string, string> = {};
    for (const d of selectedTargets) {
      const inv = inventory.find((e) => e.domain === d);
      init[d] = inv?.purchasePrice != null ? String(inv.purchasePrice) : "";
    }
    setPurchaseRows(init);
    setPurchaseBulkPrice("");
    setPurchaseFormMode(mode);
    setPurchaseFormOpen(true);
  }, [selectedTargets, inventory]);

  // Same flow but sourced from the Picker DB checkbox column.
  const openPurchaseFormForDbDomains = useCallback((mode: "purchase" | "backorder" = "purchase") => {
    if (selectedDbDomains.size === 0) return;
    const init: Record<string, string> = {};
    for (const d of selectedDbDomains) {
      const inv = inventory.find((e) => e.domain === d);
      init[d] = inv?.purchasePrice != null ? String(inv.purchasePrice) : "";
    }
    setPurchaseRows(init);
    setPurchaseBulkPrice("");
    setPurchaseFormMode(mode);
    setPurchaseFormOpen(true);
  }, [selectedDbDomains, inventory]);

  const applyBulkPrice = useCallback(() => {
    const v = purchaseBulkPrice.trim();
    if (!v) return;
    const next: Record<string, string> = { ...purchaseRows };
    for (const d of Object.keys(next)) next[d] = v;
    setPurchaseRows(next);
  }, [purchaseBulkPrice, purchaseRows]);

  // Loại trừ — đánh dấu domain đã bị mua bởi người khác (không sở hữu được).
  // Thêm marker row vào ahrefs_results → vào checkedTargets set → bị filter bởi
  // toggle "Loại domain đã check Ahrefs". KHÔNG thêm vào kho/inventory.
  const excludeSelectedTargets = useCallback(async () => {
    if (selectedTargets.size === 0) return;
    const targets = Array.from(selectedTargets);
    if (!confirm(`Loại trừ ${targets.length} domain? Chúng sẽ bị ẩn khỏi danh sách (đã có người mua, không sở hữu được).`)) return;
    setExcludingTargets(true);
    try {
      const res = await fetch("/api/ahrefs-results/db/exclude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lỗi");
      // Drop from the just-uploaded bypass set — an explicit "Loại trừ" must
      // win over the re-upload visibility override, otherwise the row stays.
      setJustUploadedTargets((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        for (const t of targets) next.delete(t);
        return next;
      });
      await loadAhrefs();
      setSelectedTargets(new Set());
      showToast(`✅ Đã loại trừ ${targets.length} domain`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setExcludingTargets(false);
    }
  }, [selectedTargets, loadAhrefs, showToast]);

  // Mua thật qua Gname API — tiêu tiền thật nên confirm kỹ trước khi gửi.
  // Giá mua lấy từ response của Gname (số tiền bị freeze), không nhập tay.
  const [buyingGname, setBuyingGname] = useState(false);
  const buyViaGname = useCallback(async () => {
    if (selectedTargets.size === 0) return;
    const targets = Array.from(selectedTargets);
    const preview = targets.slice(0, 10).join("\n") + (targets.length > 10 ? `\n… +${targets.length - 10} domain nữa` : "");
    if (!confirm(
      `⚡ GỬI LỆNH MUA THẬT đến Gname cho ${targets.length} domain?\n\n${preview}\n\n` +
      `Tiền sẽ bị trừ từ số dư Gname. Domain mua thành công sẽ tự lưu vào kho với giá thực tế.`
    )) return;
    setBuyingGname(true);
    try {
      const meta: Record<string, { source: string | null; rating: string | null; category: string | null }> = {};
      for (const d of targets) {
        const t = ahrefsSummary.find((x) => x.targetDomain === d);
        meta[d] = {
          source: sourceMap.get(d) ?? null,
          rating: t?.rating ?? null,
          category: t?.category ?? null,
        };
      }
      const res = await fetch("/api/gname/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: targets, meta }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gname register thất bại");

      const results: { domain: string; ok: boolean; premium: boolean; msg: string; price: number | null }[] = data.results ?? [];
      const okDomains = results.filter((r) => r.ok).map((r) => r.domain);
      const premium = results.filter((r) => r.premium);
      const failed = results.filter((r) => !r.ok && !r.premium);

      // Bought domains are excluded server-side — drop their upload bypass too.
      if (okDomains.length > 0) {
        setJustUploadedTargets((prev) => {
          if (prev.size === 0) return prev;
          const next = new Set(prev);
          for (const d of okDomains) next.delete(d);
          return next;
        });
      }
      await Promise.all([loadInventory(), loadAhrefs()]);
      setSelectedTargets(new Set());

      if (failed.length === 0 && premium.length === 0) {
        showToast(`✅ Gname đã nhận ${data.succeeded} lệnh mua · tổng $${(data.totalCharged ?? 0).toFixed(2)} · đã lưu kho`);
      } else {
        const parts = [`✅ ${data.succeeded} OK ($${(data.totalCharged ?? 0).toFixed(2)})`];
        if (premium.length) parts.push(`💎 ${premium.length} premium (cần mua tay trên Gname)`);
        if (failed.length) parts.push(`❌ ${failed.length} lỗi: ${failed[0].msg.slice(0, 60)}`);
        showToast(parts.join(" · "), failed.length > 0);
      }
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setBuyingGname(false);
    }
  }, [selectedTargets, ahrefsSummary, sourceMap, loadInventory, loadAhrefs, showToast]);

  const savePurchases = useCallback(async () => {
    setSavingPurchase(true);
    const isBackorder = purchaseFormMode === "backorder";
    try {
      const entries: { domain: string; purchasePrice: number | null; source: string | null; rating: string | null; category: string | null; isBackorder: boolean }[] = [];
      for (const [domain, priceStr] of Object.entries(purchaseRows)) {
        const t = ahrefsSummary.find((x) => x.targetDomain === domain);
        const price = priceStr.trim() === "" ? null : Number(priceStr);
        entries.push({
          domain,
          purchasePrice: isNaN(price as number) ? null : price,
          source: sourceMap.get(domain) ?? null,
          rating: t?.rating ?? null,
          category: t?.category ?? null,
          isBackorder,
        });
      }
      const res = await fetch("/api/inventory/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lỗi");

      // Backorder ≠ owned yet → KHÔNG mark excluded ở picker (vẫn nên hiện
      // trong picker cho tới khi backorder confirmed). Purchase thì luôn exclude.
      if (!isBackorder) {
        const targets = entries.map((e) => e.domain);
        if (targets.length > 0) {
          try {
            await fetch("/api/ahrefs-results/db/exclude", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ targets }),
            });
          } catch { /* non-fatal — kho vẫn save thành công */ }
          // Explicit purchase overrides the re-upload visibility bypass —
          // drop from justUploadedTargets so the rows disappear immediately.
          setJustUploadedTargets((prev) => {
            if (prev.size === 0) return prev;
            const next = new Set(prev);
            for (const t of targets) next.delete(t);
            return next;
          });
        }
      }

      await Promise.all([loadInventory(), loadAhrefs()]);
      setPurchaseFormOpen(false);
      setSelectedTargets(new Set());
      setSelectedDbDomains(new Set());
      const label = isBackorder ? "đặt backorder" : "lưu";
      showToast(`✅ Đã ${label} ${entries.length} domain · tổng ${data.total}`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setSavingPurchase(false);
    }
  }, [purchaseRows, purchaseFormMode, ahrefsSummary, sourceMap, loadInventory, loadAhrefs, showToast]);

  // Effective list for copy/export: selection if any, else all filtered
  const exportableAhrefs = useMemo(() => {
    if (selectedTargets.size === 0) return filteredAhrefs;
    return filteredAhrefs.filter((t) => selectedTargets.has(t.targetDomain));
  }, [filteredAhrefs, selectedTargets]);

  const blacklistedRefCount = useMemo(() => {
    if (!applyRefBlacklist) return 0;
    let n = 0;
    for (const t of ahrefsSummary) {
      for (const r of t.refs) if (effectiveBlacklist.has(r.domain)) n++;
    }
    return n;
  }, [ahrefsSummary, applyRefBlacklist, effectiveBlacklist]);

  const addBulkBlacklist = useCallback(async () => {
    const domains = bulkAddText
      .split(/[\s,;\n]+/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    if (!domains.length) return;
    setAddingBulk(true);
    try {
      const res = await fetch("/api/ref-blacklist/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lỗi");
      await loadUserBlacklist();
      setBulkAddText("");
      setBulkAddOpen(false);
      showToast(`✅ Đã thêm ${data.added} domain mới · tổng ${data.total} entries`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setAddingBulk(false);
    }
  }, [bulkAddText, loadUserBlacklist, showToast]);

  const removeUserBlacklist = useCallback(async (domain: string) => {
    await fetch(`/api/ref-blacklist/${encodeURIComponent(domain)}`, { method: "DELETE" });
    await loadUserBlacklist();
  }, [loadUserBlacklist]);

  const resetBlacklistDefaults = useCallback(async () => {
    try {
      const res = await fetch("/api/ref-blacklist/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: REF_BLACKLIST, note: "default" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lỗi");
      await loadUserBlacklist();
      showToast(`✅ Restore defaults: +${data.added} mới · tổng ${data.total} entries`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    }
  }, [loadUserBlacklist, showToast]);

  const copyAhrefsTargets = useCallback(async () => {
    if (!exportableAhrefs.length) return;
    const text = exportableAhrefs.map((t) => t.targetDomain).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
      document.body.appendChild(el);
      el.focus(); el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopiedAhrefsTargets(true);
    setTimeout(() => setCopiedAhrefsTargets(false), 2000);
    showToast(`✅ Đã copy ${exportableAhrefs.length} target domain`);
  }, [exportableAhrefs, showToast]);

  const downloadAhrefsCsv = useCallback(() => {
    if (!exportableAhrefs.length) return;
    const headers = ["target_domain", "checked_at", "refs", "rating", "category", "detail"];
    const escape = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows: string[] = [];
    for (const t of exportableAhrefs) {
      const refsCell = t.refs.map((r) => `${r.domain} (DR ${r.dr})`).join("; ");
      rows.push([
        t.targetDomain,
        t.checkedAt,
        refsCell,
        t.rating ?? "",
        t.category ?? "",
        t.detail ?? "",
      ].map(escape).join(","));
    }
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `ahrefs-results-${ts}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`✅ Export ${rows.length} target → ${a.download}`);
  }, [exportableAhrefs, showToast]);

  // UI-only hide: set cutoff timestamp; entries checked at-or-before this are hidden
  // from the Ahrefs panel display (DB intact, new uploads will reappear automatically).
  const clearAhrefs = useCallback(() => {
    if (!ahrefsSummary.length) return;
    setJustUploadedTargets(new Set()); // forget last upload — user wants a clean slate
    updateViewClearedAt(Date.now());
    showToast(`👁️ Đã ẩn ${ahrefsSummary.length} target khỏi view (DB vẫn còn)`);
  }, [ahrefsSummary.length, updateViewClearedAt, showToast]);

  const restoreAhrefsView = useCallback(() => {
    updateViewClearedAt(null);
    showToast("👁️ Đã hiện lại toàn bộ");
  }, [updateViewClearedAt, showToast]);

  // ─── File upload ────────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    setParseError(null);
    setParsing(true);
    setFileName(file.name);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const mapped = mapRows(rows);
      if (!mapped.length) throw new Error("Không có dòng dữ liệu hợp lệ");
      setRawRows(mapped);
      showToast(`✅ Parse: ${mapped.length.toLocaleString()} domain từ ${file.name}`);
      // Auto-advance to step 2 once we have parsed rows.
      dispatchWizard({ type: "advance", from: 1 });
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Lỗi parse CSV");
      setRawRows([]);
    } finally {
      setParsing(false);
    }
  }, [showToast]);

  // ─── Copy domains / Export CSV ───────────────────────────────────────────────

  const copyDomains = useCallback(async () => {
    if (!displayedRows.length) return;
    const text = displayedRows.map((r) => r.domain).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
      document.body.appendChild(el);
      el.focus(); el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopiedDomains(true);
    setTimeout(() => setCopiedDomains(false), 2000);
    showToast(`✅ Đã copy ${displayedRows.length} domain`);
  }, [displayedRows, showToast]);


  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(-1); }
  };

  const filteredDb = useMemo(
    () => [...dbEntries]
      .filter((e) => !dbSearch || e.domain.includes(dbSearch.toLowerCase()))
      .sort((a, b) => b.score - a.score),
    [dbEntries, dbSearch]
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Domain Picker — Wizard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Spamzilla → lọc + sinh prompt Ahrefs → upload kết quả → đánh dấu Đã mua / Loại trừ.
        </p>
      </div>

      {/* ── Wizard stepper ──────────────────────────────────────────────────── */}
      <Stepper
        steps={WIZARD_STEPS}
        current={wizard.step}
        completed={wizard.completed}
        onSelect={(s) => dispatchWizard({ type: "goto", step: s as WizardStep })}
      />

      {/* ── Step 1: Upload Spamzilla CSV ──────────────────────────────────── */}
      {wizard.step === 1 && (
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">CSV Upload</h2>
          </div>

          <label className="cursor-pointer">
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = ""; // allow re-upload same file
              }}
            />
            <span className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium shadow-sm hover:bg-primary/90">
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {parsing ? "Đang parse..." : "Chọn file CSV"}
            </span>
          </label>
        </div>

        {parseError && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {parseError}
          </div>
        )}

        {fileName && !parseError && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Stat label="File" value={fileName} mono />
            <Stat label="Tổng dòng" value={rawRows.length.toLocaleString()} />
            <Stat label="Qualified (threshold)" value={qualifiedRows.length.toLocaleString()} accent />
            <Stat label="Hiển thị Top" value={displayedRows.length.toLocaleString()} />
          </div>
        )}

        {rawRows.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={saveAllToDb}
              disabled={savingDb}
              className="gap-2"
            >
              {savingDb ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Lưu toàn bộ {rawRows.length.toLocaleString()} domain vào DB
            </Button>
            <Button
              onClick={() => dispatchWizard({ type: "advance", from: 1 })}
              className="gap-2"
            >
              Tiếp: Lọc & sinh prompt →
            </Button>
          </div>
        )}
      </div>
      )}

      {/* ── Step 2: Danh sách domain (không lọc) ──────────────────────────── */}
      {wizard.step === 2 && rawRows.length === 0 && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/30 p-4 text-sm flex items-center gap-3 flex-wrap">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="flex-1 min-w-[200px]">CSV Spamzilla đã được clear (refresh tab). Quay lại bước 1 để upload lại.</span>
          <Button size="sm" variant="outline" onClick={() => dispatchWizard({ type: "goto", step: 1 })}>
            ← Quay lại bước 1
          </Button>
        </div>
      )}

      {/* ── Step 2: Results table + Ahrefs prompt panel ────────────────────── */}
      {wizard.step === 2 && rawRows.length > 0 && (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <FilterIcon className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">
                {topN > 0
                  ? `${qualifiedRows.length.toLocaleString()} qualified · trang ${safePage}/${totalPages}`
                  : `Tất cả ${qualifiedRows.length.toLocaleString()} qualified`}
              </span>
              <select
                value={String(topN)}
                onChange={(e) => dispatchWizard({ type: "setTopN", topN: parseInt(e.target.value, 10) })}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs cursor-pointer"
                title="Số dòng mỗi trang"
              >
                <option value="20">20 / trang</option>
                <option value="50">50 / trang</option>
                <option value="100">100 / trang</option>
                <option value="200">200 / trang</option>
                <option value="0">Tất cả</option>
              </select>
              {excludeChecked && excludedCount > 0 && (
                <Badge
                  variant="secondary"
                  className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                >
                  ⊘ Excluded {excludedCount.toLocaleString()} đã check (Ahrefs/DataforSEO)
                </Badge>
              )}
              <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={excludeChecked}
                  onChange={(e) => setExcludeChecked(e.target.checked)}
                  className="rounded"
                />
                <span className="text-muted-foreground">Loại domain đã check (Ahrefs/DataforSEO)</span>
              </label>
              {step2AvailableSources.length > 0 && (
                <select
                  value={step2FilterSource}
                  onChange={(e) => setStep2FilterSource(e.target.value)}
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs cursor-pointer"
                  title="Lọc theo Source (Pending Delete / Expired Domains - Register Now! ...)"
                >
                  <option value="all">Tất cả source</option>
                  {step2AvailableSources.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                  <option value="none">(không có source)</option>
                </select>
              )}
              {step2FilterSource !== "all" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setStep2FilterSource("all")}
                  className="h-6 px-2 text-xs text-muted-foreground"
                  title="Reset source filter"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
              <Badge variant="secondary" className="text-xs">
                Click cột để sort
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={copyDomains}
                disabled={!displayedRows.length}
                className="gap-1.5"
              >
                {copiedDomains
                  ? <Check className="h-3.5 w-3.5 text-green-500" />
                  : <Copy className="h-3.5 w-3.5" />}
                {copiedDomains ? "Đã copy!" : `Copy ${displayedRows.length} domain`}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b sticky top-0">
                <tr>
                  <Th label="#" />
                  <SortTh label="Domain" col="domain" current={sortKey} dir={sortDir} onSort={() => handleSort("domain")} />
                  <SortTh label="Score" col="score" current={sortKey} dir={sortDir} onSort={() => handleSort("score")} />
                  <SortTh label="Source" col="source" current={sortKey} dir={sortDir} onSort={() => handleSort("source")} />
                  <SortTh label="TF" col="tf" current={sortKey} dir={sortDir} onSort={() => handleSort("tf")} />
                  <SortTh label="CF" col="cf" current={sortKey} dir={sortDir} onSort={() => handleSort("cf")} />
                  <SortTh label="RD" col="rd" current={sortKey} dir={sortDir} onSort={() => handleSort("rd")} />
                  <SortTh label="DA" col="da" current={sortKey} dir={sortDir} onSort={() => handleSort("da")} />
                  <SortTh label="Age" col="age" current={sortKey} dir={sortDir} onSort={() => handleSort("age")} />
                  <SortTh label="SZ Score" col="szScore" current={sortKey} dir={sortDir} onSort={() => handleSort("szScore")} />
                  <SortTh label="SZ Drops" col="szDrops" current={sortKey} dir={sortDir} onSort={() => handleSort("szDrops")} />
                  <SortTh label="SEM Traffic" col="semTraffic" current={sortKey} dir={sortDir} onSort={() => handleSort("semTraffic")} />
                  <Th label="" />
                </tr>
              </thead>
              <tbody>
                {displayedRows.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="text-center py-12 text-muted-foreground text-sm">
                      Không có domain nào đạt threshold — nới lỏng điều kiện ở mục Threshold & Weights
                    </td>
                  </tr>
                ) : (
                  displayedRows.map((r, idx) => (
                    <tr key={r.domain} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2 text-muted-foreground text-xs">{idx + 1}</td>
                      <td className="px-3 py-2 font-mono font-medium">{r.domain}</td>
                      <td className="px-3 py-2"><ScoreBadge value={r.score} /></td>
                      <td className="px-3 py-2"><SourceBadge source={r.source} /></td>
                      <td className="px-3 py-2"><Metric value={r.tf} good={30} mid={15} /></td>
                      <td className="px-3 py-2"><Metric value={r.cf} good={20} mid={10} /></td>
                      <td className="px-3 py-2"><Metric value={r.rd} good={100} mid={30} /></td>
                      <td className="px-3 py-2"><Metric value={r.da} good={30} mid={15} /></td>
                      <td className="px-3 py-2 text-muted-foreground">{r.age}</td>
                      <td className="px-3 py-2"><Metric value={r.szScore} good={25} mid={20} /></td>
                      <td className="px-3 py-2"><Metric value={r.szDrops} good={0} mid={3} reverse /></td>
                      <td className="px-3 py-2 text-muted-foreground">{r.semTraffic.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">
                        <a
                          href={`https://${r.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary inline-flex"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {topN > 0 && qualifiedRows.length > topN && (
            <div className="border-t px-5 py-3 flex items-center justify-between gap-3 flex-wrap text-xs">
              <span className="text-muted-foreground">
                Hiển thị{" "}
                <span className="text-foreground font-medium">
                  {((safePage - 1) * topN + 1).toLocaleString()}
                  {"–"}
                  {Math.min(safePage * topN, qualifiedRows.length).toLocaleString()}
                </span>
                {" "}/ {qualifiedRows.length.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={safePage === 1}
                  onClick={() => setCurrentPage(1)}
                  title="Trang đầu"
                >
                  ‹‹
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={safePage === 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  title="Trang trước"
                >
                  ‹
                </Button>
                <span className="px-2 text-foreground font-medium tabular-nums">
                  {safePage} / {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={safePage === totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  title="Trang sau"
                >
                  ›
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={safePage === totalPages}
                  onClick={() => setCurrentPage(totalPages)}
                  title="Trang cuối"
                >
                  ››
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 4: Wayback Machine check ─────────────────────────────────── */}
      {wizard.step === 4 && (
        <WaybackPanel
          ahrefsTargets={filteredAhrefs.map((t) => t.targetDomain)}
          waybackResults={waybackResults}
          waybackRuns={waybackRuns}
          waybackStarting={waybackStarting}
          waybackExpanded={waybackExpanded}
          setWaybackExpanded={setWaybackExpanded}
          startWaybackCheck={startWaybackCheck}
        />
      )}

      {/* ── Steps 3 / 4: Result Panel (always visible after upload) ── */}
      {(wizard.step === 3 || wizard.step === 4) && (
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-orange-500" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">
              {wizard.step === 3 ? "Upload Result" : "Wayback context"}
            </h2>
            <span className="bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 text-xs font-bold px-2 py-0.5 rounded-full">
              {ahrefsSummary.length.toLocaleString()} target
            </span>
            {ahrefsSummary.length > 0 && (
              <span className="bg-muted text-muted-foreground text-xs px-2 py-0.5 rounded-full">
                {ahrefsSummary.reduce((a, t) => a + t.refsCount, 0).toLocaleString()} ref rows
              </span>
            )}
          </div>
        </div>

        <div className="border-t px-6 pb-6">
            <p className="text-xs text-muted-foreground pt-4 pb-4 leading-relaxed">
              {wizard.step === 3 ? (
                <>
                  Lấy dữ liệu ref domain cho danh sách. Chọn <strong>Ahrefs</strong> (upload CSV đã có DR)
                  hoặc <strong>DataforSEO</strong> (tự lấy ref qua API, đối sánh DR từ dữ liệu đã thu thập).
                </>
              ) : (
                <>Đây là bảng ref cho ngữ cảnh. Panel <strong>Wayback Machine check</strong> ở trên cho phép chạy actor để xem lịch sử content (betting/adult). Chọn target để <strong>Đã mua</strong> / <strong>Loại trừ</strong>.</>
              )}
            </p>

            {/* ── Ref Domain Blacklist controls ─────────────────────────── */}
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 mb-4 text-xs">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={applyRefBlacklist}
                    onChange={(e) => setApplyRefBlacklist(e.target.checked)}
                    className="rounded"
                  />
                  <span>
                    <strong>Ref Domain Blacklist</strong>{" "}
                    <span className="text-muted-foreground">
                      ({effectiveBlacklist.size} domain)
                    </span>
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  {applyRefBlacklist && blacklistedRefCount > 0 && (
                    <span className="bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded">
                      ⊘ {blacklistedRefCount.toLocaleString()} ref bị lọc
                    </span>
                  )}
                  <Button
                    size="sm" variant="outline"
                    className="h-6 px-2 gap-1 text-[11px]"
                    onClick={() => setBulkAddOpen((o) => !o)}
                  >
                    <Plus className="h-3 w-3" />
                    Thêm
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    className="h-6 px-2 gap-1 text-[11px]"
                    onClick={resetBlacklistDefaults}
                    title={`Add ${REF_BLACKLIST.length} default domains (idempotent)`}
                  >
                    Reset defaults
                  </Button>
                  <button
                    onClick={() => setRefBlacklistOpen((o) => !o)}
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    {refBlacklistOpen ? "Ẩn" : "Xem"} list
                    <ChevronDown className={cn("h-3 w-3 transition-transform", refBlacklistOpen && "rotate-180")} />
                  </button>
                </div>
              </div>

              {/* Bulk-add textarea */}
              {bulkAddOpen && (
                <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                  <p className="text-muted-foreground">
                    Paste danh sách (mỗi dòng / phẩy / khoảng trắng đều được). Sẽ chuẩn hóa lowercase + bỏ http(s)://.
                  </p>
                  <textarea
                    value={bulkAddText}
                    onChange={(e) => setBulkAddText(e.target.value)}
                    rows={4}
                    placeholder={"google.com\nwixsite.com, hatena.ne.jp\nheylink.me typepad.com"}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={addBulkBlacklist}
                      disabled={addingBulk || !bulkAddText.trim()}
                      className="h-7 gap-1.5 text-xs"
                    >
                      {addingBulk ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                      {addingBulk ? "Đang thêm..." : "Thêm vào blacklist"}
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => { setBulkAddOpen(false); setBulkAddText(""); }}
                    >
                      Hủy
                    </Button>
                  </div>
                </div>
              )}

              {/* Domain list — flat, sorted alphabetically, all deletable */}
              {refBlacklistOpen && (
                <div className="mt-2 pt-2 border-t border-border/50">
                  {effectiveBlacklist.size === 0 ? (
                    <p className="text-muted-foreground text-center py-2">
                      Blacklist rỗng — click <strong>Reset defaults</strong> để khôi phục {REF_BLACKLIST.length} domain mặc định
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {Array.from(effectiveBlacklist)
                        .sort()
                        .map((d) => (
                          <span
                            key={d}
                            className="group inline-flex items-center rounded border border-border bg-background pl-1.5 pr-1 py-0.5 text-[11px] font-mono text-muted-foreground"
                          >
                            {d}
                            <button
                              onClick={() => removeUserBlacklist(d)}
                              className="ml-1 opacity-50 group-hover:opacity-100 hover:text-destructive"
                              title="Xóa khỏi blacklist"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Nguồn dữ liệu: Ahrefs (CSV) | DataforSEO (API) */}
            <div className="inline-flex rounded-md border border-border overflow-hidden mb-3 text-xs">
              <button
                type="button"
                onClick={() => setResultSource("ahrefs")}
                className={cn(
                  "px-3 py-1.5 font-medium transition-colors",
                  resultSource === "ahrefs" ? "bg-orange-600 text-white" : "bg-background hover:bg-muted",
                )}
              >
                Ahrefs (CSV)
              </button>
              <button
                type="button"
                onClick={() => setResultSource("dataforseo")}
                className={cn(
                  "px-3 py-1.5 font-medium transition-colors border-l border-border",
                  resultSource === "dataforseo" ? "bg-sky-600 text-white" : "bg-background hover:bg-muted",
                )}
              >
                DataforSEO (API)
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-2 mb-4">
              {resultSource === "ahrefs" ? (
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadAhrefsCsv(f);
                      e.target.value = "";
                    }}
                  />
                  <span className={cn(
                    "inline-flex items-center gap-2 rounded-md bg-orange-600 hover:bg-orange-700 text-white px-3 py-1.5 text-sm font-medium shadow-sm",
                    ahrefsUploading && "opacity-60 pointer-events-none"
                  )}>
                    {ahrefsUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {ahrefsUploading ? "Đang upload..." : "Upload Ahrefs CSV"}
                  </span>
                </label>
              ) : (
                <Button
                  size="sm"
                  className="gap-1.5 bg-sky-600 hover:bg-sky-700 text-white"
                  onClick={ingestDataforseo}
                  disabled={ingestingDfs || scoredRows.length === 0}
                  title={
                    scoredRows.length === 0
                      ? "Upload Spamzilla ở bước 1 trước"
                      : `Lấy ref qua DataforSEO cho ${scoredRows.length} domain, đối sánh DR từ backlink_db`
                  }
                >
                  {ingestingDfs ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
                  {ingestingDfs ? "Đang chạy DataforSEO…" : `Chạy DataforSEO (${scoredRows.length})`}
                </Button>
              )}
              {resultSource === "dataforseo" && dfsUnmatched.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-amber-700 border-amber-400/60 hover:bg-amber-50 dark:hover:bg-amber-950"
                  onClick={exportUnmatchedRefs}
                  title="Export ref domain chưa có DR (CSV domain,dr,backlinks) — điền DR rồi Import lại ở Aged Domain → Backlink DB"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export ref chưa có DR ({dfsUnmatched.length})
                </Button>
              )}
              <Button
                size="sm" variant="outline"
                className="gap-1.5"
                onClick={copyAhrefsTargets}
                disabled={!exportableAhrefs.length}
              >
                {copiedAhrefsTargets
                  ? <Check className="h-3.5 w-3.5 text-green-500" />
                  : <Copy className="h-3.5 w-3.5" />}
                {copiedAhrefsTargets ? "Đã copy!" : `Copy ${exportableAhrefs.length} domain`}
              </Button>
              <Button
                size="sm" variant="outline"
                className="gap-1.5"
                onClick={downloadAhrefsCsv}
                disabled={!exportableAhrefs.length}
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV {selectedTargets.size > 0 && `(${selectedTargets.size})`}
              </Button>
              {selectedTargets.size > 0 && (
                <>
                  <Button
                    size="sm"
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => openPurchaseForm("purchase")}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Đã mua ({selectedTargets.size})
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
                    onClick={buyViaGname}
                    disabled={buyingGname}
                    title="Gửi lệnh mua THẬT qua Gname API — tiền trừ từ số dư Gname, giá thực tế tự lưu vào kho"
                  >
                    {buyingGname ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <>⚡</>}
                    {buyingGname ? "Đang gửi Gname…" : `Mua Gname (${selectedTargets.size})`}
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => openPurchaseForm("backorder")}
                    title="Đặt Back Order — lưu vào kho với cờ chưa xác nhận; vào Kho Domain để Confirm/Loại trừ sau"
                  >
                    🛒 Back Order ({selectedTargets.size})
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5 bg-rose-600 hover:bg-rose-700 text-white"
                    onClick={excludeSelectedTargets}
                    disabled={excludingTargets}
                    title="Domain đã bị người khác mua — loại trừ khỏi danh sách"
                  >
                    {excludingTargets ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                    Loại trừ ({selectedTargets.size})
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    className="gap-1.5 text-xs"
                    onClick={clearSelection}
                    title="Bỏ chọn tất cả"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear ({selectedTargets.size})
                  </Button>
                </>
              )}
              {viewClearedAt != null && (
                <Button
                  size="sm" variant="outline"
                  className="gap-1.5 ml-auto"
                  onClick={restoreAhrefsView}
                  title="Hiện lại các target đã ẩn"
                >
                  <Search className="h-3.5 w-3.5" />
                  Hiện toàn bộ
                </Button>
              )}
              <Button
                size="sm" variant="outline"
                className={cn(
                  "gap-1.5 text-amber-700 border-amber-400/60 hover:bg-amber-50 dark:hover:bg-amber-950",
                  viewClearedAt == null && "ml-auto"
                )}
                onClick={clearAhrefs}
                title="Ẩn dữ liệu hiện tại khỏi view (DB vẫn còn — upload mới sẽ tự hiện)"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Xóa hiện tại
              </Button>
            </div>

            {ahrefsSummary.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Tìm target domain..."
                    value={ahrefsSearch}
                    onChange={(e) => setAhrefsSearch(e.target.value)}
                    className="pl-8 text-sm h-8"
                  />
                </div>
                <select
                  value={filterRating}
                  onChange={(e) => setFilterRating(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs cursor-pointer"
                  title="Filter Đánh giá"
                >
                  <option value="all">Tất cả đánh giá</option>
                  <option value="✅ TỐT">✅ TỐT</option>
                  <option value="⚠️ TRUNG BÌNH">⚠️ TRUNG BÌNH</option>
                  <option value="⚠️ RỦI RO">⚠️ RỦI RO</option>
                  <option value="❌ XẤU">❌ XẤU</option>
                  <option value="❌ RẤT XẤU">❌ RẤT XẤU</option>
                  <option value="none">(chưa đánh giá)</option>
                </select>
                <select
                  value={filterSource}
                  onChange={(e) => setFilterSource(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs cursor-pointer"
                  title="Filter Source"
                >
                  <option value="all">Tất cả source</option>
                  {availableSources.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                  <option value="none">(không có source)</option>
                </select>
                <select
                  value={filterPurchased}
                  onChange={(e) => setFilterPurchased(e.target.value as "all" | "yes" | "no")}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs cursor-pointer"
                  title="Filter Đã mua"
                >
                  <option value="all">Tất cả</option>
                  <option value="yes">Đã mua</option>
                  <option value="no">Chưa mua</option>
                </select>
                {(filterRating !== "all" || filterSource !== "all" || filterPurchased !== "all") && (
                  <Button
                    size="sm" variant="ghost"
                    className="h-8 text-xs"
                    onClick={() => { setFilterRating("all"); setFilterSource("all"); setFilterPurchased("all"); }}
                  >
                    <X className="h-3 w-3" />
                    Reset filter
                  </Button>
                )}
              </div>
            )}

            {ahrefsSummary.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">
                DB trống — upload CSV kết quả Ahrefs để bắt đầu loại trừ
              </p>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="px-3 py-2 w-8">
                        <input
                          type="checkbox"
                          className="rounded cursor-pointer"
                          aria-label="Select all visible"
                          checked={
                            filteredAhrefs.length > 0 &&
                            filteredAhrefs.slice(0, 200).every((t) => selectedTargets.has(t.targetDomain))
                          }
                          ref={(el) => {
                            if (!el) return;
                            const visible = filteredAhrefs.slice(0, 200);
                            const selectedCount = visible.filter((t) => selectedTargets.has(t.targetDomain)).length;
                            el.indeterminate = selectedCount > 0 && selectedCount < visible.length;
                          }}
                          onChange={toggleSelectAllVisible}
                        />
                      </th>
                      <SortTh label="Target Domain" col="targetDomain" current={ahrefsSortKey} dir={ahrefsSortDir} onSort={() => handleAhrefsSort("targetDomain")} />
                      <SortTh label="Source" col="source" current={ahrefsSortKey} dir={ahrefsSortDir} onSort={() => handleAhrefsSort("source")} />
                      <SortTh label="Đánh giá" col="rating" current={ahrefsSortKey} dir={ahrefsSortDir} onSort={() => handleAhrefsSort("rating")} />
                      <SortTh label="Phân loại" col="category" current={ahrefsSortKey} dir={ahrefsSortDir} onSort={() => handleAhrefsSort("category")} />
                      <SortTh label="Checked" col="checkedAt" current={ahrefsSortKey} dir={ahrefsSortDir} onSort={() => handleAhrefsSort("checkedAt")} />
                      <SortTh label="Refs" col="refsCount" current={ahrefsSortKey} dir={ahrefsSortDir} onSort={() => handleAhrefsSort("refsCount")} />
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAhrefs
                      .slice(0, 200)
                      .map((t) => (
                        <tr key={t.targetDomain} className={cn(
                          "border-b border-border/30 hover:bg-muted/30 group align-top",
                          selectedTargets.has(t.targetDomain) && "bg-blue-50/50 dark:bg-blue-950/30"
                        )}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              className="rounded cursor-pointer"
                              aria-label={`Select ${t.targetDomain}`}
                              checked={selectedTargets.has(t.targetDomain)}
                              onChange={() => toggleTargetSelection(t.targetDomain)}
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            <div className="flex items-center gap-1.5">
                              <span>{t.targetDomain}</span>
                              {purchasedSet.has(t.targetDomain) && (
                                <span
                                  className="inline-flex items-center gap-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[10px] px-1 py-0.5 font-sans font-medium"
                                  title="Đã có trong kho"
                                >
                                  <Check className="h-2.5 w-2.5" /> Đã mua
                                </span>
                              )}
                            </div>
                            {t.detail && (
                              <details className="mt-1">
                                <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground select-none">
                                  Chi tiết
                                </summary>
                                <p className="mt-1 text-[11px] font-sans font-normal text-muted-foreground leading-snug max-w-[400px] whitespace-pre-wrap">
                                  {t.detail}
                                </p>
                              </details>
                            )}
                          </td>
                          <td className="px-3 py-2"><SourceBadge source={t.source} /></td>
                          <td className="px-3 py-2"><RatingBadge rating={t.rating} /></td>
                          <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px]">
                            {t.category || <span className="opacity-40">—</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(t.checkedAt).toLocaleDateString()}
                          </td>
                          <td className="px-3 py-2">
                            <RefList refs={t.refs} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => removeAhrefsTarget(t.targetDomain)}
                              className="opacity-0 group-hover:opacity-100 transition text-destructive hover:opacity-80"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {filteredAhrefs.length > 200 && (
                  <p className="text-center text-xs text-muted-foreground py-2">
                    Hiển thị 200/{filteredAhrefs.length.toLocaleString()} target
                  </p>
                )}
              </div>
            )}
          </div>
      </div>
      )}

      {/* ── Wizard nav footer ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
        <Button
          variant="outline"
          onClick={() => dispatchWizard({ type: "goto", step: Math.max(1, wizard.step - 1) as WizardStep })}
          disabled={wizard.step === 1}
          className="gap-2"
        >
          ← Quay lại
        </Button>
        <span className="text-xs text-muted-foreground">
          Bước {wizard.step}/{WIZARD_STEPS.length} · {WIZARD_STEPS[wizard.step - 1].label}
        </span>
        <Button
          onClick={() => dispatchWizard({ type: "advance", from: wizard.step })}
          disabled={wizard.step === 4}
          className="gap-2"
        >
          Tiếp →
        </Button>
      </div>

      {/* ── Purchase form (shared by step 4 selection + Picker DB selection) ── */}
      {purchaseFormOpen && (() => {
        const isBackorder = purchaseFormMode === "backorder";
        const colorBorder = isBackorder ? "border-amber-300 dark:border-amber-700" : "border-emerald-300 dark:border-emerald-700";
        const colorBg = isBackorder ? "bg-amber-50/50 dark:bg-amber-950/30" : "bg-emerald-50/50 dark:bg-emerald-950/30";
        const colorBtn = isBackorder ? "bg-amber-600 hover:bg-amber-700" : "bg-emerald-600 hover:bg-emerald-700";
        const colorIcon = isBackorder ? "text-amber-600" : "text-emerald-600";
        const colorDivider = isBackorder ? "border-amber-200 dark:border-amber-800" : "border-emerald-200 dark:border-emerald-800";
        const Icon = isBackorder ? FilterIcon : Check;
        const title = isBackorder
          ? `🛒 Đặt Back Order — ${Object.keys(purchaseRows).length} domain`
          : `Đánh dấu đã mua — ${Object.keys(purchaseRows).length} domain`;
        const saveLabel = isBackorder ? "Đặt Back Order" : "Lưu vào kho";
        return (
        <div className={cn("rounded-xl border p-4 shadow-sm", colorBorder, colorBg)}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Icon className={cn("h-4 w-4", colorIcon)} />
              <h3 className="text-sm font-semibold">{title}</h3>
            </div>
            <button onClick={() => setPurchaseFormOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          {isBackorder && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300 mb-3 -mt-1">
              ⚠️ Backorder chưa thực sự sở hữu domain. Vào Kho Domain để{" "}
              <strong>✓ Confirm</strong> khi registrar xác nhận thành công, hoặc{" "}
              <strong>✗ Loại trừ</strong> nếu fail.
            </p>
          )}

          <div className={cn("flex items-center gap-2 mb-3 pb-3 border-b", colorDivider)}>
            <span className="text-xs text-muted-foreground">Áp giá đồng loạt:</span>
            <Input
              type="number"
              placeholder="vd: 10.99"
              value={purchaseBulkPrice}
              onChange={(e) => setPurchaseBulkPrice(e.target.value)}
              className="h-7 w-32 text-xs"
              step="0.01"
            />
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={applyBulkPrice}>
              Apply all
            </Button>
          </div>

          <div className="max-h-64 overflow-y-auto space-y-1 mb-3">
            {Object.keys(purchaseRows).map((domain) => (
              <div key={domain} className="flex items-center gap-2 text-xs">
                <span className="font-mono flex-1 truncate">{domain}</span>
                <span className="text-muted-foreground">$</span>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={purchaseRows[domain]}
                  onChange={(e) => setPurchaseRows({ ...purchaseRows, [domain]: e.target.value })}
                  className="h-6 w-24 text-xs"
                  step="0.01"
                />
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={savePurchases}
              disabled={savingPurchase}
              className={cn("gap-1.5 text-white", colorBtn)}
            >
              {savingPurchase ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {savingPurchase ? "Đang lưu..." : saveLabel}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPurchaseFormOpen(false)}>
              Hủy
            </Button>
          </div>
        </div>
        );
      })()}

      {/* ── Picker DB Panel ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm">
        <button
          onClick={() => setDbOpen((o) => !o)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-muted/30 transition rounded-xl"
        >
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">Picker DB</h2>
            <span className="bg-primary/10 text-primary text-xs font-bold px-2 py-0.5 rounded-full">
              {dbEntries.length.toLocaleString()} entries
            </span>
          </div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", dbOpen && "rotate-180")} />
        </button>

        {dbOpen && (
          <div className="border-t px-6 pb-6">
            <p className="text-xs text-muted-foreground pt-4 pb-4 leading-relaxed">
              Lưu trữ tất cả domain đã được upload (Apify Key-Value Store).
              Mỗi entry gồm: TF/CF/RD/DA/Age/SZ Score/SZ Drops/SEM Traffic/Score/timestamp.
            </p>

            <div className="flex flex-wrap items-end gap-2 mb-4">
              {selectedDbDomains.size > 0 && (
                <>
                  <Button
                    size="sm"
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => openPurchaseFormForDbDomains("purchase")}
                  >
                    <DollarSign className="h-3.5 w-3.5" />
                    Đã mua ({selectedDbDomains.size})
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => openPurchaseFormForDbDomains("backorder")}
                    title="Đặt Back Order — vào Kho Domain để Confirm/Loại trừ sau"
                  >
                    🛒 Back Order ({selectedDbDomains.size})
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-muted-foreground"
                    onClick={() => setSelectedDbDomains(new Set())}
                  >
                    <X className="h-3.5 w-3.5" />
                    Bỏ chọn
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10 ml-auto"
                onClick={clearDb}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Xóa tất cả
              </Button>
            </div>

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

            {dbEntries.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">
                DB trống — upload CSV và nhấn <strong>Lưu toàn bộ</strong> để bắt đầu
              </p>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="px-3 py-2 w-8">
                        {(() => {
                          const visible = filteredDb.slice(0, 200);
                          const allChecked = visible.length > 0 && visible.every((e) => selectedDbDomains.has(e.domain));
                          const someChecked = visible.some((e) => selectedDbDomains.has(e.domain));
                          return (
                            <input
                              type="checkbox"
                              className="rounded cursor-pointer"
                              aria-label="Select all visible"
                              checked={allChecked}
                              ref={(el) => {
                                if (!el) return;
                                el.indeterminate = someChecked && !allChecked;
                              }}
                              onChange={() => {
                                setSelectedDbDomains((prev) => {
                                  const next = new Set(prev);
                                  if (allChecked) {
                                    for (const e of visible) next.delete(e.domain);
                                  } else {
                                    for (const e of visible) next.add(e.domain);
                                  }
                                  return next;
                                });
                              }}
                            />
                          );
                        })()}
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Domain</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Score</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">TF/CF</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">RD</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">DA</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Age</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">SZ</th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDb.slice(0, 200).map((e) => {
                      const isChecked = selectedDbDomains.has(e.domain);
                      return (
                      <tr
                        key={e.domain}
                        className={cn(
                          "border-b border-border/30 hover:bg-muted/30 group",
                          isChecked && "bg-blue-50/50 dark:bg-blue-950/30"
                        )}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="rounded cursor-pointer"
                            checked={isChecked}
                            onChange={() => {
                              setSelectedDbDomains((prev) => {
                                const next = new Set(prev);
                                if (next.has(e.domain)) next.delete(e.domain);
                                else next.add(e.domain);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{e.domain}</td>
                        <td className="px-3 py-2"><ScoreBadge value={e.score} small /></td>
                        <td className="px-3 py-2 text-xs">{e.tf}/{e.cf}</td>
                        <td className="px-3 py-2 text-xs">{e.rd}</td>
                        <td className="px-3 py-2 text-xs">{e.da}</td>
                        <td className="px-3 py-2 text-xs">{e.age}</td>
                        <td className="px-3 py-2 text-xs">{e.szScore}/<span className="text-destructive">{e.szDrops}</span></td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => removeFromDb(e.domain)}
                            className="opacity-0 group-hover:opacity-100 transition text-destructive hover:opacity-80"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredDb.length > 200 && (
                  <p className="text-center text-xs text-muted-foreground py-2">
                    Hiển thị 200/{filteredDb.length.toLocaleString()} entries
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Toasts ─────────────────────────────────────────────────────────── */}
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

function Stat({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn(
        "text-sm font-semibold truncate",
        mono && "font-mono text-xs",
        accent && "text-primary"
      )} title={value}>
        {value}
      </p>
    </div>
  );
}

function Th({ label }: { label: string }) {
  return (
    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
      {label}
    </th>
  );
}

function SortTh({ label, col, current, dir, onSort }: {
  label: string; col: string; current: string; dir: 1 | -1; onSort: () => void;
}) {
  const active = current === col;
  return (
    <th
      onClick={onSort}
      className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:bg-muted/50 whitespace-nowrap"
    >
      <span className="flex items-center gap-1">
        {label}
        <ArrowUpDown className={cn("h-3 w-3", active ? "text-primary" : "opacity-30")} />
        {active && <span className="text-primary">{dir === -1 ? "↓" : "↑"}</span>}
      </span>
    </th>
  );
}

function ScoreBadge({ value, small = false }: { value: number; small?: boolean }) {
  const v = Math.round(value);
  const color =
    v >= 100 ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
    : v >= 60 ? "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
    : v >= 30 ? "bg-yellow-100 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300"
    : "bg-muted text-muted-foreground";
  return (
    <span className={cn(
      "inline-flex items-center font-bold rounded-full",
      small ? "text-xs px-1.5 py-0.5" : "text-sm px-2 py-0.5",
      color
    )}>
      {v}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  if (!source) return <span className="text-xs text-muted-foreground">—</span>;
  const s = source.toLowerCase();
  const color =
    s.includes("pending delete")
      ? "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300"
    : s.includes("expired")
      ? "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300"
    : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap", color)}
      title={source}
    >
      {source}
    </span>
  );
}

function RefList({ refs }: { refs: { domain: string; dr: number }[] }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const COLLAPSED = 6;
  const visible = expanded ? refs : refs.slice(0, COLLAPSED);
  const hidden = refs.length - visible.length;

  const copyAllRefs = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!refs.length) return;
    const text = refs.map((r) => r.domain).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
      document.body.appendChild(el);
      el.focus(); el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!refs.length) return <span className="text-xs text-muted-foreground">—</span>;

  return (
    <div className="flex flex-wrap items-center gap-1 max-w-[520px]">
      <button
        onClick={copyAllRefs}
        className={cn(
          "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition-colors",
          copied
            ? "border-green-300 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300"
            : "border-primary/40 bg-primary/5 hover:bg-primary/10 text-primary"
        )}
        title={`Copy ${refs.length} ref domain`}
      >
        {copied
          ? <><Check className="h-3 w-3" />Đã copy {refs.length}</>
          : <><Copy className="h-3 w-3" />Copy {refs.length}</>
        }
      </button>
      {visible.map((r) => (
        <a
          key={r.domain}
          href={`https://${r.domain}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded border border-border bg-muted/30 hover:bg-muted/60 px-1.5 py-0.5 text-[11px] font-mono text-foreground/90 hover:text-primary transition-colors"
        >
          {r.domain}
          <span className={cn(
            "rounded px-1 text-[10px] font-bold",
            r.dr >= 90 ? "text-emerald-600 dark:text-emerald-400"
            : r.dr >= 70 ? "text-blue-600 dark:text-blue-400"
            : r.dr >= 40 ? "text-yellow-600 dark:text-yellow-400"
            : "text-muted-foreground"
          )}>
            DR {r.dr}
          </span>
        </a>
      ))}
      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[11px] text-primary hover:underline px-1"
        >
          + {hidden} more
        </button>
      )}
      {expanded && refs.length > COLLAPSED && (
        <button
          onClick={() => setExpanded(false)}
          className="text-[11px] text-muted-foreground hover:underline px-1"
        >
          collapse
        </button>
      )}
    </div>
  );
}

function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating?.trim()) return <span className="text-xs text-muted-foreground opacity-40">—</span>;
  const r = rating.toUpperCase();
  const color =
    r.includes("RẤT XẤU") ? "bg-red-200 dark:bg-red-950 text-red-900 dark:text-red-300 border-red-400"
    : r.includes("XẤU") ? "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border-rose-300"
    : r.includes("RỦI RO") ? "bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 border-orange-300"
    : r.includes("TRUNG BÌNH") ? "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300"
    : r.includes("TỐT") ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn(
      "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
      color
    )} title={rating}>
      {rating}
    </span>
  );
}

function DrBadge({ dr }: { dr: number }) {
  const color =
    dr >= 90 ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
    : dr >= 70 ? "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
    : dr >= 40 ? "bg-yellow-100 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300"
    : "bg-muted text-muted-foreground";
  return (
    <span className={cn(
      "inline-flex items-center font-bold rounded-full text-xs px-1.5 py-0.5",
      color
    )}>
      {dr}
    </span>
  );
}

function Metric({ value, good, mid, reverse = false }: {
  value: number; good: number; mid: number; reverse?: boolean;
}) {
  const isGood = reverse ? value <= good : value >= good;
  const isMid = reverse ? value <= mid : value >= mid;
  const color =
    isGood ? "text-emerald-600 dark:text-emerald-400 font-semibold"
    : isMid ? "text-blue-600 dark:text-blue-400"
    : "text-muted-foreground";
  return <span className={color}>{value}</span>;
}

// ─── Wayback Panel (step 4) ──────────────────────────────────────────────────

type WaybackRowT = {
  targetDomain: string;
  snapshotCount: number | null;
  firstYear: string | null;
  lastYear: string | null;
  domainAge: number | null;
  hasBetting: boolean;
  hasAdult: boolean;
  contentHistory: Array<{ year: string; timestamp: string; summary: string; hasBetting: boolean; hasAdult: boolean; confidence: string; keywords: string[] }>;
  problematicSnapshots: Array<{ timestamp: string; url: string; title: string; summary: string; hasBetting: boolean; hasAdult: boolean; confidence: string; keywords: string[] }>;
  errorReason: string | null;
  checkedAt: string;
};
type WaybackRunT = {
  runId: string;
  status: "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMING-OUT" | "TIMED-OUT" | "ABORTING" | "ABORTED";
  targets: string[];
  datasetId: string | null;
  startedAt: string;
  finishedAt: string | null;
  ingestedAt: string | null;
  error: string | null;
};

function WaybackPanel({
  ahrefsTargets,
  waybackResults,
  waybackRuns,
  waybackStarting,
  waybackExpanded,
  setWaybackExpanded,
  startWaybackCheck,
}: {
  ahrefsTargets: string[];
  waybackResults: WaybackRowT[];
  waybackRuns: WaybackRunT[];
  waybackStarting: boolean;
  waybackExpanded: Set<string>;
  setWaybackExpanded: (s: Set<string>) => void;
  startWaybackCheck: (targets: string[]) => void;
}) {
  const checkedMap = new Map(waybackResults.map((r) => [r.targetDomain, r]));
  const unchecked = ahrefsTargets.filter((d) => !checkedMap.has(d));
  const activeRuns = waybackRuns.filter((r) => r.status === "READY" || r.status === "RUNNING");
  const inFlightTargets = new Set(activeRuns.flatMap((r) => r.targets));
  const pendingNow = unchecked.filter((d) => inFlightTargets.has(d)).length;

  // Targets visible in Ahrefs table, sorted: flagged first, then unchecked, then clean.
  const rows = ahrefsTargets.map((d) => {
    const row = checkedMap.get(d);
    const inFlight = inFlightTargets.has(d);
    return { domain: d, row, inFlight };
  }).sort((a, b) => {
    const aPri = a.row ? (a.row.hasBetting || a.row.hasAdult ? 0 : 2) : (a.inFlight ? 1 : 3);
    const bPri = b.row ? (b.row.hasBetting || b.row.hasAdult ? 0 : 2) : (b.inFlight ? 1 : 3);
    if (aPri !== bPri) return aPri - bPri;
    return a.domain.localeCompare(b.domain);
  });

  const toggleExpanded = (d: string) => {
    const next = new Set(waybackExpanded);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    setWaybackExpanded(next);
  };

  const flaggedCount = waybackResults.filter((r) => (checkedMap.has(r.targetDomain) && ahrefsTargets.includes(r.targetDomain)) && (r.hasBetting || r.hasAdult)).length;

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-2 flex-wrap">
          <Database className="h-4 w-4 text-purple-500" />
          <h2 className="text-sm font-semibold uppercase tracking-wide">Wayback Machine check</h2>
          <Badge variant="secondary" className="text-xs">{ahrefsTargets.length} target</Badge>
          {checkedMap.size > 0 && (
            <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              {ahrefsTargets.filter((d) => checkedMap.has(d)).length} đã check
            </Badge>
          )}
          {flaggedCount > 0 && (
            <Badge variant="secondary" className="text-xs bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
              🚨 {flaggedCount} flagged
            </Badge>
          )}
          {activeRuns.length > 0 && (
            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              ⏳ {activeRuns.length} run · {pendingNow} target đang chạy
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={waybackStarting || unchecked.length === 0}
            onClick={() => startWaybackCheck(unchecked)}
            className="gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
            title={unchecked.length === 0 ? "Tất cả target đã check rồi" : `Trigger Apify actor cho ${unchecked.length} target chưa check`}
          >
            {waybackStarting ? "Đang trigger…" : `Check Wayback (${unchecked.length})`}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={waybackStarting || ahrefsTargets.length === 0}
            onClick={() => startWaybackCheck(ahrefsTargets)}
            title="Re-check tất cả target (upsert đè dữ liệu cũ)"
            className="gap-1.5"
          >
            Re-check tất cả
          </Button>
        </div>
      </div>

      {activeRuns.length > 0 && (
        <div className="border-b bg-blue-50/30 dark:bg-blue-950/20 px-6 py-3 text-xs space-y-1">
          {activeRuns.map((r) => (
            <div key={r.runId} className="flex items-center gap-2">
              <span className="text-blue-700 dark:text-blue-300">⏳ {r.status}</span>
              <span className="font-mono text-muted-foreground">{r.runId}</span>
              <span className="text-muted-foreground">· {r.targets.length} target · bắt đầu {new Date(r.startedAt).toLocaleTimeString()}</span>
              <a
                href={`https://console.apify.com/actors/runs/${r.runId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                xem trên Apify ↗
              </a>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide w-8"></th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Target domain</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Status</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Snapshots</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Age</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Flags</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Checked</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                  Chưa có target. Upload Ahrefs result ở bước 3 trước.
                </td>
              </tr>
            ) : (
              rows.map(({ domain, row, inFlight }) => {
                const expanded = waybackExpanded.has(domain);
                const flagged = row && (row.hasBetting || row.hasAdult);
                return (
                  <React.Fragment key={domain}>
                    <tr
                      className={cn(
                        "border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer",
                        flagged && "bg-red-50/40 dark:bg-red-950/20"
                      )}
                      onClick={() => row && toggleExpanded(domain)}
                    >
                      <td className="px-3 py-2">
                        {row && (
                          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono font-medium">{domain}</td>
                      <td className="px-3 py-2 text-xs">
                        {row ? (
                          row.errorReason ? (
                            <span className="text-amber-700 dark:text-amber-300">⚠️ {row.errorReason}</span>
                          ) : (
                            <span className="text-emerald-700 dark:text-emerald-300">✓ Đã check</span>
                          )
                        ) : inFlight ? (
                          <span className="text-blue-700 dark:text-blue-300">⏳ Đang chạy</span>
                        ) : (
                          <span className="text-muted-foreground">— Chưa check</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row?.snapshotCount != null ? row.snapshotCount.toLocaleString() : "—"}
                        {row?.firstYear && row?.lastYear && (
                          <span className="text-[11px] ml-1">({row.firstYear}–{row.lastYear})</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{row?.domainAge != null ? `${row.domainAge}y` : "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1 flex-wrap">
                          {row?.hasBetting && (
                            <Badge variant="secondary" className="text-[10px] bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">🎰 Betting</Badge>
                          )}
                          {row?.hasAdult && (
                            <Badge variant="secondary" className="text-[10px] bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300">🔞 Adult</Badge>
                          )}
                          {row && !row.hasBetting && !row.hasAdult && !row.errorReason && (
                            <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">✓ Clean</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">
                        {row?.checkedAt ? new Date(row.checkedAt).toLocaleString() : "—"}
                      </td>
                    </tr>
                    {expanded && row && (
                      <tr className="bg-muted/10">
                        <td colSpan={7} className="px-6 py-4 text-xs space-y-3">
                          {row.problematicSnapshots.length > 0 && (
                            <div>
                              <h4 className="font-semibold text-red-700 dark:text-red-300 mb-2">🚨 Problematic snapshots ({row.problematicSnapshots.length})</h4>
                              <div className="space-y-2">
                                {row.problematicSnapshots.map((s, i) => (
                                  <div key={i} className="rounded border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/30 p-2">
                                    <div className="flex gap-2 items-center mb-1">
                                      <span className="font-mono">{s.timestamp.slice(0, 8)}</span>
                                      <span className="font-medium">{s.title}</span>
                                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">↗</a>
                                    </div>
                                    <div className="text-muted-foreground">{s.summary}</div>
                                    {s.keywords?.length > 0 && (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {s.keywords.map((k, j) => (
                                          <span key={j} className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900 text-[10px]">{k}</span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {row.contentHistory.length > 0 && (
                            <div>
                              <h4 className="font-semibold mb-2">📜 Content history ({row.contentHistory.length} snapshots)</h4>
                              <div className="space-y-1">
                                {row.contentHistory.map((h, i) => (
                                  <div key={i} className="flex gap-2 items-start">
                                    <span className="font-mono text-muted-foreground w-12 shrink-0">{h.year}</span>
                                    <span className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", (h.hasBetting || h.hasAdult) ? "bg-red-500" : "bg-emerald-500")} />
                                    <span className="flex-1">{h.summary}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {row.contentHistory.length === 0 && row.problematicSnapshots.length === 0 && (
                            <p className="text-muted-foreground italic">Không có content history (actor chạy ở fast mode hoặc không có snapshot).</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
