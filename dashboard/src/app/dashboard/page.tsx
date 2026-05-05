"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PieChart,
  Boxes,
  ShoppingCart,
  TrendingUp,
  Wallet,
  DollarSign,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { InventoryEntry } from "@/lib/inventory-db";
import type { Withdrawal } from "@/lib/withdrawal-db";
import type { Partner } from "@/lib/os-partners-db";
import type { Order, OrderCurrency } from "@/lib/os-orders-db";
import type { OsWithdrawal } from "@/lib/os-withdrawal-db";

type DateRangePreset = "today" | "7d" | "30d" | "thisMonth" | "lastMonth" | "thisYear" | "all" | "custom";

// ─── Money formatting (en-US locale) ────────────────────────────────────────
function formatMoneyByCurrency(amount: number, currency: string): string {
  const cur = currency.toUpperCase();
  const f2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f0 = (n: number) => Math.round(n).toLocaleString("en-US");
  if (cur === "USD") return `$${f2(amount)}`;
  if (cur === "VND") return `${f0(amount)} ₫`;
  if (cur === "USDT") return `${f2(amount)} USDT`;
  return `${f2(amount)} ${cur}`;
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);

  // Domain Catcher
  const [inventory, setInventory] = useState<InventoryEntry[]>([]);
  const [dcWithdrawals, setDcWithdrawals] = useState<Withdrawal[]>([]);

  // OS Service
  const [orders, setOrders] = useState<Order[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [osWithdrawals, setOsWithdrawals] = useState<OsWithdrawal[]>([]);

  // Date range
  const [datePreset, setDatePreset] = useState<DateRangePreset>("all");
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [invRes, dcWRes, oRes, pRes, osWRes] = await Promise.all([
        fetch("/api/inventory"),
        fetch("/api/withdrawals"),
        fetch("/api/os-orders"),
        fetch("/api/os-partners"),
        fetch("/api/os-withdrawals"),
      ]);
      const [inv, dcW, o, p, osW] = await Promise.all([
        invRes.json(), dcWRes.json(), oRes.json(), pRes.json(), osWRes.json(),
      ]);
      setInventory(Array.isArray(inv) ? inv : []);
      setDcWithdrawals(Array.isArray(dcW) ? dcW : []);
      setOrders(Array.isArray(o) ? o : []);
      setPartners(Array.isArray(p) ? p : []);
      setOsWithdrawals(Array.isArray(osW) ? osW : []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ─── Date range ─────────────────────────────────────────────────────────────
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

  const inRange = useCallback((isoDate: string | null | undefined): boolean => {
    if (!isoDate) return false;
    if (dateRange.start == null && dateRange.end == null) return true;
    const t = new Date(isoDate).getTime();
    if (dateRange.start != null && t < dateRange.start) return false;
    if (dateRange.end != null && t > dateRange.end) return false;
    return true;
  }, [dateRange]);

  // ─── Domain Catcher metrics (USD-only based on existing schema) ─────────────
  const dcStats = useMemo(() => {
    const sold = inventory.filter((e) => e.soldAt != null && inRange(e.soldAt));
    const purchasedInRange = inventory.filter((e) => inRange(e.purchasedAt));
    const revenue = sold.reduce((s, e) => s + (e.sellPrice ?? 0), 0);
    const cost = sold.reduce((s, e) => s + (e.purchasePrice ?? 0), 0);
    const profit = revenue - cost;

    // Tiềm năng = giá trị kỳ vọng của domain CHƯA bán (all-time, không filter range
    // vì là current holding). Fallback purchasePrice nếu chưa set expectedSellPrice.
    const holdings = inventory.filter((e) => e.soldAt == null);
    let potentialExpected = 0;
    let potentialFloor = 0;
    let holdingWithoutExpected = 0;
    for (const e of holdings) {
      if (e.expectedSellPrice != null && e.expectedSellPrice > 0) {
        potentialExpected += e.expectedSellPrice;
      } else {
        holdingWithoutExpected++;
      }
      potentialFloor += e.purchasePrice ?? 0;
    }

    // Withdrawals scoped by withdrawn_at, split by status (đồng nhất với /inventory):
    //   - status="paid"               → đã thực rút
    //   - status="progressing"|"under_review" → đang chờ (record đã tạo, chưa nhận tiền)
    const paidByCurrency: Record<string, number> = {};
    const pendingByCurrency: Record<string, number> = {};
    for (const w of dcWithdrawals) {
      if (!inRange(w.withdrawnAt)) continue;
      const cur = (w.currency || "USD").toUpperCase();
      if (w.status === "paid") {
        paidByCurrency[cur] = (paidByCurrency[cur] ?? 0) + w.amount;
      } else {
        pendingByCurrency[cur] = (pendingByCurrency[cur] ?? 0) + w.amount;
      }
    }

    return {
      soldCount: sold.length,
      purchasedCount: purchasedInRange.length,
      holdingCount: holdings.length,
      revenue,
      cost,
      profit,
      potentialExpected,
      potentialFloor,
      holdingWithoutExpected,
      paidByCurrency,
      pendingByCurrency,
    };
  }, [inventory, dcWithdrawals, inRange]);

  // ─── OS Service metrics ─────────────────────────────────────────────────────
  const partnerById = useMemo(() => {
    const m = new Map<string, Partner>();
    for (const p of partners) m.set(p.id, p);
    return m;
  }, [partners]);

  const osStats = useMemo(() => {
    const ordersInRange = orders.filter((o) => inRange(o.createdAt));
    const wInRange = osWithdrawals.filter((w) => inRange(w.withdrawnAt));

    // Effective revenue (auto = price × partner.discount%)
    const effectiveRevenue = (o: Order): number => {
      const partner = o.partnerId ? partnerById.get(o.partnerId) : null;
      return partner ? +((o.price * partner.discountPercent) / 100).toFixed(2) : o.revenue;
    };

    // Aggregate by currency
    const byCurrency: Record<string, { price: number; revenue: number; withdrawn: number; remaining: number }> = {};
    for (const o of ordersInRange) {
      if (!byCurrency[o.currency]) byCurrency[o.currency] = { price: 0, revenue: 0, withdrawn: 0, remaining: 0 };
      byCurrency[o.currency].price += o.price;
      byCurrency[o.currency].revenue += effectiveRevenue(o);
    }
    for (const w of wInRange) {
      const cur = w.currency.toUpperCase();
      if (!byCurrency[cur]) byCurrency[cur] = { price: 0, revenue: 0, withdrawn: 0, remaining: 0 };
      byCurrency[cur].withdrawn += w.amount;
    }
    for (const cur of Object.keys(byCurrency)) {
      byCurrency[cur].remaining = byCurrency[cur].revenue - byCurrency[cur].withdrawn;
    }
    return {
      ordersCount: ordersInRange.length,
      withdrawalsCount: wInRange.length,
      byCurrency,
    };
  }, [orders, osWithdrawals, partnerById, inRange]);

  const osCurrencies = useMemo(
    () => Object.entries(osStats.byCurrency) as [OrderCurrency, { price: number; revenue: number; withdrawn: number; remaining: number }][],
    [osStats]
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Đang tải dữ liệu...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <PieChart className="h-6 w-6 text-primary" />
            Tổng quan
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Doanh thu, lợi nhuận & dòng tiền — tổng hợp Domain Catcher + OS Service.
          </p>
        </div>
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
            <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="h-7 text-xs w-36" />
            <span className="text-muted-foreground text-xs">→</span>
            <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="h-7 text-xs w-36" />
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

      {/* ─── Domain Catcher section ───────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-6 py-4 border-b bg-muted/20">
          <div className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Domain Catcher</h2>
            <span className="text-xs text-muted-foreground ml-1">
              · {dcStats.holdingCount} đang giữ · {dcStats.soldCount} bán trong kỳ
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 p-4">
          <StatCard
            label="Domain mua trong kỳ"
            value={dcStats.purchasedCount.toLocaleString("en-US")}
            subline={
              <span className="text-muted-foreground">
                Đang giữ: <strong className="text-foreground">{dcStats.holdingCount}</strong>
              </span>
            }
          />
          <StatCard
            label="Doanh thu (đã bán)"
            value={formatMoneyByCurrency(dcStats.revenue, "USD")}
            color="text-emerald-600 dark:text-emerald-400"
            small
          />
          <StatCard
            label="Chi phí (giá mua)"
            value={formatMoneyByCurrency(dcStats.cost, "USD")}
            color="text-amber-600 dark:text-amber-400"
            small
          />
          <StatCard
            label="Lợi nhuận"
            value={formatMoneyByCurrency(dcStats.profit, "USD")}
            color={dcStats.profit > 0 ? "text-blue-600 dark:text-blue-400"
              : dcStats.profit < 0 ? "text-rose-600 dark:text-rose-400"
              : "text-muted-foreground"}
            small
          />
          <StatCard
            label="Tiềm năng"
            value={formatMoneyByCurrency(dcStats.potentialExpected, "USD")}
            color="text-indigo-600 dark:text-indigo-400"
            small
            subline={
              <div className="space-y-0.5">
                <p className="text-muted-foreground">
                  Vốn tồn: <span className="font-mono">{formatMoneyByCurrency(dcStats.potentialFloor, "USD")}</span>
                </p>
                {dcStats.holdingWithoutExpected > 0 && (
                  <p className="text-amber-600 dark:text-amber-400 text-[10px]">
                    {dcStats.holdingWithoutExpected} domain chưa set expected price
                  </p>
                )}
              </div>
            }
          />
          <StatCard
            label="Đã rút"
            value={
              Object.keys(dcStats.paidByCurrency).length === 0 ? "—"
                : Object.entries(dcStats.paidByCurrency).map(([cur, amt]) => (
                  <p key={cur} className="text-base font-bold leading-snug text-purple-600 dark:text-purple-400">
                    {formatMoneyByCurrency(amt, cur)}
                  </p>
                ))
            }
            color="text-purple-600 dark:text-purple-400"
            small
            multi={Object.keys(dcStats.paidByCurrency).length > 0}
            subline={
              Object.keys(dcStats.pendingByCurrency).length > 0 ? (
                <div className="space-y-0.5">
                  {Object.entries(dcStats.pendingByCurrency).map(([cur, amt]) => (
                    <p key={cur} className="text-amber-600 dark:text-amber-400">
                      + Đang chờ: <strong>{formatMoneyByCurrency(amt, cur)}</strong>
                    </p>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">Không có khoản chờ</span>
              )
            }
          />
        </div>
      </div>

      {/* ─── OS Service section ───────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-6 py-4 border-b bg-muted/20">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">OS Service</h2>
            <span className="text-xs text-muted-foreground ml-1">
              · {osStats.ordersCount} đơn · {osStats.withdrawalsCount} lần rút
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 p-4">
          <StatCard
            label="Tổng đơn"
            value={osStats.ordersCount.toLocaleString("en-US")}
          />
          <StatCard
            label="Tổng giá trị"
            value={
              osCurrencies.length === 0 ? "—"
                : osCurrencies.map(([cur, t]) => (
                  <p key={cur} className="text-base font-bold leading-snug">{formatMoneyByCurrency(t.price, cur)}</p>
                ))
            }
            small
            multi={osCurrencies.length > 0}
          />
          <StatCard
            label="Doanh thu"
            value={
              osCurrencies.length === 0 ? "—"
                : osCurrencies.map(([cur, t]) => (
                  <p key={cur} className="text-base font-bold leading-snug text-emerald-600 dark:text-emerald-400">
                    {formatMoneyByCurrency(t.revenue, cur)}
                  </p>
                ))
            }
            color="text-emerald-600 dark:text-emerald-400"
            small
            multi={osCurrencies.length > 0}
          />
          <StatCard
            label="Đã rút"
            value={
              osCurrencies.filter(([, t]) => t.withdrawn > 0).length === 0 ? "—"
                : osCurrencies.filter(([, t]) => t.withdrawn > 0).map(([cur, t]) => (
                  <p key={cur} className="text-base font-bold leading-snug text-purple-600 dark:text-purple-400">
                    {formatMoneyByCurrency(t.withdrawn, cur)}
                  </p>
                ))
            }
            color="text-purple-600 dark:text-purple-400"
            small
            multi
          />
          <StatCard
            label="Còn lại"
            value={
              osCurrencies.length === 0 ? "—"
                : osCurrencies.map(([cur, t]) => (
                  <p key={cur} className={cn(
                    "text-base font-bold leading-snug",
                    t.remaining > 0 ? "text-blue-600 dark:text-blue-400"
                    : t.remaining < 0 ? "text-rose-600 dark:text-rose-400"
                    : "text-muted-foreground"
                  )}>
                    {formatMoneyByCurrency(t.remaining, cur)}
                  </p>
                ))
            }
            small
            multi={osCurrencies.length > 0}
          />
        </div>
      </div>

      {/* ─── Combined summary (tooltip-style note) ────────────────────────── */}
      <div className="rounded-xl border border-dashed bg-muted/10 p-4">
        <div className="flex items-start gap-3">
          <DollarSign className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
            <p>
              <strong className="text-foreground">Lưu ý về đa tiền tệ:</strong> Domain Catcher chủ yếu dùng USD.
              OS Service hỗ trợ USD/VND/USDT — không cộng gộp tiền tệ khác nhau (vì sẽ sai về tỷ giá).
            </p>
            <p className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              <span>
                <strong>Doanh thu</strong> Domain Catcher = giá bán domain.
                <strong className="ml-2">Doanh thu</strong> OS Service = Giá × % đối tác.
              </span>
            </p>
            <p className="flex items-center gap-1">
              <Wallet className="h-3 w-3" />
              <span><strong>Đã rút</strong> = số tiền thực rút khỏi doanh thu trong kỳ.</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Reusable stat card component ──────────────────────────────────────────
function StatCard({
  label,
  value,
  subline,
  color,
  small,
  multi,
}: {
  label: string;
  value: React.ReactNode;
  subline?: React.ReactNode;
  color?: string;
  small?: boolean;
  multi?: boolean;
}) {
  const isPlainText = typeof value === "string" || typeof value === "number";
  return (
    <div className="rounded-lg border bg-background px-4 py-3">
      <p className="text-xs text-muted-foreground uppercase">{label}</p>
      {isPlainText ? (
        <p className={cn(
          "font-bold",
          small ? "text-lg leading-snug" : "text-2xl",
          color ?? "",
          "mt-1",
        )}>
          {value}
        </p>
      ) : multi ? (
        <div className="space-y-1.5 mt-1">{value}</div>
      ) : (
        <div className="mt-1">{value}</div>
      )}
      {subline && <div className="mt-1.5 text-[11px] leading-tight">{subline}</div>}
    </div>
  );
}
