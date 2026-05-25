"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Search,
  Trash2,
  X,
  ArrowUpDown,
  Check,
  ExternalLink,
  Edit2,
  Save as SaveIcon,
  Download,
  DollarSign,
  TrendingUp,
  Loader2,
  Calendar,
  Tag,
  Wallet,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { InventoryEntry } from "@/lib/inventory-db";
import type { TargetSummary } from "@/lib/ahrefs-db";
import type { RefBlacklistEntry } from "@/lib/ref-blacklist-db";
import type { Withdrawal, WithdrawalStatus, WithdrawalWallet } from "@/lib/withdrawal-db";

type SortKey = "domain" | "purchasePrice" | "sellPrice" | "expectedSellPrice" | "profit" | "rating" | "category" | "purchasedAt" | "soldAt" | "status";

interface ToastItem { id: number; message: string; isError: boolean }

export default function InventoryPage() {
  const [entries, setEntries] = useState<InventoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "holding" | "sold">("all");
  const [filterExpected, setFilterExpected] = useState<"all" | "yes" | "no">("all");
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(25);
  const [datePreset, setDatePreset] = useState<"all" | "7d" | "30d" | "month" | "year" | "custom">("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("purchasedAt");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [editingDomain, setEditingDomain] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editingExpected, setEditingExpected] = useState<string | null>(null);
  const [editExpectedValue, setEditExpectedValue] = useState("");

  // Refs data (from Ahrefs Result DB) + blacklist
  const [ahrefsSummary, setAhrefsSummary] = useState<TargetSummary[]>([]);
  const [userBlacklist, setUserBlacklist] = useState<RefBlacklistEntry[]>([]);

  // Wayback Machine (Apify actor)
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
  const [waybackResults, setWaybackResults] = useState<WaybackRow[]>([]);
  const [waybackRuns, setWaybackRuns] = useState<WaybackRunT[]>([]);
  const [waybackStarting, setWaybackStarting] = useState(false);
  const [expandedWayback, setExpandedWayback] = useState<Set<string>>(new Set());
  const [filterWayback, setFilterWayback] = useState<"flagged" | "clean" | "unchecked">("unchecked");

  const blacklistSet = useMemo(
    () => new Set(userBlacklist.map((e) => e.domain.toLowerCase())),
    [userBlacklist]
  );

  const refsByDomain = useMemo(() => {
    const m = new Map<string, { domain: string; dr: number }[]>();
    for (const t of ahrefsSummary) {
      const filtered = t.refs.filter((r) => !blacklistSet.has(r.domain));
      m.set(t.targetDomain, filtered);
    }
    return m;
  }, [ahrefsSummary, blacklistSet]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sellFormOpen, setSellFormOpen] = useState(false);
  const [sellRows, setSellRows] = useState<Record<string, string>>({});
  const [sellBulkPrice, setSellBulkPrice] = useState("");
  const [savingSell, setSavingSell] = useState(false);
  const [copiedListing, setCopiedListing] = useState(false);

  // Withdrawals
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [withdrawalFormOpen, setWithdrawalFormOpen] = useState(false);
  const [withdrawalListOpen, setWithdrawalListOpen] = useState(false);
  const [savingWithdrawal, setSavingWithdrawal] = useState(false);
  const [editingWithdrawalId, setEditingWithdrawalId] = useState<string | null>(null);
  const [wDate, setWDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [wAmount, setWAmount] = useState("");
  const [wCurrency, setWCurrency] = useState("USD");
  const [wStatus, setWStatus] = useState<WithdrawalStatus>("paid");
  const [wWallet, setWWallet] = useState<WithdrawalWallet>(null);
  const [wNotes, setWNotes] = useState("");

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((message: string, isError = false) => {
    const id = ++toastIdRef.current;
    setToasts((p) => [...p, { id, message, isError }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [invRes, ahrefsRes, blRes, wRes, wbResRes, wbRunsRes] = await Promise.all([
        fetch("/api/inventory"),
        fetch("/api/ahrefs-results/db"),
        fetch("/api/ref-blacklist"),
        fetch("/api/withdrawals"),
        fetch("/api/wayback/results"),
        fetch("/api/wayback/runs"),
      ]);
      const invData = await invRes.json();
      const ahrefsData = await ahrefsRes.json();
      const blData = await blRes.json();
      const wData = await wRes.json();
      const wbResData = await wbResRes.json();
      const wbRunsData = await wbRunsRes.json();
      setEntries(Array.isArray(invData) ? invData : []);
      setAhrefsSummary(Array.isArray(ahrefsData) ? ahrefsData : []);
      setUserBlacklist(Array.isArray(blData) ? blData : []);
      setWithdrawals(Array.isArray(wData) ? wData : []);
      setWaybackResults(wbResData.rows ?? []);
      setWaybackRuns(wbRunsData.runs ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Wayback (light reload to refresh only wayback state without blocking the page) ──
  const reloadWayback = useCallback(async () => {
    try {
      const [r, ru] = await Promise.all([
        fetch("/api/wayback/results"),
        fetch("/api/wayback/runs"),
      ]);
      const d = await r.json();
      const dr = await ru.json();
      setWaybackResults(d.rows ?? []);
      setWaybackRuns(dr.runs ?? []);
    } catch { /* ignore */ }
  }, []);

  const startWaybackCheck = useCallback(async (targets: string[]) => {
    if (!targets.length) return;
    setWaybackStarting(true);
    try {
      const res = await fetch("/api/wayback/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Start run thất bại");
      showToast(`✅ Trigger Wayback · ${targets.length} domain · runId ${data.run.runId.slice(0, 8)}…`);
      await reloadWayback();
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setWaybackStarting(false);
    }
  }, [reloadWayback, showToast]);

  const pollWaybackRun = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/wayback/runs/${encodeURIComponent(runId)}`);
      const data = await res.json();
      if (!res.ok) return;
      if (data.ingested?.count) {
        showToast(`✅ Wayback ingested ${data.ingested.count} kết quả`);
      }
      await reloadWayback();
    } catch { /* ignore */ }
  }, [reloadWayback, showToast]);

  // Auto-poll any RUNNING runs every 10s.
  useEffect(() => {
    const running = waybackRuns.filter((r) => r.status === "READY" || r.status === "RUNNING");
    if (running.length === 0) return;
    const id = setInterval(() => {
      for (const r of running) pollWaybackRun(r.runId);
    }, 10000);
    return () => clearInterval(id);
  }, [waybackRuns, pollWaybackRun]);

  const profitOf = (e: InventoryEntry) =>
    e.sellPrice != null && e.purchasePrice != null ? e.sellPrice - e.purchasePrice : null;

  // Optimistic local update — avoids full reload after each edit
  const patchLocal = useCallback((domain: string, patch: Partial<InventoryEntry>) => {
    setEntries((prev) => prev.map((e) => (e.domain === domain ? { ...e, ...patch } : e)));
  }, []);

  // ─── Date range ─────────────────────────────────────────────────────────────
  const dateRange = useMemo<{ from: Date | null; to: Date | null }>(() => {
    if (datePreset === "all") return { from: null, to: null };
    const now = new Date();
    const to = new Date(now);
    to.setHours(23, 59, 59, 999);
    if (datePreset === "custom") {
      const from = customFrom ? new Date(customFrom + "T00:00:00") : null;
      const toCustom = customTo ? new Date(customTo + "T23:59:59") : null;
      return { from, to: toCustom };
    }
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    if (datePreset === "7d") from.setDate(from.getDate() - 7);
    else if (datePreset === "30d") from.setDate(from.getDate() - 30);
    else if (datePreset === "month") from.setDate(1);
    else if (datePreset === "year") { from.setMonth(0); from.setDate(1); }
    return { from, to };
  }, [datePreset, customFrom, customTo]);

  const inRange = useCallback((iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    if (dateRange.from && t < dateRange.from.getTime()) return false;
    if (dateRange.to && t > dateRange.to.getTime()) return false;
    return true;
  }, [dateRange]);

  // Within range = entry was purchased in range OR sold in range
  // Drop archived rows unless user explicitly toggles "Hiện cả lưu trữ".
  // Done at the very top so stats + table both honor the filter.
  const visibleEntries = useMemo(
    () => (showArchived ? entries : entries.filter((e) => !e.archivedAt)),
    [entries, showArchived],
  );
  const archivedCount = useMemo(
    () => entries.filter((e) => e.archivedAt).length,
    [entries],
  );

  const dateFiltered = useMemo(() => {
    if (datePreset === "all") return visibleEntries;
    return visibleEntries.filter((e) => inRange(e.purchasedAt) || inRange(e.soldAt));
  }, [visibleEntries, datePreset, inRange]);

  const stats = useMemo(() => {
    // Matched profit accounting (no sales yet → 0 profit, not -100% ROI):
    //   - Chi phí: sum purchase_price for ALL entries in scope (capital deployed)
    //   - Doanh thu: sum sell_price for SOLD entries in scope
    //   - Lợi nhuận: sum (sell - buy) for SOLD entries in scope (realized profit)
    //   - ROI: Lợi nhuận / cost-basis-of-sold (so unsold holdings don't dilute)
    let totalSpend = 0;
    let totalRevenue = 0;
    let totalProfit = 0;
    let soldCostBasis = 0;
    let soldCount = 0;
    let holdingCount = 0;
    let holdingExpectedTotal = 0;
    let holdingExpectedCount = 0;

    const inScope = (e: InventoryEntry) =>
      datePreset === "all" || inRange(e.purchasedAt) || inRange(e.soldAt);

    for (const e of visibleEntries) {
      if (!inScope(e)) continue;
      totalSpend += e.purchasePrice ?? 0;
      if (e.sellPrice != null) {
        soldCount++;
        totalRevenue += e.sellPrice;
        const p = profitOf(e);
        if (p != null) {
          totalProfit += p;
          soldCostBasis += e.purchasePrice ?? 0;
        }
      } else {
        holdingCount++;
        if (e.expectedSellPrice != null) {
          holdingExpectedTotal += e.expectedSellPrice;
          holdingExpectedCount++;
        }
      }
    }
    return {
      totalSpend, totalRevenue, totalProfit, soldCount, holdingCount, soldCostBasis,
      holdingExpectedTotal, holdingExpectedCount,
    };
  }, [visibleEntries, datePreset, inRange]);

  // Quick lookup: domain → wayback row.
  const waybackByDomain = useMemo(() => {
    const m = new Map<string, WaybackRow>();
    for (const r of waybackResults) m.set(r.targetDomain, r);
    return m;
  }, [waybackResults]);

  const inFlightWaybackTargets = useMemo(() => {
    const s = new Set<string>();
    for (const r of waybackRuns) {
      if (r.status === "READY" || r.status === "RUNNING") {
        for (const d of r.targets) s.add(d);
      }
    }
    return s;
  }, [waybackRuns]);

  const filtered = useMemo(() => {
    const list = dateFiltered.filter((e) => {
      if (search && !e.domain.includes(search.toLowerCase())) return false;
      if (filterStatus === "holding" && e.sellPrice != null) return false;
      if (filterStatus === "sold" && e.sellPrice == null) return false;
      if (filterExpected === "yes" && e.expectedSellPrice == null) return false;
      if (filterExpected === "no" && e.expectedSellPrice != null) return false;
      {
        const wb = waybackByDomain.get(e.domain);
        const isFlagged = !!(wb && (wb.hasBetting || wb.hasAdult));
        if (filterWayback === "flagged" && !isFlagged) return false;
        // Clean = đã check + không flagged (bao gồm cả case "no snapshots / error" — vẫn coi là an toàn).
        if (filterWayback === "clean" && !(wb && !isFlagged)) return false;
        if (filterWayback === "unchecked" && wb) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sortKey === "purchasePrice") {
        av = a.purchasePrice ?? -1; bv = b.purchasePrice ?? -1;
      } else if (sortKey === "sellPrice") {
        av = a.sellPrice ?? -Infinity; bv = b.sellPrice ?? -Infinity;
      } else if (sortKey === "expectedSellPrice") {
        av = a.expectedSellPrice ?? -Infinity; bv = b.expectedSellPrice ?? -Infinity;
      } else if (sortKey === "profit") {
        av = profitOf(a) ?? -Infinity; bv = profitOf(b) ?? -Infinity;
      } else if (sortKey === "purchasedAt") {
        av = new Date(a.purchasedAt).getTime(); bv = new Date(b.purchasedAt).getTime();
      } else if (sortKey === "soldAt") {
        av = a.soldAt ? new Date(a.soldAt).getTime() : -Infinity;
        bv = b.soldAt ? new Date(b.soldAt).getTime() : -Infinity;
      } else if (sortKey === "status") {
        av = a.sellPrice != null ? 1 : 0; bv = b.sellPrice != null ? 1 : 0;
      } else {
        av = (a[sortKey as keyof InventoryEntry] ?? "") as string;
        bv = (b[sortKey as keyof InventoryEntry] ?? "") as string;
      }
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
  }, [dateFiltered, search, filterStatus, filterExpected, filterWayback, waybackByDomain, sortKey, sortDir]);

  // Pagination — applied on top of `filtered`
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(filtered.length / pageSize)) : 1;
  const safePage = Math.min(page, totalPages - 1);
  const pagedRows = useMemo(
    () => (pageSize > 0 ? filtered.slice(safePage * pageSize, (safePage + 1) * pageSize) : filtered),
    [filtered, safePage, pageSize]
  );

  // Reset to first page when filters/sort/search change
  useEffect(() => {
    setPage(0);
  }, [search, filterStatus, filterExpected, filterWayback, datePreset, customFrom, customTo, sortKey, sortDir, pageSize]);

  const toggleSelect = (domain: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => {
      // Operate on current page only — typical Gmail-style "select visible"
      const visible = pagedRows.map((e) => e.domain);
      const allSelected = visible.length > 0 && visible.every((d) => prev.has(d));
      if (allSelected) {
        const next = new Set(prev);
        for (const d of visible) next.delete(d);
        return next;
      }
      const next = new Set(prev);
      for (const d of visible) next.add(d);
      return next;
    });
  };

  // Confirm a backorder (flip is_backorder=false → now owned).
  const confirmBackorderSelected = useCallback(async () => {
    if (selected.size === 0) return;
    const domains = Array.from(selected);
    try {
      const res = await fetch("/api/inventory/backorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains, isBackorder: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lỗi");
      setEntries((prev) =>
        prev.map((e) => (selected.has(e.domain) ? { ...e, isBackorder: false } : e)),
      );
      setSelected(new Set());
      showToast(`✅ Đã confirm ${domains.length} backorder`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    }
  }, [selected, showToast]);

  // Loại trừ — backorder fail hoặc bất kỳ lý do nào khác để bỏ domain:
  // xóa khỏi inventory + mark excluded trong target_assessment.
  const excludeSelected = useCallback(async () => {
    if (selected.size === 0) return;
    const domains = Array.from(selected);
    if (!confirm(`Loại trừ ${domains.length} domain? Sẽ xóa khỏi kho + ẩn khỏi picker.`)) return;
    try {
      const res = await fetch("/api/inventory/exclude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lỗi");
      // Drop them locally
      const dropSet = new Set(domains);
      setEntries((prev) => prev.filter((e) => !dropSet.has(e.domain)));
      setSelected(new Set());
      showToast(`✅ Đã loại trừ ${data.deletedFromInventory} domain`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    }
  }, [selected, showToast]);

  // Archive / un-archive selected domains. Optimistically updates local state
  // (since /api/inventory doesn't expose a `?refresh` flag) then re-reads.
  const archiveSelected = useCallback(async (archived: boolean) => {
    if (selected.size === 0) return;
    const domains = Array.from(selected);
    const verb = archived ? "lưu trữ" : "khôi phục";
    setArchiving(true);
    try {
      const res = await fetch("/api/inventory/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains, archived }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lỗi");
      // Patch local state so the UI updates immediately without a full reload.
      const now = new Date().toISOString();
      setEntries((prev) =>
        prev.map((e) =>
          selected.has(e.domain) ? { ...e, archivedAt: archived ? now : null } : e,
        ),
      );
      setSelected(new Set());
      showToast(`✅ Đã ${verb} ${domains.length} domain`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setArchiving(false);
    }
  }, [selected, showToast]);

  const openSellForm = useCallback(() => {
    if (selected.size === 0) return;
    const init: Record<string, string> = {};
    for (const d of selected) {
      const e = entries.find((x) => x.domain === d);
      // Pre-fill: existing sell price > expected price > empty
      const v = e?.sellPrice != null ? String(e.sellPrice)
        : e?.expectedSellPrice != null ? String(e.expectedSellPrice)
        : "";
      init[d] = v;
    }
    setSellRows(init);
    setSellBulkPrice("");
    setSellFormOpen(true);
  }, [selected, entries]);

  // Apply expected price to all in sell form
  const applyExpectedToSellForm = useCallback(() => {
    const next: Record<string, string> = { ...sellRows };
    for (const domain of Object.keys(next)) {
      const e = entries.find((x) => x.domain === domain);
      if (e?.expectedSellPrice != null) next[domain] = String(e.expectedSellPrice);
    }
    setSellRows(next);
  }, [sellRows, entries]);

  const applyBulkSellPrice = useCallback(() => {
    const v = sellBulkPrice.trim();
    if (!v) return;
    const next: Record<string, string> = { ...sellRows };
    for (const d of Object.keys(next)) next[d] = v;
    setSellRows(next);
  }, [sellBulkPrice, sellRows]);

  const saveSell = useCallback(async () => {
    setSavingSell(true);
    try {
      const rows: { domain: string; sellPrice: number | null }[] = [];
      for (const [domain, priceStr] of Object.entries(sellRows)) {
        const v = priceStr.trim();
        const price = v === "" ? null : Number(v);
        rows.push({ domain, sellPrice: isNaN(price as number) ? null : price });
      }
      const res = await fetch("/api/inventory/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lỗi");
      const now = new Date().toISOString();
      setEntries((prev) => prev.map((e) => {
        const r = rows.find((x) => x.domain === e.domain);
        if (!r) return e;
        return { ...e, sellPrice: r.sellPrice, soldAt: r.sellPrice == null ? null : now };
      }));
      setSellFormOpen(false);
      setSelected(new Set());
      showToast(`✅ Đã cập nhật giá bán cho ${data.updated} domain`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setSavingSell(false);
    }
  }, [sellRows, showToast]);

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(-1); }
  };

  const startEdit = (e: InventoryEntry) => {
    setEditingDomain(e.domain);
    setEditPrice(e.purchasePrice != null ? String(e.purchasePrice) : "");
    setEditNotes(e.notes ?? "");
  };

  const startEditExpected = (e: InventoryEntry) => {
    setEditingExpected(e.domain);
    setEditExpectedValue(e.expectedSellPrice != null ? String(e.expectedSellPrice) : "");
  };

  const saveExpected = useCallback(async (domain: string) => {
    const v = editExpectedValue.trim();
    const priceNum = v === "" ? null : Number(v);
    const finalPrice = isNaN(priceNum as number) ? null : priceNum;
    try {
      const res = await fetch(`/api/inventory/${encodeURIComponent(domain)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedSellPrice: finalPrice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lỗi");
      patchLocal(domain, { expectedSellPrice: finalPrice });
      setEditingExpected(null);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    }
  }, [editExpectedValue, patchLocal, showToast]);

  // Bulk: sell all selected domains @ their expected price (skips those without)
  const bulkSellAtExpected = useCallback(async () => {
    if (selected.size === 0) return;
    const rows: { domain: string; sellPrice: number }[] = [];
    let skipped = 0;
    for (const d of selected) {
      const e = entries.find((x) => x.domain === d);
      if (e?.expectedSellPrice != null) {
        rows.push({ domain: d, sellPrice: e.expectedSellPrice });
      } else {
        skipped++;
      }
    }
    if (rows.length === 0) {
      showToast("❌ Không có domain nào có giá dự kiến", true);
      return;
    }
    try {
      const res = await fetch("/api/inventory/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lỗi");
      const now = new Date().toISOString();
      setEntries((prev) => prev.map((e) => {
        const r = rows.find((x) => x.domain === e.domain);
        return r ? { ...e, sellPrice: r.sellPrice, soldAt: now } : e;
      }));
      setSelected(new Set());
      const skipNote = skipped > 0 ? ` · ${skipped} skipped (chưa có giá dự kiến)` : "";
      showToast(`✅ Bán ${data.updated} domain @ giá dự kiến${skipNote}`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    }
  }, [selected, entries, showToast]);

  // Listing rows = entries to "đăng bán" (must have expectedSellPrice).
  // If selection exists, scope to selected; else use current filtered view.
  const listingRows = useMemo(() => {
    const source = selected.size > 0
      ? filtered.filter((e) => selected.has(e.domain))
      : filtered;
    return source.filter((e) => e.expectedSellPrice != null);
  }, [filtered, selected]);

  // Copy listing in format "domain|price" per line
  const copyListing = useCallback(async () => {
    if (!listingRows.length) return;
    const text = listingRows
      .map((e) => `${e.domain}|${e.expectedSellPrice}`)
      .join("\n");
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
    setCopiedListing(true);
    setTimeout(() => setCopiedListing(false), 2000);
    showToast(`✅ Đã copy ${listingRows.length} dòng "domain|giá"`);
  }, [listingRows, showToast]);

  // Quick sell at expected price for one row
  const quickSellAtExpected = useCallback(async (e: InventoryEntry) => {
    if (e.expectedSellPrice == null) {
      showToast("❌ Domain này chưa có giá dự kiến", true);
      return;
    }
    try {
      const res = await fetch("/api/inventory/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: [{ domain: e.domain, sellPrice: e.expectedSellPrice }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lỗi");
      patchLocal(e.domain, { sellPrice: e.expectedSellPrice, soldAt: new Date().toISOString() });
      showToast(`✅ Đã bán ${e.domain} @ $${e.expectedSellPrice.toFixed(2)}`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    }
  }, [patchLocal, showToast]);

  const saveEdit = useCallback(async (domain: string) => {
    const priceNum = editPrice.trim() === "" ? null : Number(editPrice);
    const finalPrice = isNaN(priceNum as number) ? null : priceNum;
    try {
      const res = await fetch(`/api/inventory/${encodeURIComponent(domain)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchasePrice: finalPrice, notes: editNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lỗi");
      patchLocal(domain, { purchasePrice: finalPrice, notes: editNotes });
      setEditingDomain(null);
      showToast(`✅ Đã cập nhật ${domain}`);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    }
  }, [editPrice, editNotes, patchLocal, showToast]);

  // ─── Withdrawals ────────────────────────────────────────────────────────────

  const openWithdrawalForm = useCallback(() => {
    setEditingWithdrawalId(null);
    setWDate(new Date().toISOString().slice(0, 10));
    setWAmount("");
    setWCurrency("USD");
    setWStatus("paid");
    setWWallet(null);
    setWNotes("");
    setWithdrawalFormOpen(true);
  }, []);

  const openEditWithdrawal = useCallback((w: Withdrawal) => {
    setEditingWithdrawalId(w.id);
    setWDate(new Date(w.withdrawnAt).toISOString().slice(0, 10));
    setWAmount(String(w.amount));
    setWCurrency(w.currency);
    setWStatus(w.status);
    setWWallet(w.wallet ?? null);
    setWNotes(w.notes ?? "");
    setWithdrawalFormOpen(true);
  }, []);

  const saveWithdrawal = useCallback(async () => {
    const amount = parseFloat(wAmount);
    if (!wDate || isNaN(amount) || amount <= 0) {
      showToast("❌ Vui lòng nhập ngày và số tiền hợp lệ", true);
      return;
    }
    setSavingWithdrawal(true);
    try {
      const payload = {
        withdrawnAt: new Date(wDate + "T00:00:00").toISOString(),
        amount,
        currency: wCurrency.trim() || "USD",
        status: wStatus,
        wallet: wWallet,
        notes: wNotes.trim() || null,
      };
      if (editingWithdrawalId) {
        // EDIT mode
        const res = await fetch(`/api/withdrawals/${editingWithdrawalId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Lỗi");
        const id = editingWithdrawalId;
        setWithdrawals((prev) => prev.map((w) => (w.id === id ? {
          ...w,
          withdrawnAt: payload.withdrawnAt,
          amount: payload.amount,
          currency: payload.currency,
          status: payload.status,
          wallet: payload.wallet,
          notes: payload.notes,
        } : w)));
        setWithdrawalFormOpen(false);
        setEditingWithdrawalId(null);
        showToast(`✅ Đã cập nhật`);
      } else {
        // CREATE mode
        const res = await fetch("/api/withdrawals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Lỗi");
        setWithdrawals((prev) => [data.entry, ...prev]);
        setWithdrawalFormOpen(false);
        showToast(`✅ Đã rút $${amount.toFixed(2)} ${wCurrency}`);
      }
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setSavingWithdrawal(false);
    }
  }, [wDate, wAmount, wCurrency, wStatus, wWallet, wNotes, editingWithdrawalId, showToast]);

  const deleteWithdrawal = useCallback(async (id: string) => {
    if (!confirm("Xóa lần rút này?")) return;
    try {
      await fetch(`/api/withdrawals/${id}`, { method: "DELETE" });
      setWithdrawals((prev) => prev.filter((w) => w.id !== id));
      showToast("🗑️ Đã xóa");
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    }
  }, [showToast]);

  const updateWithdrawalStatus = useCallback(async (id: string, status: WithdrawalStatus) => {
    try {
      const res = await fetch(`/api/withdrawals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lỗi");
      setWithdrawals((prev) => prev.map((w) => (w.id === id ? { ...w, status } : w)));
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    }
  }, [showToast]);

  // Stats: total withdrawn (in USD only — ignore other currencies for the card)
  const withdrawalStats = useMemo(() => {
    let totalUsdPaid = 0;
    let totalUsdPending = 0; // progressing + under_review
    const byWallet: Record<"evault" | "gname" | "none", { paid: number; pending: number }> = {
      evault: { paid: 0, pending: 0 },
      gname:  { paid: 0, pending: 0 },
      none:   { paid: 0, pending: 0 },
    };
    for (const w of withdrawals) {
      if (w.currency !== "USD") continue;
      if (datePreset !== "all" && !inRange(w.withdrawnAt)) continue;
      const key = w.wallet ?? "none";
      if (w.status === "paid") {
        totalUsdPaid += w.amount;
        byWallet[key].paid += w.amount;
      } else {
        totalUsdPending += w.amount;
        byWallet[key].pending += w.amount;
      }
    }
    return { totalUsdPaid, totalUsdPending, byWallet };
  }, [withdrawals, datePreset, inRange]);

  const removeEntry = useCallback(async (domain: string) => {
    if (!confirm(`Xóa ${domain} khỏi kho?`)) return;
    await fetch(`/api/inventory/${encodeURIComponent(domain)}`, { method: "DELETE" });
    setEntries((prev) => prev.filter((e) => e.domain !== domain));
    showToast(`🗑️ Đã xóa ${domain}`);
  }, [showToast]);

  const exportCsv = useCallback(() => {
    if (!filtered.length) return;
    const headers = ["domain", "ref_domains", "expected_sell_price"];
    // RFC 4180 — wrap in quotes if needed (chứa quote, comma, newline, hoặc semicolon
    // vì một số GSheet locale dùng ";" làm field separator).
    const escape = (v: unknown) => {
      const s = String(v ?? "");
      return /["\,\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    // Force-quote: luôn bọc trong quote để tránh parser nhầm bất kỳ ký tự nào.
    const forceQuote = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = filtered.map((e) => {
      const refs = refsByDomain.get(e.domain) ?? [];
      // Dùng " | " (pipe) thay cho "; " — pipe an toàn hơn vì không phải field
      // separator của bất kỳ locale nào trong GSheet/Excel.
      const refsCell = refs.map((r) => `${r.domain} (DR ${r.dr})`).join(" | ");
      return [
        escape(e.domain),
        forceQuote(refsCell),       // luôn quote — refs có thể chứa nhiều ký tự lạ
        escape(e.expectedSellPrice ?? ""),
      ].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\r\n");
    // BOM (﻿) → Excel/GSheet biết là UTF-8.
    // Dòng đầu "sep=," → ép GSheet/Excel dùng comma làm field separator,
    // bất kể locale của user (rất quan trọng với GSheet ở VN/EU).
    const blob = new Blob(["﻿sep=,\r\n" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `domain-inventory-${ts}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filtered, refsByDomain]);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Kho Domain</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Danh sách domain đã mua. Click giá để chỉnh sửa.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as typeof datePreset)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs cursor-pointer"
          >
            <option value="all">Tất cả thời gian</option>
            <option value="7d">7 ngày qua</option>
            <option value="30d">30 ngày qua</option>
            <option value="month">Tháng này</option>
            <option value="year">Năm nay</option>
            <option value="custom">Tùy chỉnh...</option>
          </select>
          {datePreset === "custom" && (
            <>
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 w-36 text-xs"
                placeholder="Từ"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 w-36 text-xs"
                placeholder="Đến"
              />
            </>
          )}
          {datePreset !== "all" && dateRange.from && dateRange.to && (
            <span className="text-[11px] text-muted-foreground italic">
              {dateRange.from.toLocaleDateString()} → {dateRange.to.toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase">Tổng Domain</p>
          <p className="text-2xl font-bold">{entries.length.toLocaleString()}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {stats.holdingCount} holding · {stats.soldCount} sold
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase">Chi phí</p>
          <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">
            ${stats.totalSpend.toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase">Doanh thu</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            ${stats.totalRevenue.toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase">Lợi nhuận</p>
          <p className={cn(
            "text-2xl font-bold",
            stats.totalProfit > 0 ? "text-emerald-600 dark:text-emerald-400"
              : stats.totalProfit < 0 ? "text-rose-600 dark:text-rose-400"
              : "text-muted-foreground"
          )}>
            {stats.totalProfit >= 0 ? "+" : ""}${stats.totalProfit.toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase">ROI</p>
          <p className={cn(
            "text-2xl font-bold",
            stats.soldCostBasis > 0 && stats.totalProfit > 0 ? "text-emerald-600 dark:text-emerald-400"
              : stats.totalProfit < 0 ? "text-rose-600 dark:text-rose-400"
              : "text-muted-foreground"
          )}>
            {stats.soldCostBasis > 0 ? `${((stats.totalProfit / stats.soldCostBasis) * 100).toFixed(1)}%` : "—"}
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase">Tiềm năng</p>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            ${stats.holdingExpectedTotal.toFixed(2)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {stats.holdingExpectedCount}/{stats.holdingCount} đang giữ có giá DK
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase">Đã rút</p>
          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
            ${withdrawalStats.totalUsdPaid.toFixed(2)}
          </p>
          {withdrawalStats.totalUsdPending > 0 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
              + ${withdrawalStats.totalUsdPending.toFixed(2)} đang chờ
            </p>
          )}
          {(() => {
            const rows: { label: string; paid: number; pending: number }[] = [
              { label: "Ví điện tử", ...withdrawalStats.byWallet.evault },
              { label: "Gname",      ...withdrawalStats.byWallet.gname },
              { label: "Trống",      ...withdrawalStats.byWallet.none },
            ].filter((r) => r.paid > 0 || r.pending > 0);
            if (rows.length === 0) return null;
            return (
              <div className="mt-2 pt-2 border-t border-border/50 space-y-0.5">
                {rows.map((r) => (
                  <div key={r.label} className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="font-medium tabular-nums">
                      ${r.paid.toFixed(2)}
                      {r.pending > 0 && (
                        <span className="text-amber-600 dark:text-amber-400 ml-1">
                          +${r.pending.toFixed(2)}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Tìm domain..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as "all" | "holding" | "sold")}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs cursor-pointer"
          title="Filter Status"
        >
          <option value="all">Tất cả</option>
          <option value="holding">Đang giữ</option>
          <option value="sold">Đã bán</option>
        </select>
        <select
          value={filterExpected}
          onChange={(e) => setFilterExpected(e.target.value as "all" | "yes" | "no")}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs cursor-pointer"
          title="Filter Giá dự kiến"
        >
          <option value="all">Tất cả giá</option>
          <option value="yes">Đã có giá dự kiến</option>
          <option value="no">Chưa có giá dự kiến</option>
        </select>
        <select
          value={filterWayback}
          onChange={(e) => setFilterWayback(e.target.value as "flagged" | "clean" | "unchecked")}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs cursor-pointer"
          title="Filter Wayback status"
        >
          <option value="clean">🟢 Clean</option>
          <option value="flagged">🚨 Flagged</option>
          <option value="unchecked">— Chưa check</option>
        </select>
        {archivedCount > 0 && (
          <label
            className="flex items-center gap-1.5 text-xs cursor-pointer select-none px-2 py-1 rounded-md border border-input bg-background hover:bg-muted"
            title={`${archivedCount} domain đã lưu trữ — bật để hiện chúng trong danh sách`}
          >
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded"
            />
            <span>Hiện lưu trữ ({archivedCount})</span>
          </label>
        )}
        {(() => {
          // Trigger Wayback for holding + currently-filtered + unchecked domains.
          const candidates = filtered
            .filter((e) => e.sellPrice == null) // holding only
            .map((e) => e.domain)
            .filter((d) => !waybackByDomain.has(d) && !inFlightWaybackTargets.has(d));
          if (candidates.length === 0) return null;
          return (
            <Button
              size="sm"
              variant="outline"
              disabled={waybackStarting}
              onClick={() => startWaybackCheck(candidates)}
              className="gap-1.5 text-purple-700 border-purple-400/60 hover:bg-purple-50 dark:hover:bg-purple-950"
              title={`Trigger Apify Wayback actor cho ${candidates.length} domain đang giữ chưa check`}
            >
              {waybackStarting ? "Đang trigger…" : `🕰️ Check Wayback (${candidates.length})`}
            </Button>
          );
        })()}
        {inFlightWaybackTargets.size > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 px-2 py-1 text-[11px] font-medium">
            <Loader2 className="h-3 w-3 animate-spin" />
            {inFlightWaybackTargets.size} đang chạy
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={copyListing}
          disabled={!listingRows.length}
          title={
            listingRows.length === 0
              ? "Cần có domain với Giá dự kiến để đăng bán"
              : `Copy ${listingRows.length} dòng "domain|giá" vào clipboard`
          }
        >
          {copiedListing
            ? <Check className="h-3.5 w-3.5 text-green-500" />
            : <Tag className="h-3.5 w-3.5" />}
          {copiedListing ? "Đã copy!" : `Đăng Bán (${listingRows.length})`}
        </Button>
        {selected.size > 0 && (() => {
          const withExpected = Array.from(selected).filter((d) => {
            const e = entries.find((x) => x.domain === d);
            return e?.expectedSellPrice != null;
          }).length;
          const archivedInSel = Array.from(selected).filter((d) => {
            const e = entries.find((x) => x.domain === d);
            return !!e?.archivedAt;
          }).length;
          const isAllArchived = archivedInSel === selected.size;
          const backorderInSel = Array.from(selected).filter((d) => {
            const e = entries.find((x) => x.domain === d);
            return !!e?.isBackorder;
          }).length;
          const hasBackorder = backorderInSel > 0;
          return (
            <>
              <Button
                size="sm"
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={openSellForm}
              >
                <DollarSign className="h-3.5 w-3.5" />
                Đã bán ({selected.size})
              </Button>
              <Button
                size="sm"
                className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                onClick={bulkSellAtExpected}
                disabled={withExpected === 0}
                title={withExpected === 0 ? "Không domain nào có giá dự kiến" : `Bán ${withExpected} domain @ giá dự kiến (skip ${selected.size - withExpected} chưa có)`}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                Bán @ Dự kiến ({withExpected}{selected.size > withExpected ? `/${selected.size}` : ""})
              </Button>
              {hasBackorder && (
                <Button
                  size="sm"
                  className="gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white"
                  onClick={confirmBackorderSelected}
                  title={`Confirm ${backorderInSel} backorder — chuyển sang trạng thái đã sở hữu`}
                >
                  <Check className="h-3.5 w-3.5" />
                  Confirm BO ({backorderInSel}{selected.size > backorderInSel ? `/${selected.size}` : ""})
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-rose-700 border-rose-400/60 hover:bg-rose-50 dark:hover:bg-rose-950"
                onClick={excludeSelected}
                title={`Loại trừ ${selected.size} domain — xóa khỏi kho + ẩn khỏi picker (dùng cho backorder fail)`}
              >
                <X className="h-3.5 w-3.5" />
                Loại trừ ({selected.size})
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={archiving}
                className={cn(
                  "gap-1.5",
                  isAllArchived
                    ? "text-emerald-700 border-emerald-400/60 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                    : "text-slate-700 border-slate-400/60 hover:bg-slate-50 dark:hover:bg-slate-950"
                )}
                onClick={() => archiveSelected(!isAllArchived)}
                title={
                  isAllArchived
                    ? `Khôi phục ${selected.size} domain — hiện lại trong Kho Domain`
                    : `Lưu trữ ${selected.size} domain — ẩn khỏi Kho Domain (DB vẫn còn)`
                }
              >
                <Boxes className="h-3.5 w-3.5" />
                {isAllArchived ? `Khôi phục (${selected.size})` : `Lưu trữ (${selected.size})`}
              </Button>
              <Button
                size="sm" variant="ghost" className="gap-1.5 text-xs"
                onClick={() => setSelected(new Set())}
              >
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            </>
          );
        })()}
        <Button
          size="sm"
          className="gap-1.5 ml-auto bg-purple-600 hover:bg-purple-700 text-white"
          onClick={openWithdrawalForm}
        >
          <Wallet className="h-3.5 w-3.5" />
          Rút tiền
        </Button>
        <Button
          size="sm" variant="outline" className="gap-1.5"
          onClick={exportCsv}
          disabled={!filtered.length}
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {/* Withdrawal form */}
      {withdrawalFormOpen && (
        <div className="rounded-lg border border-purple-300 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-950/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-purple-600" />
              <h3 className="text-sm font-semibold">
                {editingWithdrawalId ? "Sửa lần rút tiền" : "Ghi nhận lần rút tiền"}
              </h3>
            </div>
            <button
              onClick={() => { setWithdrawalFormOpen(false); setEditingWithdrawalId(null); }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Ngày</label>
              <Input
                type="date"
                value={wDate}
                onChange={(e) => setWDate(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Số tiền</label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={wAmount}
                onChange={(e) => setWAmount(e.target.value)}
                className="h-8 text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Đơn vị</label>
              <Input
                type="text"
                value={wCurrency}
                onChange={(e) => setWCurrency(e.target.value.toUpperCase())}
                placeholder="USD"
                maxLength={6}
                className="h-8 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Trạng thái</label>
              <select
                value={wStatus}
                onChange={(e) => setWStatus(e.target.value as WithdrawalStatus)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm cursor-pointer"
              >
                <option value="paid">Đã nhận</option>
                <option value="progressing">Progressing</option>
                <option value="under_review">Under Review</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Ví nhận tiền</label>
              <select
                value={wWallet ?? ""}
                onChange={(e) => setWWallet(e.target.value === "" ? null : (e.target.value as WithdrawalWallet))}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm cursor-pointer"
              >
                <option value="">Trống</option>
                <option value="evault">Ví điện tử</option>
                <option value="gname">Gname</option>
              </select>
            </div>
          </div>

          <div className="mb-3">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Ghi chú (optional)</label>
            <Input
              type="text"
              value={wNotes}
              onChange={(e) => setWNotes(e.target.value)}
              placeholder="vd: Wise transfer to Vietcombank"
              className="h-8 text-sm"
            />
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={saveWithdrawal}
              disabled={savingWithdrawal}
              className="gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
            >
              {savingWithdrawal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SaveIcon className="h-3.5 w-3.5" />}
              {savingWithdrawal ? "Đang lưu..." : (editingWithdrawalId ? "Cập nhật" : "Lưu")}
            </Button>
            <Button
              size="sm" variant="ghost"
              onClick={() => { setWithdrawalFormOpen(false); setEditingWithdrawalId(null); }}
            >
              Hủy
            </Button>
          </div>
        </div>
      )}

      {/* Sell form */}
      {sellFormOpen && (
        <div className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-600" />
              <h3 className="text-sm font-semibold">Đánh dấu đã bán — {Object.keys(sellRows).length} domain</h3>
            </div>
            <button onClick={() => setSellFormOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-emerald-200 dark:border-emerald-800 flex-wrap">
            <span className="text-xs text-muted-foreground">Áp giá đồng loạt:</span>
            <Input
              type="number" step="0.01"
              placeholder="vd: 50.00"
              value={sellBulkPrice}
              onChange={(e) => setSellBulkPrice(e.target.value)}
              className="h-7 w-32 text-xs"
            />
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={applyBulkSellPrice}>
              Apply all
            </Button>
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs gap-1 border-emerald-400 text-emerald-700 dark:text-emerald-300"
              onClick={applyExpectedToSellForm}
              title="Set giá bán = Giá dự kiến cho từng domain"
            >
              <TrendingUp className="h-3 w-3" />
              Dùng giá dự kiến
            </Button>
            <span className="text-[11px] text-muted-foreground italic ml-auto">
              Để trống để hủy đánh dấu bán
            </span>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1 mb-3">
            {Object.keys(sellRows).map((domain) => {
              const e = entries.find((x) => x.domain === domain);
              const buyPrice = e?.purchasePrice ?? 0;
              const sellNum = Number(sellRows[domain]);
              const profit = sellRows[domain] && !isNaN(sellNum) ? sellNum - buyPrice : null;
              return (
                <div key={domain} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 text-xs">
                  <span className="font-mono truncate">{domain}</span>
                  <span className="text-muted-foreground whitespace-nowrap">
                    Mua ${buyPrice.toFixed(2)}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Bán $</span>
                    <Input
                      type="number" step="0.01"
                      placeholder="0.00"
                      value={sellRows[domain]}
                      onChange={(ev) => setSellRows({ ...sellRows, [domain]: ev.target.value })}
                      className="h-6 w-24 text-xs"
                    />
                  </div>
                  <span className={cn(
                    "min-w-[80px] text-right font-semibold",
                    profit == null ? "text-muted-foreground"
                      : profit > 0 ? "text-emerald-600 dark:text-emerald-400"
                      : profit < 0 ? "text-rose-600 dark:text-rose-400"
                      : "text-muted-foreground"
                  )}>
                    {profit == null ? "—" : `${profit >= 0 ? "+" : ""}$${profit.toFixed(2)}`}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex gap-2">
            <Button
              size="sm" onClick={saveSell} disabled={savingSell}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {savingSell ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SaveIcon className="h-3.5 w-3.5" />}
              {savingSell ? "Đang lưu..." : "Lưu giá bán"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSellFormOpen(false)}>
              Hủy
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        {loading ? (
          <p className="text-center py-12 text-muted-foreground">Đang tải...</p>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <Boxes className="h-8 w-8 opacity-40" />
            <p className="text-sm">Kho trống — đánh dấu &quot;Đã mua&quot; ở Domain Picker để bắt đầu</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <th className="px-3 py-3 w-8">
                    <input
                      type="checkbox"
                      className="rounded cursor-pointer"
                      aria-label="Select all"
                      checked={pagedRows.length > 0 && pagedRows.every((e) => selected.has(e.domain))}
                      ref={(el) => {
                        if (!el) return;
                        const sCount = pagedRows.filter((e) => selected.has(e.domain)).length;
                        el.indeterminate = sCount > 0 && sCount < pagedRows.length;
                      }}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <SortTh label="Domain" col="domain" current={sortKey} dir={sortDir} onSort={() => handleSort("domain")} />
                  <SortTh label="Status" col="status" current={sortKey} dir={sortDir} onSort={() => handleSort("status")} />
                  <SortTh label="Giá mua" col="purchasePrice" current={sortKey} dir={sortDir} onSort={() => handleSort("purchasePrice")} />
                  <SortTh label="Giá dự kiến" col="expectedSellPrice" current={sortKey} dir={sortDir} onSort={() => handleSort("expectedSellPrice")} />
                  <SortTh label="Giá bán" col="sellPrice" current={sortKey} dir={sortDir} onSort={() => handleSort("sellPrice")} />
                  <SortTh label="Lợi nhuận" col="profit" current={sortKey} dir={sortDir} onSort={() => handleSort("profit")} />
                  <SortTh label="Đánh giá" col="rating" current={sortKey} dir={sortDir} onSort={() => handleSort("rating")} />
                  <SortTh label="Phân loại" col="category" current={sortKey} dir={sortDir} onSort={() => handleSort("category")} />
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Refs</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap" title="Wayback Machine: snapshot history + AI flagged content">Wayback</th>
                  <SortTh label="Ngày mua" col="purchasedAt" current={sortKey} dir={sortDir} onSort={() => handleSort("purchasedAt")} />
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((e) => {
                  const isEditing = editingDomain === e.domain;
                  const isSold = e.sellPrice != null;
                  const profit = profitOf(e);
                  const wb = waybackByDomain.get(e.domain);
                  const wbExpanded = expandedWayback.has(e.domain);
                  return (
                    <React.Fragment key={e.domain}>
                    <tr className={cn(
                      "border-b border-border/50 hover:bg-muted/20 group align-top",
                      selected.has(e.domain) && "bg-blue-50/50 dark:bg-blue-950/30",
                      e.archivedAt && "opacity-60 italic"
                    )}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="rounded cursor-pointer"
                          checked={selected.has(e.domain)}
                          onChange={() => toggleSelect(e.domain)}
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        <div className="flex items-center gap-1.5">
                          <span>{e.domain}</span>
                          <a
                            href={`https://${e.domain}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        {(isEditing || e.notes) && (
                          <div className="mt-1">
                            {isEditing ? (
                              <Input
                                placeholder="Notes..."
                                value={editNotes}
                                onChange={(ev) => setEditNotes(ev.target.value)}
                                className="h-6 text-[11px] font-sans w-full max-w-[300px]"
                              />
                            ) : (
                              <p className="text-[11px] font-sans text-muted-foreground italic">{e.notes}</p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                          isSold
                            ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                            : e.isBackorder
                              ? "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300"
                              : "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                        )}>
                          {isSold
                            ? <><DollarSign className="h-2.5 w-2.5" /> Đã bán</>
                            : e.isBackorder
                              ? <>🛒 Backorder</>
                              : <><Boxes className="h-2.5 w-2.5" /> Đang giữ</>
                          }
                        </span>
                        {isSold && e.soldAt && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(e.soldAt).toLocaleDateString()}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground">$</span>
                            <Input
                              type="number"
                              step="0.01"
                              value={editPrice}
                              onChange={(ev) => setEditPrice(ev.target.value)}
                              className="h-7 w-24 text-xs"
                              autoFocus
                            />
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(e)}
                            className="text-sm font-semibold hover:underline cursor-pointer text-rose-600 dark:text-rose-400"
                          >
                            {e.purchasePrice != null ? `$${e.purchasePrice.toFixed(2)}` : "—"}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editingExpected === e.domain ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground">$</span>
                            <Input
                              type="number" step="0.01"
                              value={editExpectedValue}
                              onChange={(ev) => setEditExpectedValue(ev.target.value)}
                              onBlur={() => saveExpected(e.domain)}
                              onKeyDown={(ev) => { if (ev.key === "Enter") saveExpected(e.domain); }}
                              className="h-7 w-24 text-xs"
                              autoFocus
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => startEditExpected(e)}
                              className={cn(
                                "text-sm hover:underline cursor-pointer whitespace-nowrap",
                                e.expectedSellPrice != null
                                  ? "font-semibold text-blue-600 dark:text-blue-400"
                                  : "text-muted-foreground italic text-xs"
                              )}
                            >
                              {e.expectedSellPrice != null ? `$${e.expectedSellPrice.toFixed(2)}` : "Đặt giá..."}
                            </button>
                            {e.expectedSellPrice != null && !isSold && (
                              <button
                                onClick={() => quickSellAtExpected(e)}
                                className="opacity-0 group-hover:opacity-100 transition rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900 px-1 py-0.5 text-[10px] font-semibold"
                                title={`Bán @ $${e.expectedSellPrice.toFixed(2)}`}
                              >
                                Bán
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {e.sellPrice != null ? (
                          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                            ${e.sellPrice.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-xs opacity-40">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {profit != null ? (
                          <div>
                            <span className={cn(
                              "text-sm font-semibold whitespace-nowrap",
                              profit > 0 ? "text-emerald-600 dark:text-emerald-400"
                                : profit < 0 ? "text-rose-600 dark:text-rose-400"
                                : "text-muted-foreground"
                            )}>
                              {profit >= 0 ? "+" : ""}${profit.toFixed(2)}
                            </span>
                            {e.purchasePrice != null && e.purchasePrice > 0 && (
                              <p className={cn(
                                "text-[10px]",
                                profit > 0 ? "text-emerald-500" : "text-rose-500"
                              )}>
                                {((profit / e.purchasePrice) * 100).toFixed(0)}% ROI
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs opacity-40">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2"><RatingBadge rating={e.rating} /></td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px]">
                        {e.category || <span className="opacity-40">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <RefList refs={refsByDomain.get(e.domain) ?? []} />
                      </td>
                      <td className="px-3 py-2">
                        <WaybackCell
                          domain={e.domain}
                          row={waybackByDomain.get(e.domain) ?? null}
                          inFlight={inFlightWaybackTargets.has(e.domain)}
                          expanded={expandedWayback.has(e.domain)}
                          onToggleExpand={() => {
                            const next = new Set(expandedWayback);
                            if (next.has(e.domain)) next.delete(e.domain); else next.add(e.domain);
                            setExpandedWayback(next);
                          }}
                          onCheck={() => startWaybackCheck([e.domain])}
                          starting={waybackStarting}
                        />
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(e.purchasedAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => saveEdit(e.domain)}
                                className="text-emerald-600 hover:text-emerald-700"
                                title="Lưu"
                              >
                                <SaveIcon className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingDomain(null)}
                                className="text-muted-foreground hover:text-foreground"
                                title="Hủy"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startEdit(e)}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition"
                                title="Sửa"
                              >
                                <Edit2 className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => removeEntry(e.domain)}
                                className="opacity-0 group-hover:opacity-100 text-destructive hover:opacity-80 transition"
                                title="Xóa"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {wb && wbExpanded && (
                      <tr className="bg-muted/20 border-b border-border/50">
                        <td colSpan={12} className="px-6 py-4">
                          <WaybackDetail row={wb} />
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination footer */}
        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs flex-wrap">
            <div className="text-muted-foreground">
              {pageSize > 0 ? (
                <>
                  Hiển thị <strong>{safePage * pageSize + 1}-{Math.min((safePage + 1) * pageSize, filtered.length)}</strong>
                  {" "}/ {filtered.length.toLocaleString()} domain
                </>
              ) : (
                <>Hiển thị tất cả <strong>{filtered.length.toLocaleString()}</strong> domain</>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Trang:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs cursor-pointer"
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
                <option value="0">Tất cả</option>
              </select>
              {pageSize > 0 && totalPages > 1 && (
                <>
                  <button
                    onClick={() => setPage(0)}
                    disabled={safePage === 0}
                    className="h-7 px-2 rounded-md border border-input hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                    title="Trang đầu"
                  >
                    «
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    className="h-7 px-2 rounded-md border border-input hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                    title="Trang trước"
                  >
                    ‹
                  </button>
                  <span className="px-1 tabular-nums">
                    <strong>{safePage + 1}</strong> / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={safePage >= totalPages - 1}
                    className="h-7 px-2 rounded-md border border-input hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                    title="Trang sau"
                  >
                    ›
                  </button>
                  <button
                    onClick={() => setPage(totalPages - 1)}
                    disabled={safePage >= totalPages - 1}
                    className="h-7 px-2 rounded-md border border-input hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                    title="Trang cuối"
                  >
                    »
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Withdrawals panel */}
      <div className="rounded-xl border bg-card shadow-sm">
        <button
          onClick={() => setWithdrawalListOpen((o) => !o)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-muted/30 transition rounded-xl"
        >
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-purple-600" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">Lịch sử rút tiền</h2>
            <span className="bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 text-xs font-bold px-2 py-0.5 rounded-full">
              {withdrawals.length} lần
            </span>
            {withdrawals.length > 0 && (
              <span className="bg-muted text-muted-foreground text-xs px-2 py-0.5 rounded-full">
                ${withdrawalStats.totalUsdPaid.toFixed(2)} đã nhận
                {withdrawalStats.totalUsdPending > 0 &&
                  ` · $${withdrawalStats.totalUsdPending.toFixed(2)} chờ`}
              </span>
            )}
          </div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", withdrawalListOpen && "rotate-180")} />
        </button>

        {withdrawalListOpen && (
          <div className="border-t px-6 pb-6">
            {withdrawals.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">
                Chưa có lần rút nào. Click <strong>Rút tiền</strong> ở trên để ghi nhận.
              </p>
            ) : (
              <div className="rounded-lg border overflow-hidden mt-4">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Ngày</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Số tiền</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Trạng thái</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Ví nhận tiền</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Ghi chú</th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {withdrawals.map((w) => (
                      <tr key={w.id} className="border-b border-border/30 hover:bg-muted/30 group">
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          {new Date(w.withdrawnAt).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 text-sm font-semibold">
                          {w.currency === "USD" ? "$" : ""}{w.amount.toFixed(2)}
                          {w.currency !== "USD" && <span className="ml-1 text-[10px] text-muted-foreground">{w.currency}</span>}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={w.status}
                            onChange={(e) => updateWithdrawalStatus(w.id, e.target.value as WithdrawalStatus)}
                            className={cn(
                              "h-6 rounded border bg-background px-1.5 text-[11px] cursor-pointer font-medium",
                              w.status === "paid"
                                ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                                : w.status === "progressing"
                                  ? "border-blue-300 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                                  : "border-amber-300 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300"
                            )}
                          >
                            <option value="paid">Đã nhận</option>
                            <option value="progressing">Progressing</option>
                            <option value="under_review">Under Review</option>
                          </select>
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          {w.wallet === "evault" ? (
                            <span className="text-foreground">Ví điện tử</span>
                          ) : w.wallet === "gname" ? (
                            <span className="text-foreground">Gname</span>
                          ) : (
                            <span className="text-muted-foreground opacity-40">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground italic max-w-[300px] truncate" title={w.notes ?? ""}>
                          {w.notes || <span className="opacity-40">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition">
                            <button
                              onClick={() => openEditWithdrawal(w)}
                              className="text-muted-foreground hover:text-primary"
                              title="Sửa"
                            >
                              <Edit2 className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => deleteWithdrawal(w.id)}
                              className="text-destructive hover:opacity-80"
                              title="Xóa"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toasts */}
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
      className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:bg-muted/50 whitespace-nowrap"
    >
      <span className="flex items-center gap-1">
        {label}
        <ArrowUpDown className={cn("h-3 w-3", active ? "text-primary" : "opacity-30")} />
        {active && <span className="text-primary">{dir === -1 ? "↓" : "↑"}</span>}
      </span>
    </th>
  );
}

function RefList({ refs }: { refs: { domain: string; dr: number }[] }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const COLLAPSED = 6;
  const visible = expanded ? refs : refs.slice(0, COLLAPSED);
  const hidden = refs.length - visible.length;

  const copyAll = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!refs.length) return;
    const text = refs.map((r) => r.domain).join("\n");
    try { await navigator.clipboard.writeText(text); }
    catch {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
      document.body.appendChild(el); el.focus(); el.select();
      document.execCommand("copy"); document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!refs.length) return <span className="text-xs text-muted-foreground">—</span>;

  return (
    <div className="flex flex-wrap items-center gap-1 max-w-[420px]">
      <button
        onClick={copyAll}
        className={cn(
          "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition-colors",
          copied
            ? "border-green-300 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300"
            : "border-primary/40 bg-primary/5 hover:bg-primary/10 text-primary"
        )}
        title={`Copy ${refs.length} ref domain`}
      >
        {copied
          ? <><Check className="h-3 w-3" />Đã copy</>
          : <>📋 {refs.length}</>
        }
      </button>
      {visible.map((r) => (
        <a
          key={r.domain}
          href={`https://${r.domain}`}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded border border-border bg-muted/30 hover:bg-muted/60 px-1.5 py-0.5 text-[11px] font-mono text-foreground/90 hover:text-primary transition-colors"
        >
          {r.domain}
          <span className={cn(
            "rounded px-1 text-[10px] font-bold",
            r.dr >= 90 ? "text-emerald-600 dark:text-emerald-400"
            : r.dr >= 70 ? "text-blue-600 dark:text-blue-400"
            : r.dr >= 40 ? "text-yellow-600 dark:text-yellow-400"
            : "text-muted-foreground"
          )}>DR {r.dr}</span>
        </a>
      ))}
      {hidden > 0 && (
        <button onClick={() => setExpanded(true)} className="text-[11px] text-primary hover:underline px-1">
          + {hidden}
        </button>
      )}
      {expanded && refs.length > COLLAPSED && (
        <button onClick={() => setExpanded(false)} className="text-[11px] text-muted-foreground hover:underline px-1">
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

// ─── Wayback cell / detail (re-used by inventory) ──────────────────────────

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

function WaybackCell({
  domain, row, inFlight, expanded, onToggleExpand, onCheck, starting,
}: {
  domain: string;
  row: WaybackRowT | null;
  inFlight: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onCheck: () => void;
  starting: boolean;
}) {
  if (!row && !inFlight) {
    return (
      <button
        onClick={onCheck}
        disabled={starting}
        className="text-[11px] text-purple-700 hover:text-purple-900 dark:text-purple-300 dark:hover:text-purple-100 hover:underline disabled:opacity-50 whitespace-nowrap"
        title={`Check Wayback cho ${domain}`}
      >
        🕰️ Check
      </button>
    );
  }
  if (inFlight && !row) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-blue-700 dark:text-blue-300 whitespace-nowrap">
        <Loader2 className="h-3 w-3 animate-spin" />
        Đang chạy
      </span>
    );
  }
  if (!row) return null;
  if (row.errorReason) {
    return (
      <span className="text-[11px] text-amber-700 dark:text-amber-300 whitespace-nowrap" title={row.errorReason}>
        ⚠️ {row.errorReason.slice(0, 18)}
      </span>
    );
  }
  const flagged = row.hasBetting || row.hasAdult;
  return (
    <button
      onClick={onToggleExpand}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap hover:opacity-80 cursor-pointer",
        flagged
          ? "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-300"
          : "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300"
      )}
      title={`${row.snapshotCount} snapshots · age ${row.domainAge}y · ${flagged ? "flagged" : "clean"} · click để xem chi tiết`}
    >
      {flagged ? (
        <>{row.hasBetting && "🎰"}{row.hasAdult && "🔞"} Flagged</>
      ) : (
        <>✓ {row.snapshotCount} · {row.domainAge}y</>
      )}
      <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
    </button>
  );
}

function WaybackDetail({ row }: { row: WaybackRowT }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap gap-3 items-center">
        <span className="font-semibold">🕰️ {row.targetDomain}</span>
        <span className="text-muted-foreground">{row.snapshotCount} snapshots · {row.firstYear}–{row.lastYear} · age {row.domainAge}y</span>
        <span className="text-muted-foreground">checked {new Date(row.checkedAt).toLocaleString()}</span>
      </div>
      {row.problematicSnapshots.length > 0 && (
        <div>
          <h4 className="font-semibold text-red-700 dark:text-red-300 mb-2">🚨 Problematic snapshots ({row.problematicSnapshots.length})</h4>
          <div className="space-y-2">
            {row.problematicSnapshots.map((s, i) => (
              <div key={i} className="rounded border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/30 p-2">
                <div className="flex gap-2 items-center mb-1 flex-wrap">
                  <span className="font-mono">{s.timestamp?.slice(0, 8)}</span>
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
      {row.contentHistory.length === 0 && row.problematicSnapshots.length === 0 && !row.errorReason && (
        <p className="text-muted-foreground italic">Không có content history.</p>
      )}
    </div>
  );
}
