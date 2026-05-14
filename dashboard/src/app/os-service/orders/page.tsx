"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ShoppingCart,
  Plus,
  Trash2,
  X,
  Edit2,
  Copy,
  Save as SaveIcon,
  Loader2,
  Search,
  AlertCircle,
  Wallet,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Partner } from "@/lib/os-partners-db";
import type { Order, OrderCurrency } from "@/lib/os-orders-db";
import { ORDER_CURRENCIES } from "@/lib/os-orders-db";
import type { OsWithdrawal } from "@/lib/os-withdrawal-db";

// Locale: en-US convention — "," thousand separator, "." decimal
function formatMoney(amount: number, currency: OrderCurrency): string {
  const f2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f0 = (n: number) => Math.round(n).toLocaleString("en-US");
  if (currency === "USD") return `$${f2(amount)}`;
  if (currency === "VND") return `${f0(amount)} ₫`;
  if (currency === "USDT") return `${f2(amount)} USDT`;
  return `${amount} ${currency}`;
}

// Live-format raw input: insert "," every 3 digits in integer part, allow trailing decimals
function formatNumberDisplay(raw: string): string {
  if (!raw) return "";
  // Keep digits and at most one dot
  const stripped = raw.replace(/,/g, "").replace(/[^\d.]/g, "");
  const firstDot = stripped.indexOf(".");
  const cleaned = firstDot >= 0
    ? stripped.slice(0, firstDot + 1) + stripped.slice(firstDot + 1).replace(/\./g, "")
    : stripped;
  const dotIdx = cleaned.indexOf(".");
  const intStr = dotIdx >= 0 ? cleaned.slice(0, dotIdx) : cleaned;
  const decPart = dotIdx >= 0 ? cleaned.slice(dotIdx) : "";
  if (intStr === "") return decPart; // user typed "." first
  const intNum = parseInt(intStr, 10);
  if (isNaN(intNum)) return "";
  return intNum.toLocaleString("en-US") + decPart;
}

function parseFormattedNumber(s: string): number {
  if (!s) return NaN;
  return parseFloat(s.replace(/,/g, ""));
}

interface ToastItem { id: number; message: string; isError: boolean }

function equalSplits(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(10000 / n) / 100; // e.g. 33.33
  const splits = Array(n).fill(base);
  // Adjust last to make sum = 100
  const remainder = +(100 - base * n).toFixed(2);
  splits[n - 1] = +(splits[n - 1] + remainder).toFixed(2);
  return splits;
}

type DateRangePreset = "today" | "7d" | "30d" | "thisMonth" | "lastMonth" | "thisYear" | "all" | "custom";

export default function OrdersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Date range filter (scopes stats + tables)
  const [datePreset, setDatePreset] = useState<DateRangePreset>("all");
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");

  // Form
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [oPartnerId, setOPartnerId] = useState<string>("");
  const [oPackage, setOPackage] = useState("");
  const [oPrice, setOPrice] = useState("");
  const [oCurrency, setOCurrency] = useState<OrderCurrency>("USD");
  const [oPaymentCount, setOPaymentCount] = useState(1);
  const [oSplits, setOSplits] = useState<string[]>(["100"]);
  const [oNotes, setONotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Withdrawals (scoped to a specific order)
  const [withdrawals, setWithdrawals] = useState<OsWithdrawal[]>([]);
  const [wFormOpen, setWFormOpen] = useState(false);
  const [wEditingId, setWEditingId] = useState<string | null>(null);
  const [wOrderId, setWOrderId] = useState<string>("");
  const [wInstallment, setWInstallment] = useState<number | null>(null); // 1-based, null = ad-hoc
  const [wDate, setWDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [wAmount, setWAmount] = useState("");
  const [wNotes, setWNotes] = useState("");
  const [wSaving, setWSaving] = useState(false);
  const [wListOpen, setWListOpen] = useState(false);

  // Toasts
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((msg: string, isError = false) => {
    const id = ++toastIdRef.current;
    setToasts((p) => [...p, { id, message: msg, isError }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, oRes, wRes] = await Promise.all([
        fetch("/api/os-partners"),
        fetch("/api/os-orders"),
        fetch("/api/os-withdrawals"),
      ]);
      const pData = await pRes.json();
      const oData = await oRes.json();
      const wData = await wRes.json();
      setPartners(Array.isArray(pData) ? pData : []);
      setOrders(Array.isArray(oData) ? oData : []);
      setWithdrawals(Array.isArray(wData) ? wData : []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const partnerById = useMemo(() => {
    const m = new Map<string, Partner>();
    for (const p of partners) m.set(p.id, p);
    return m;
  }, [partners]);

  // Resolve date range: returns {start, end} as epoch ms (null = unbounded)
  const dateRange = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayMs = 86400000;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();
    const startOfNextYear = new Date(now.getFullYear() + 1, 0, 1).getTime();
    switch (datePreset) {
      case "all": return { start: null as number | null, end: null as number | null };
      case "today": return { start: today, end: today + dayMs - 1 };
      case "7d": return { start: today - 6 * dayMs, end: today + dayMs - 1 };
      case "30d": return { start: today - 29 * dayMs, end: today + dayMs - 1 };
      case "thisMonth": return { start: startOfMonth, end: startOfNextMonth - 1 };
      case "lastMonth": return { start: startOfLastMonth, end: startOfMonth - 1 };
      case "thisYear": return { start: startOfYear, end: startOfNextYear - 1 };
      case "custom": return {
        start: dateStart ? new Date(dateStart + "T00:00:00").getTime() : null,
        end: dateEnd ? new Date(dateEnd + "T23:59:59.999").getTime() : null,
      };
    }
  }, [datePreset, dateStart, dateEnd]);

  const inRange = useCallback((isoDate: string): boolean => {
    if (!dateRange.start && !dateRange.end) return true;
    const t = new Date(isoDate).getTime();
    if (dateRange.start != null && t < dateRange.start) return false;
    if (dateRange.end != null && t > dateRange.end) return false;
    return true;
  }, [dateRange]);

  // Orders/withdrawals filtered by date range (used by stats + tables)
  const ordersInRange = useMemo(
    () => orders.filter((o) => inRange(o.createdAt)),
    [orders, inRange]
  );
  const withdrawalsInRange = useMemo(
    () => withdrawals.filter((w) => inRange(w.withdrawnAt)),
    [withdrawals, inRange]
  );

  // Search applies on top of date filter
  const filtered = useMemo(
    () => ordersInRange.filter((o) => {
      if (!search) return true;
      const q = search.toLowerCase();
      const partnerName = (o.partnerId && partnerById.get(o.partnerId)?.name) || "";
      return o.packageName.toLowerCase().includes(q) || partnerName.toLowerCase().includes(q);
    }),
    [ordersInRange, search, partnerById]
  );

  // Auto-compute revenue from selected partner's discount — không cho user override.
  // Giá đổi → Doanh thu đổi theo % đối tác.
  const selectedPartner = oPartnerId ? partnerById.get(oPartnerId) : null;
  const computedRevenue = selectedPartner && oPrice
    ? +(((parseFormattedNumber(oPrice) || 0) * (selectedPartner.discountPercent / 100))).toFixed(2)
    : 0;
  const effectiveRevenue = computedRevenue;

  const splitsSum = oSplits.reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const splitsValid = Math.abs(splitsSum - 100) < 0.01;

  const openCreateForm = () => {
    setEditingId(null);
    setOPartnerId(partners[0]?.id ?? "");
    setOPackage("");
    setOPrice("");
    setOCurrency("USD");
    setOPaymentCount(1);
    setOSplits(["100"]);
    setONotes("");
    setFormOpen(true);
  };

  const openEditForm = (o: Order) => {
    setEditingId(o.id);
    setOPartnerId(o.partnerId ?? "");
    setOPackage(o.packageName);
    setOPrice(formatNumberDisplay(String(o.price)));
    setOCurrency(o.currency);
    setOPaymentCount(o.paymentCount);
    setOSplits(o.paymentSplits.map(String));
    setONotes(o.notes ?? "");
    setFormOpen(true);
  };

  // Clone: tạo đơn hàng mới từ template của đơn cũ — không gắn editingId nên Save sẽ POST
  const openCloneForm = (o: Order) => {
    setEditingId(null);
    setOPartnerId(o.partnerId ?? "");
    setOPackage(`${o.packageName} (copy)`);
    setOPrice(formatNumberDisplay(String(o.price)));
    setOCurrency(o.currency);
    setOPaymentCount(o.paymentCount);
    setOSplits(o.paymentSplits.map(String));
    setONotes(o.notes ?? "");
    setFormOpen(true);
  };

  const updatePaymentCount = (n: number) => {
    if (n < 1) return;
    setOPaymentCount(n);
    setOSplits(equalSplits(n).map(String));
  };

  const updateSplit = (idx: number, v: string) => {
    const next = [...oSplits];
    next[idx] = v;
    setOSplits(next);
  };

  const save = useCallback(async () => {
    const price = parseFormattedNumber(oPrice);
    if (!oPackage.trim() || isNaN(price)) {
      showToast("❌ Cần nhập tên gói và giá tiền", true);
      return;
    }
    const splits = oSplits.map((s) => parseFloat(s) || 0);
    if (Math.abs(splits.reduce((a, b) => a + b, 0) - 100) > 0.01) {
      showToast("❌ Tổng % thanh toán phải = 100", true);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        partnerId: oPartnerId || null,
        packageName: oPackage.trim(),
        price,
        revenue: effectiveRevenue,
        currency: oCurrency,
        paymentSplits: splits,
        notes: oNotes.trim() || null,
      };
      if (editingId) {
        const res = await fetch(`/api/os-orders/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Lỗi");
        setOrders((prev) => prev.map((o) => o.id === editingId ? {
          ...o,
          partnerId: payload.partnerId,
          packageName: payload.packageName,
          price: payload.price,
          revenue: payload.revenue,
          currency: payload.currency,
          paymentCount: payload.paymentSplits.length,
          paymentSplits: payload.paymentSplits,
          notes: payload.notes,
        } : o));
        showToast("✅ Đã cập nhật");
      } else {
        const res = await fetch("/api/os-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Lỗi");
        setOrders((prev) => [data.entry, ...prev]);
        showToast(`✅ Đã thêm đơn hàng`);
      }
      setFormOpen(false);
      setEditingId(null);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setSaving(false);
    }
  }, [oPackage, oPrice, oSplits, oPartnerId, effectiveRevenue, oCurrency, oNotes, editingId, showToast]);

  const remove = useCallback(async (o: Order) => {
    if (!confirm(`Xóa đơn hàng "${o.packageName}"?`)) return;
    try {
      await fetch(`/api/os-orders/${o.id}`, { method: "DELETE" });
      setOrders((prev) => prev.filter((x) => x.id !== o.id));
      showToast("🗑️ Đã xóa");
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    }
  }, [showToast]);

  // ─── Withdrawals ─────────────────────────────────────────────────────────────

  const openWithdrawalForm = useCallback((orderId: string) => {
    setWEditingId(null);
    setWOrderId(orderId);
    setWInstallment(null);
    setWDate(new Date().toISOString().slice(0, 10));
    setWAmount("");
    setWNotes("");
    setWFormOpen(true);
  }, []);

  const openEditWithdrawal = useCallback((w: OsWithdrawal) => {
    setWEditingId(w.id);
    setWOrderId(w.orderId ?? "");
    setWInstallment(w.installment ?? null);
    setWDate(new Date(w.withdrawnAt).toISOString().slice(0, 10));
    setWAmount(formatNumberDisplay(String(w.amount)));
    setWNotes(w.notes ?? "");
    setWFormOpen(true);
  }, []);

  const saveWithdrawal = useCallback(async () => {
    const amount = parseFormattedNumber(wAmount);
    if (!wDate || isNaN(amount) || amount <= 0 || !wOrderId) {
      showToast("❌ Thiếu đơn hàng / ngày / số tiền hợp lệ", true);
      return;
    }
    setWSaving(true);
    try {
      if (wEditingId) {
        // Edit mutable fields (date, amount, installment, notes); order/currency locked
        const payload = {
          withdrawnAt: new Date(wDate + "T00:00:00").toISOString(),
          amount,
          installment: wInstallment,
          notes: wNotes.trim() || null,
        };
        const res = await fetch(`/api/os-withdrawals/${wEditingId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Lỗi");
        const id = wEditingId;
        setWithdrawals((prev) => prev.map((w) => w.id === id ? { ...w, ...payload } : w));
        showToast("✅ Đã cập nhật");
      } else {
        const res = await fetch("/api/os-withdrawals", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: wOrderId,
            installment: wInstallment,
            withdrawnAt: new Date(wDate + "T00:00:00").toISOString(),
            amount,
            notes: wNotes.trim() || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Lỗi");
        setWithdrawals((prev) => [data.entry, ...prev]);
        const order = orders.find((o) => o.id === wOrderId);
        showToast(`✅ Đã rút ${formatMoney(amount, order?.currency ?? "USD")}`);
      }
      setWFormOpen(false);
      setWEditingId(null);
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    } finally {
      setWSaving(false);
    }
  }, [wDate, wAmount, wNotes, wOrderId, wInstallment, wEditingId, orders, showToast]);

  const deleteWithdrawal = useCallback(async (id: string) => {
    if (!confirm("Xóa lần rút này?")) return;
    try {
      await fetch(`/api/os-withdrawals/${id}`, { method: "DELETE" });
      setWithdrawals((prev) => prev.filter((w) => w.id !== id));
      showToast("🗑️ Đã xóa");
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : "Lỗi"}`, true);
    }
  }, [showToast]);

  // Per-order withdrawn map (date-filtered): orderId → total amount withdrawn in range
  const withdrawnByOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of withdrawalsInRange) {
      if (!w.orderId) continue;
      m.set(w.orderId, (m.get(w.orderId) ?? 0) + w.amount);
    }
    return m;
  }, [withdrawalsInRange]);

  // Per-installment withdrawn map (all-time, used to flag "đã rút" trong form)
  const withdrawnByInstallment = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of withdrawals) {
      if (!w.orderId || w.installment == null) continue;
      const k = `${w.orderId}|${w.installment}`;
      m.set(k, (m.get(k) ?? 0) + w.amount);
    }
    return m;
  }, [withdrawals]);

  // Quick lookup: order by id
  const orderById = useMemo(() => {
    const m = new Map<string, Order>();
    for (const o of orders) m.set(o.id, o);
    return m;
  }, [orders]);

  // Effective revenue per order = Giá × % đối tác (auto-computed).
  // Override mọi giá trị `o.revenue` cũ trong DB để UI nhất quán với form.
  const revenueByOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders) {
      const partner = o.partnerId ? partnerById.get(o.partnerId) : null;
      const computed = partner
        ? +((o.price * partner.discountPercent) / 100).toFixed(2)
        : o.revenue;
      m.set(o.id, computed);
    }
    return m;
  }, [orders, partnerById]);

  // Stats grouped by currency, scoped to date range (mixing currencies is misleading)
  const totals = useMemo(() => {
    const byCurrency: Record<string, { price: number; revenue: number; withdrawn: number; remaining: number }> = {};
    for (const o of ordersInRange) {
      if (!byCurrency[o.currency]) byCurrency[o.currency] = { price: 0, revenue: 0, withdrawn: 0, remaining: 0 };
      byCurrency[o.currency].price += o.price;
      byCurrency[o.currency].revenue += revenueByOrder.get(o.id) ?? o.revenue;
    }
    for (const w of withdrawalsInRange) {
      if (!byCurrency[w.currency]) byCurrency[w.currency] = { price: 0, revenue: 0, withdrawn: 0, remaining: 0 };
      byCurrency[w.currency].withdrawn += w.amount;
    }
    for (const cur of Object.keys(byCurrency)) {
      byCurrency[cur].remaining = byCurrency[cur].revenue - byCurrency[cur].withdrawn;
    }
    return byCurrency;
  }, [ordersInRange, withdrawalsInRange, revenueByOrder]);

  const totalEntries = useMemo(
    () => Object.entries(totals) as [OrderCurrency, { price: number; revenue: number; withdrawn: number; remaining: number }][],
    [totals]
  );

  // Per-installment breakdown: for each installment number (1, 2, 3...) and currency,
  // compute revenue (= order.revenue × split%), withdrawn (sum of installment-tagged
  // withdrawals), remaining. Ad-hoc withdrawals (installment === null) are surfaced
  // separately so totals stay reconcilable with the overall "Đã rút" card.
  const installmentBreakdown = useMemo(() => {
    let maxI = 0;
    const byInstallment: Record<number, Record<string, { revenue: number; withdrawn: number; remaining: number }>> = {};
    const adhocByCurrency: Record<string, number> = {};

    const ensure = (i: number, cur: string) => {
      if (!byInstallment[i]) byInstallment[i] = {};
      if (!byInstallment[i][cur]) byInstallment[i][cur] = { revenue: 0, withdrawn: 0, remaining: 0 };
      return byInstallment[i][cur];
    };

    for (const o of ordersInRange) {
      if (o.paymentCount > maxI) maxI = o.paymentCount;
      const totalRev = revenueByOrder.get(o.id) ?? o.revenue;
      for (let idx = 0; idx < o.paymentSplits.length; idx++) {
        const pct = o.paymentSplits[idx] ?? 0;
        ensure(idx + 1, o.currency).revenue += +(totalRev * pct / 100);
      }
    }
    for (const w of withdrawalsInRange) {
      if (w.installment == null) {
        adhocByCurrency[w.currency] = (adhocByCurrency[w.currency] ?? 0) + w.amount;
        continue;
      }
      if (w.installment > maxI) maxI = w.installment;
      ensure(w.installment, w.currency).withdrawn += w.amount;
    }
    for (const i of Object.keys(byInstallment).map(Number)) {
      for (const cur of Object.keys(byInstallment[i])) {
        const t = byInstallment[i][cur];
        t.remaining = +(t.revenue - t.withdrawn).toFixed(2);
        t.revenue = +t.revenue.toFixed(2);
        t.withdrawn = +t.withdrawn.toFixed(2);
      }
    }
    return { byInstallment, maxInstallment: maxI, adhocByCurrency };
  }, [ordersInRange, withdrawalsInRange, revenueByOrder]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Danh sách đơn hàng</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Đơn hàng dịch vụ với phân chia % thanh toán theo từng đợt.
          </p>
        </div>
        <Button onClick={openCreateForm} size="sm" className="gap-2" disabled={partners.length === 0}>
          <Plus className="h-4 w-4" />
          Thêm đơn hàng
        </Button>
      </div>

      {/* Date range filter */}
      <div className="rounded-lg border bg-card p-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-muted-foreground uppercase mr-1">📅 Khoảng thời gian:</span>
        {([
          { key: "today", label: "Hôm nay" },
          { key: "7d", label: "7 ngày" },
          { key: "30d", label: "30 ngày" },
          { key: "thisMonth", label: "Tháng này" },
          { key: "lastMonth", label: "Tháng trước" },
          { key: "thisYear", label: "Năm nay" },
          { key: "all", label: "Tất cả" },
          { key: "custom", label: "Tùy chỉnh" },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setDatePreset(key)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition",
              datePreset === key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:border-primary/50 hover:bg-muted/30",
            )}
          >
            {label}
          </button>
        ))}
        {datePreset === "custom" && (
          <div className="flex items-center gap-1.5 ml-1">
            <Input
              type="date"
              value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
              className="h-7 text-xs w-36"
            />
            <span className="text-muted-foreground text-xs">→</span>
            <Input
              type="date"
              value={dateEnd}
              onChange={(e) => setDateEnd(e.target.value)}
              className="h-7 text-xs w-36"
            />
          </div>
        )}
        {dateRange.start != null || dateRange.end != null ? (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {dateRange.start ? new Date(dateRange.start).toLocaleDateString() : "..."}
            {" → "}
            {dateRange.end ? new Date(dateRange.end).toLocaleDateString() : "..."}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground ml-auto">Toàn bộ dữ liệu</span>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase">Tổng đơn</p>
          <p className="text-2xl font-bold">{ordersInRange.length}</p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase">Tổng giá trị</p>
          {totalEntries.length === 0 ? (
            <p className="text-2xl font-bold">—</p>
          ) : (
            <div className="space-y-1.5 mt-1">
              {totalEntries.map(([cur, t]) => (
                <p key={cur} className="text-lg font-bold leading-snug">{formatMoney(t.price, cur)}</p>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase">Doanh thu</p>
          {totalEntries.length === 0 ? (
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">—</p>
          ) : (
            <div className="space-y-1.5 mt-1">
              {totalEntries.map(([cur, t]) => (
                <p key={cur} className="text-lg font-bold leading-snug text-emerald-600 dark:text-emerald-400">
                  {formatMoney(t.revenue, cur)}
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase">Đã rút</p>
          {totalEntries.length === 0 || totalEntries.every(([, t]) => t.withdrawn === 0) ? (
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">—</p>
          ) : (
            <div className="space-y-1.5 mt-1">
              {totalEntries.filter(([, t]) => t.withdrawn > 0).map(([cur, t]) => (
                <p key={cur} className="text-lg font-bold leading-snug text-purple-600 dark:text-purple-400">
                  {formatMoney(t.withdrawn, cur)}
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase">Còn lại</p>
          {totalEntries.length === 0 ? (
            <p className="text-2xl font-bold">—</p>
          ) : (
            <div className="space-y-1.5 mt-1">
              {totalEntries.map(([cur, t]) => (
                <p key={cur} className={cn(
                  "text-lg font-bold leading-snug",
                  t.remaining > 0 ? "text-blue-600 dark:text-blue-400"
                  : t.remaining < 0 ? "text-rose-600 dark:text-rose-400"
                  : "text-muted-foreground"
                )}>
                  {formatMoney(t.remaining, cur)}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Per-installment breakdown */}
      {installmentBreakdown.maxInstallment > 0 && totalEntries.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-3">
            Phân tích theo đợt thanh toán
          </p>
          <div className="space-y-4">
            {totalEntries.map(([cur]) => {
              const rows: { i: number; revenue: number; withdrawn: number; remaining: number }[] = [];
              for (let i = 1; i <= installmentBreakdown.maxInstallment; i++) {
                const t = installmentBreakdown.byInstallment[i]?.[cur];
                if (!t) continue;
                if (t.revenue === 0 && t.withdrawn === 0) continue;
                rows.push({ i, ...t });
              }
              const adhoc = installmentBreakdown.adhocByCurrency[cur] ?? 0;
              if (rows.length === 0 && adhoc === 0) return null;
              return (
                <div key={cur}>
                  <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">{cur}</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase text-muted-foreground">
                          <th className="font-medium py-1 pr-3">Đợt</th>
                          <th className="font-medium py-1 pr-3 text-right">Doanh thu</th>
                          <th className="font-medium py-1 pr-3 text-right">Đã rút</th>
                          <th className="font-medium py-1 text-right">Còn lại</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.i} className="border-t border-border/40">
                            <td className="py-1.5 pr-3 font-medium">Đợt {r.i}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                              {formatMoney(r.revenue, cur as OrderCurrency)}
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular-nums text-purple-600 dark:text-purple-400">
                              {r.withdrawn > 0 ? formatMoney(r.withdrawn, cur as OrderCurrency) : "—"}
                            </td>
                            <td className={cn(
                              "py-1.5 text-right tabular-nums font-medium",
                              r.remaining > 0 ? "text-blue-600 dark:text-blue-400"
                              : r.remaining < 0 ? "text-rose-600 dark:text-rose-400"
                              : "text-muted-foreground"
                            )}>
                              {formatMoney(r.remaining, cur as OrderCurrency)}
                            </td>
                          </tr>
                        ))}
                        {adhoc > 0 && (
                          <tr className="border-t border-border/40">
                            <td className="py-1.5 pr-3 text-muted-foreground italic">Không gắn đợt</td>
                            <td className="py-1.5 pr-3 text-right text-muted-foreground">—</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums text-purple-600 dark:text-purple-400">
                              {formatMoney(adhoc, cur as OrderCurrency)}
                            </td>
                            <td className="py-1.5 text-right text-muted-foreground">—</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {partners.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Chưa có đối tác. Vào <strong>Danh sách đối tác</strong> để thêm trước khi tạo đơn.</span>
        </div>
      )}

      {/* Form */}
      {formOpen && (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-primary" />
              {editingId ? "Sửa đơn hàng" : "Thêm đơn hàng"}
            </h3>
            <button onClick={() => { setFormOpen(false); setEditingId(null); }} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Đối tác *</label>
              <select
                value={oPartnerId}
                onChange={(e) => setOPartnerId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm cursor-pointer"
              >
                <option value="">— Chọn đối tác —</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.discountPercent}%)</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Tên gói dịch vụ *</label>
              <Input value={oPackage} onChange={(e) => setOPackage(e.target.value)} placeholder="vd: SEO Pro 2026" />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Đơn vị *</label>
              <select
                value={oCurrency}
                onChange={(e) => setOCurrency(e.target.value as OrderCurrency)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm cursor-pointer"
              >
                {ORDER_CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Giá tiền *</label>
              <Input
                type="text"
                inputMode="decimal"
                value={oPrice}
                onChange={(e) => setOPrice(formatNumberDisplay(e.target.value))}
                placeholder="0"
                className="font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Doanh thu
                {selectedPartner && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    (auto = giá × {selectedPartner.discountPercent}%)
                  </span>
                )}
              </label>
              <Input
                type="text"
                disabled
                value={formatNumberDisplay(String(computedRevenue))}
                placeholder="0"
                className="font-mono bg-muted/40 text-emerald-600 dark:text-emerald-400 font-semibold"
                title="Tự tính từ Giá × % đối tác — không sửa được"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Số lần thanh toán</label>
              <Input
                type="number"
                min="1"
                max="12"
                value={oPaymentCount}
                onChange={(e) => updatePaymentCount(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>
          </div>

          {/* Payment splits */}
          <div className="mb-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold">% thanh toán mỗi đợt</p>
              <span className={cn(
                "text-xs font-mono",
                splitsValid ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
              )}>
                Tổng: {splitsSum.toFixed(2)}% {splitsValid ? "✓" : "(cần = 100)"}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {oSplits.map((s, i) => {
                const pct = parseFloat(s) || 0;
                const priceNum = parseFormattedNumber(oPrice) || 0;
                const installmentRev = +(priceNum * pct / 100).toFixed(2);
                return (
                  <div key={i} className="space-y-1">
                    <label className="block text-[10px] uppercase text-muted-foreground">
                      Đợt {i + 1}
                    </label>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        step="0.01"
                        value={s}
                        onChange={(e) => updateSplit(i, e.target.value)}
                        className="h-8 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">
                      = {formatMoney(installmentRev, oCurrency)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Ghi chú</label>
            <textarea
              value={oNotes}
              onChange={(e) => setONotes(e.target.value)}
              placeholder="Paste danh sách domain hoặc ghi chú khác..."
              rows={6}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground placeholder:font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
            />
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving || !splitsValid} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SaveIcon className="h-3.5 w-3.5" />}
              {saving ? "Đang lưu..." : (editingId ? "Cập nhật" : "Lưu")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setFormOpen(false); setEditingId(null); }}>Hủy</Button>
          </div>
        </div>
      )}

      {/* Withdrawal form (scoped to a specific order) */}
      {wFormOpen && (() => {
        const order = orderById.get(wOrderId);
        const partner = order?.partnerId ? partnerById.get(order.partnerId) : null;
        const totalRevenue = order ? (revenueByOrder.get(order.id) ?? order.revenue) : 0;
        const alreadyWithdrawn = (withdrawnByOrder.get(wOrderId) ?? 0)
          - (wEditingId ? (withdrawals.find((w) => w.id === wEditingId)?.amount ?? 0) : 0);
        const remainingBefore = totalRevenue - alreadyWithdrawn;
        const enteredAmount = parseFormattedNumber(wAmount) || 0;
        const remainingAfter = remainingBefore - enteredAmount;
        return (
          <div className="rounded-xl border border-purple-300 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-950/30 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Wallet className="h-4 w-4 text-purple-600" />
                {wEditingId ? "Sửa lần rút" : "Rút doanh thu từ đơn hàng"}
              </h3>
              <button onClick={() => { setWFormOpen(false); setWEditingId(null); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Order context (read-only) */}
            {order ? (
              <div className="mb-4 rounded-lg border border-purple-200 dark:border-purple-800 bg-background/50 px-3 py-2 text-xs space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-muted-foreground">Đơn:</span>
                  <span className="font-semibold">{order.packageName}</span>
                  {partner && <span className="text-muted-foreground">· {partner.name} ({partner.discountPercent}%)</span>}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">Doanh thu</p>
                    <p className="font-semibold text-emerald-600 dark:text-emerald-400">{formatMoney(totalRevenue, order.currency)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">Đã rút</p>
                    <p className="font-semibold text-purple-600 dark:text-purple-400">{formatMoney(alreadyWithdrawn, order.currency)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">Còn lại {enteredAmount > 0 && "(sau lần này)"}</p>
                    <p className={cn(
                      "font-semibold",
                      remainingAfter < 0 ? "text-rose-600 dark:text-rose-400"
                      : remainingAfter === 0 ? "text-muted-foreground"
                      : "text-blue-600 dark:text-blue-400"
                    )}>
                      {formatMoney(remainingAfter, order.currency)}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mb-4 text-xs text-rose-600">Đơn hàng không tồn tại</div>
            )}

            {/* Quick-pick by installment */}
            {order && order.paymentSplits.length > 0 && (
              <div className="mb-4 rounded-lg border border-purple-200 dark:border-purple-800 bg-background/30 px-3 py-2.5">
                <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-2">Chọn đợt rút (auto-fill số tiền = Doanh thu × % đợt)</p>
                <div className="flex flex-wrap gap-2">
                  {order.paymentSplits.map((pct, i) => {
                    const idx = i + 1;
                    const installmentRevenue = +(totalRevenue * pct / 100).toFixed(2);
                    const installmentPaid = withdrawnByInstallment.get(`${order.id}|${idx}`) ?? 0;
                    const isPaid = installmentPaid > 0;
                    const isSelected = wInstallment === idx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setWInstallment(idx);
                          setWAmount(formatNumberDisplay(String(installmentRevenue)));
                        }}
                        className={cn(
                          "flex flex-col items-start rounded-lg border px-3 py-1.5 text-xs transition",
                          isSelected
                            ? "border-purple-600 bg-purple-100 dark:bg-purple-900/50 ring-2 ring-purple-400"
                            : "border-border bg-background hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/30",
                        )}
                      >
                        <span className="flex items-center gap-1 font-semibold">
                          Đợt {idx} ({pct}%)
                          {isPaid && <span className="text-[9px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-400 px-1 py-0.5 rounded">đã rút</span>}
                        </span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[11px]">
                          {formatMoney(installmentRevenue, order.currency)}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setWInstallment(null)}
                    className={cn(
                      "flex flex-col items-start rounded-lg border px-3 py-1.5 text-xs transition",
                      wInstallment === null
                        ? "border-amber-500 bg-amber-50 dark:bg-amber-950/40 ring-2 ring-amber-300"
                        : "border-border bg-background hover:border-amber-400",
                    )}
                  >
                    <span className="font-semibold">Tùy chỉnh</span>
                    <span className="text-muted-foreground text-[11px]">không gắn đợt</span>
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Ngày</label>
                <Input type="date" value={wDate} onChange={(e) => setWDate(e.target.value)} className="h-8 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Số tiền {order && <span className="text-muted-foreground">({order.currency})</span>}
                </label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={wAmount}
                  onChange={(e) => setWAmount(formatNumberDisplay(e.target.value))}
                  placeholder="0"
                  className="h-8 text-sm font-mono"
                />
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Ghi chú (optional)</label>
              <Input value={wNotes} onChange={(e) => setWNotes(e.target.value)} placeholder="vd: chuyển khoản bank ACB" className="h-8 text-sm" />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={saveWithdrawal}
                disabled={wSaving}
                className="gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
              >
                {wSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SaveIcon className="h-3.5 w-3.5" />}
                {wSaving ? "Đang lưu..." : (wEditingId ? "Cập nhật" : "Lưu")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setWFormOpen(false); setWEditingId(null); }}>Hủy</Button>
            </div>
          </div>
        );
      })()}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Tìm gói hoặc đối tác..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        {loading ? (
          <p className="text-center py-12 text-muted-foreground text-sm">Đang tải...</p>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <ShoppingCart className="h-8 w-8 opacity-40" />
            <p className="text-sm">Chưa có đơn hàng</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <ShoppingCart className="h-8 w-8 opacity-40" />
            <p className="text-sm">Không có đơn hàng nào trong khoảng thời gian / tìm kiếm đã chọn</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Đối tác</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Gói dịch vụ</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Giá</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Doanh thu</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Thanh toán</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Ngày tạo</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => {
                  const partner = o.partnerId ? partnerById.get(o.partnerId) : null;
                  const revenue = revenueByOrder.get(o.id) ?? o.revenue;
                  return (
                    <tr key={o.id} className="border-b border-border/50 hover:bg-muted/20 group align-top">
                      <td className="px-3 py-2 text-sm">
                        {partner ? (
                          <div>
                            <p className="font-medium">{partner.name}</p>
                            <p className="text-[10px] text-muted-foreground">{partner.discountPercent}% chiết khấu</p>
                          </div>
                        ) : <span className="opacity-40 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium">{o.packageName}</p>
                        {o.notes && (
                          <details className="mt-1">
                            <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground select-none">
                              Ghi chú
                            </summary>
                            <pre className="mt-1 text-[11px] font-mono text-muted-foreground leading-snug max-w-[400px] whitespace-pre-wrap break-all">
{o.notes}
                            </pre>
                          </details>
                        )}
                      </td>
                      <td className="px-3 py-2 font-semibold whitespace-nowrap">{formatMoney(o.price, o.currency)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <p className="font-semibold text-emerald-600 dark:text-emerald-400">{formatMoney(revenue, o.currency)}</p>
                        {(() => {
                          const w = withdrawnByOrder.get(o.id) ?? 0;
                          const remaining = revenue - w;
                          if (w === 0) return (
                            <p className="text-[10px] text-muted-foreground italic mt-0.5">chưa rút</p>
                          );
                          return (
                            <>
                              <p className="text-[10px] text-purple-600 dark:text-purple-400 mt-0.5">
                                Đã rút: {formatMoney(w, o.currency)}
                              </p>
                              <p className={cn(
                                "text-[10px]",
                                remaining > 0 ? "text-blue-600 dark:text-blue-400"
                                : remaining < 0 ? "text-rose-600 dark:text-rose-400"
                                : "text-muted-foreground"
                              )}>
                                Còn: {formatMoney(remaining, o.currency)}
                              </p>
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-xs font-medium">{o.paymentCount} đợt</p>
                        <div className="flex flex-wrap gap-1 mt-1 max-w-[320px]">
                          {o.paymentSplits.map((pct, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px]"
                              title={`Đợt ${i + 1}: ${pct}% = ${formatMoney(o.price * pct / 100, o.currency)}`}
                            >
                              {pct}% ({formatMoney(o.price * pct / 100, o.currency)})
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(o.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openWithdrawalForm(o.id)}
                            className="rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900 px-1.5 py-0.5 text-[10px] font-semibold inline-flex items-center gap-1"
                            title="Rút doanh thu từ đơn này"
                          >
                            <Wallet className="h-2.5 w-2.5" />
                            Rút
                          </button>
                          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition">
                            <button onClick={() => openCloneForm(o)} className="text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400" title="Clone — tạo đơn tương tự">
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => openEditForm(o)} className="text-muted-foreground hover:text-primary" title="Sửa">
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => remove(o)} className="text-destructive hover:opacity-80" title="Xóa">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Withdrawals panel */}
      <div className="rounded-xl border bg-card shadow-sm">
        <button
          onClick={() => setWListOpen((o) => !o)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-muted/30 transition rounded-xl"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <Wallet className="h-4 w-4 text-purple-600" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">Lịch sử rút doanh thu</h2>
            <span className="bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 text-xs font-bold px-2 py-0.5 rounded-full">
              {withdrawalsInRange.length} lần
            </span>
            {totalEntries.filter(([, t]) => t.withdrawn > 0).map(([cur, t]) => (
              <span key={cur} className="bg-muted text-muted-foreground text-xs px-2 py-0.5 rounded-full">
                {formatMoney(t.withdrawn, cur)} đã rút
              </span>
            ))}
          </div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", wListOpen && "rotate-180")} />
        </button>

        {wListOpen && (
          <div className="border-t px-6 pb-6">
            {withdrawalsInRange.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">
                Không có lần rút nào trong khoảng thời gian đã chọn.
              </p>
            ) : (
              <div className="rounded-lg border overflow-hidden mt-4">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Ngày</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Đơn hàng</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Đợt</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Đối tác</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Số tiền</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Ghi chú</th>
                      <th className="w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {withdrawalsInRange.map((w) => {
                      const order = w.orderId ? orderById.get(w.orderId) : null;
                      const partner = order?.partnerId ? partnerById.get(order.partnerId) : null;
                      return (
                      <tr key={w.id} className="border-b border-border/30 hover:bg-muted/30 group">
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          {new Date(w.withdrawnAt).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {order ? <span className="font-medium">{order.packageName}</span> : <span className="opacity-40">— (đã xóa)</span>}
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          {w.installment != null ? (
                            <span className="inline-flex items-center rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 text-[10px] font-semibold">
                              Đợt {w.installment}
                              {order && order.paymentSplits[w.installment - 1] != null && (
                                <span className="ml-1 opacity-70">({order.paymentSplits[w.installment - 1]}%)</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-[10px] opacity-40 italic">tùy chỉnh</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {partner?.name ?? <span className="opacity-40">—</span>}
                        </td>
                        <td className="px-3 py-2 text-sm font-semibold whitespace-nowrap text-purple-600 dark:text-purple-400">
                          {formatMoney(w.amount, w.currency)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground italic max-w-[300px] truncate" title={w.notes ?? ""}>
                          {w.notes || <span className="opacity-40">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition">
                            <button onClick={() => openEditWithdrawal(w)} className="text-muted-foreground hover:text-primary" title="Sửa">
                              <Edit2 className="h-3 w-3" />
                            </button>
                            <button onClick={() => deleteWithdrawal(w.id)} className="text-destructive hover:opacity-80" title="Xóa">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
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
