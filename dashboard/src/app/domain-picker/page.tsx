"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Upload, Loader2, Copy, RotateCcw, Rocket, Send, ShoppingCart, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseCsv, parseUnifiedCsv } from "@/lib/picker-csv";

// ─── Pipeline AUTO 5 bước ─────────────────────────────────────────────────────
// 1 Nhập → 2 Lọc mới (đã mua/flagged/no-snap/đã check Wayback·DFS·Ahrefs)
// → 3 RDAP mua được? + giá (chỉ giá ≤ $26 đi tiếp) → 4 Wayback (chỉ Clean)
// → 5 gửi Clean tới DataForSEO (webhook N8N). Tất cả tự chạy sau khi bấm 1 nút.

type Step = 1 | 2 | 3 | 4 | 5 | 6;
const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: "Nhập" },
  { id: 2, label: "Lọc mới" },
  { id: 3, label: "Mua được? ≤$26" },
  { id: 4, label: "Wayback" },
  { id: 5, label: "DataForSEO" },
  { id: 6, label: "Đáng mua" },
];
const MAX_PRICE = 26;

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

// Kênh backorder Gname (Channel 2 = $26) — giá + deposit + TLD hỗ trợ.
type BoChannel = { price: number; deposit: number; tlds: string[] };

// Có mua được không + giá, theo trạng thái Gname:
//   available  → đăng ký (giá register)   registered → backorder Channel 2 ($26)
function priceOf(
  status: string | undefined,
  tld: string,
  pricing: Record<string, Price>,
  bo: BoChannel | null,
): { acquirable: boolean; price: number | null; mode: "register" | "backorder" | "none" } {
  // available → đăng ký ngay (giá register).
  if (status === "available") {
    const reg = pricing[tld]?.register;
    return reg != null ? { acquirable: true, price: reg, mode: "register" } : { acquirable: false, price: null, mode: "none" };
  }
  // registered → backorder qua Channel 2 ($26) nếu TLD được kênh hỗ trợ.
  if (status === "registered" && bo && bo.tlds.includes(tld)) {
    return { acquirable: true, price: bo.price, mode: "backorder" };
  }
  return { acquirable: false, price: null, mode: "none" };
}

function extractFromFileText(text: string): string[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.includes(",") || firstLine.includes(";") || firstLine.includes("\t")) {
    try {
      const rows = parseCsv(text);
      if (rows.length >= 2) {
        const header = rows[0].map((h) => h.trim().toLowerCase());
        let col = header.findIndex((h) => h === "name" || h === "domain");
        if (col < 0) {
          const sample = rows.slice(1, 300);
          const counts = rows[0].map((_, i) => sample.filter((r) => DOMAIN_RE.test((r[i] ?? "").trim().toLowerCase())).length);
          col = counts.indexOf(Math.max(...counts));
        }
        if (col >= 0) {
          const seen = new Set<string>(); const out: string[] = [];
          for (let r = 1; r < rows.length; r++) {
            const d = (rows[r][col] ?? "").trim().toLowerCase();
            if (DOMAIN_RE.test(d) && !seen.has(d)) { seen.add(d); out.push(d); }
          }
          if (out.length) return out;
        }
      }
    } catch { /* fall through */ }
  }
  return parseDomains(text);
}

export default function DomainPickerPage() {
  const [step, setStep] = useState<Step>(1);
  const [done, setDone] = useState<Set<Step>>(new Set());
  const [running, setRunning] = useState(false);

  const [pasteText, setPasteText] = useState("");
  const [raw, setRaw] = useState<string[]>([]);
  const [b2, setB2] = useState<{ bought: string[]; flagged: string[]; nosnap: string[]; checked: string[] }>({ bought: [], flagged: [], nosnap: [], checked: [] });
  const [afterExclude, setAfterExclude] = useState<string[]>([]); // domain MỚI
  const [gated, setGated] = useState<string[]>([]);               // mua được + giá ≤ $26
  const fileRef = useRef<HTMLInputElement>(null);

  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [wbFlagged, setWbFlagged] = useState<Set<string>>(new Set());
  const [wbNoSnap, setWbNoSnap] = useState<Set<string>>(new Set());
  const [wbChecked, setWbChecked] = useState<Set<string>>(new Set());
  const [pricing, setPricing] = useState<Record<string, Price>>({});
  const [boChannel, setBoChannel] = useState<BoChannel | null>(null);

  const [rdap, setRdap] = useState<Record<string, RdapRow>>({});
  const [wbResults, setWbResults] = useState<WaybackRow[]>([]);
  const [wbRuns, setWbRuns] = useState<WaybackRun[]>([]);
  const [wbStarted, setWbStarted] = useState(false);

  const [webhookStatus, setWebhookStatus] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [webhookMsg, setWebhookMsg] = useState("");
  const sentRef = useRef(false);
  const pollRef = useRef(0);

  // Bước 6 — Đáng mua
  const [ratings, setRatings] = useState<Record<string, string | null>>({});
  const [loadingRatings, setLoadingRatings] = useState(false);
  const [selectedBuy, setSelectedBuy] = useState<Set<string>>(new Set());
  const [buying, setBuying] = useState(false);
  const [buyNote, setBuyNote] = useState<{ ok: boolean; msg: string } | null>(null);
  const [uploadingResult, setUploadingResult] = useState(false);
  const [pollExhausted, setPollExhausted] = useState(false);
  const resultFileRef = useRef<HTMLInputElement>(null);

  const [toasts, setToasts] = useState<{ id: number; msg: string; err: boolean }[]>([]);
  const tid = useRef(0);
  const toast = useCallback((msg: string, err = false) => {
    const id = ++tid.current;
    setToasts((p) => [...p, { id, msg, err }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4000);
  }, []);

  // ── Load giá + Kho + Wayback-checked (1 lần) ──
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
      for (const c of d.checked ?? []) { const dm = String(c.domain).toLowerCase(); ch.add(dm); if (c.flagged) fl.add(dm); else if (c.noSnapshot) ns.add(dm); }
      setWbFlagged(fl); setWbNoSnap(ns); setWbChecked(ch);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let payload: { domains?: unknown; ts?: number } | null = null;
    try { payload = JSON.parse(localStorage.getItem("dompicker.transfer") || "null"); } catch { /* ignore */ }
    try { localStorage.removeItem("dompicker.transfer"); } catch { /* ignore */ }
    if (!payload || !Array.isArray(payload.domains) || (payload.ts && Date.now() - payload.ts > 10 * 60_000)) return;
    setPasteText((payload.domains as string[]).join("\n"));
  }, []);

  const onFile = (f: File | null) => {
    if (!f) return;
    f.text().then((t) => {
      const doms = extractFromFileText(t);
      if (!doms.length) { toast("File không có domain hợp lệ", true); return; }
      setPasteText((p) => (p.trim() ? p.trim() + "\n" : "") + doms.join("\n"));
      toast(`✅ Đọc ${doms.length} domain từ file`);
    });
  };

  // ── Gname check (mua được?): trả về map (không dựa state để tránh stale) ──
  const runRdap = useCallback(async (domains: string[]): Promise<Record<string, RdapRow>> => {
    const acc: Record<string, RdapRow> = {};
    const BATCH = 25;
    for (let i = 0; i < domains.length; i += BATCH) {
      try {
        const res = await fetch("/api/gname/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domains: domains.slice(i, i + BATCH) }) });
        for (const r of (await res.json()).results ?? []) acc[r.domain] = r;
        setRdap({ ...acc });
      } catch { /* ignore */ }
    }
    return acc;
  }, []);

  const loadWb = useCallback(async () => {
    try {
      const [r1, r2] = await Promise.all([fetch("/api/wayback/results"), fetch("/api/wayback/runs")]);
      setWbResults((await r1.json()).rows ?? []);
      setWbRuns((await r2.json()).runs ?? []);
    } catch { /* ignore */ }
  }, []);
  const startWayback = useCallback(async (targets: string[]) => {
    if (!targets.length) return;
    const BATCH = 10, CONC = 5;
    const batches: string[][] = [];
    for (let i = 0; i < targets.length; i += BATCH) batches.push(targets.slice(i, i + BATCH));
    let cursor = 0;
    const worker = async () => { while (cursor < batches.length) { const i = cursor++; try { await fetch("/api/wayback/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targets: batches[i] }) }); } catch { /* ignore */ } } };
    await Promise.all(Array.from({ length: Math.min(CONC, batches.length) }, () => worker()));
    await loadWb();
  }, [loadWb]);
  const pollWb = useCallback(async (runId: string) => { try { await fetch(`/api/wayback/runs/${encodeURIComponent(runId)}`); await loadWb(); } catch { /* ignore */ } }, [loadWb]);
  useEffect(() => {
    if (step !== 4) return;
    const runningRuns = wbRuns.filter((r) => r.status === "READY" || r.status === "RUNNING");
    if (!runningRuns.length) return;
    const id = setInterval(() => { for (const r of runningRuns) pollWb(r.runId); }, 10000);
    return () => clearInterval(id);
  }, [step, wbRuns, pollWb]);

  const wbByDomain = useMemo(() => { const m = new Map<string, WaybackRow>(); for (const r of wbResults) m.set(r.targetDomain, r); return m; }, [wbResults]);
  const inFlightWb = useMemo(() => { const s = new Set<string>(); for (const r of wbRuns) if (r.status === "READY" || r.status === "RUNNING") for (const d of r.targets) s.add(d); return s; }, [wbRuns]);
  const cleanDomains = useMemo(() => gated.filter((d) => { const wb = wbByDomain.get(d); return !!wb && !wb.hasBetting && !wb.hasAdult && (wb.snapshotCount ?? 0) > 0; }), [gated, wbByDomain]);
  // Bước 6: chỉ giữ domain rating Tốt / Trung bình. Ưu tiên tập Clean của lần chạy;
  // nếu vào thẳng Bước 6 (upload kết quả rời) thì lấy toàn bộ domain đã có rating.
  const buyList = useMemo(() => {
    const isGood = (d: string) => { const r = ratings[d] ?? ""; return r.includes("TỐT") || r.includes("TRUNG BÌNH"); };
    const base = cleanDomains.length ? cleanDomains : Object.keys(ratings);
    return base.filter(isGood);
  }, [cleanDomains, ratings]);
  const wbStats = useMemo(() => {
    let clean = 0, flagged = 0, nosnap = 0, pending = 0;
    for (const d of gated) {
      const wb = wbByDomain.get(d);
      if (!wb) { pending++; continue; }
      if (wb.hasBetting || wb.hasAdult) flagged++;
      else if ((wb.snapshotCount ?? 0) === 0) nosnap++;
      else clean++;
    }
    return { clean, flagged, nosnap, pending };
  }, [gated, wbByDomain]);

  const sendWebhook = useCallback(async (domains: string[]) => {
    setWebhookStatus("sending");
    try {
      const res = await fetch("/api/picker/dataforseo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domains }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setWebhookStatus("ok"); setWebhookMsg(`Đã gửi ${d.sent} domain tới N8N`); toast(`✅ Gửi ${d.sent} domain → DataForSEO (N8N)`);
      setDone((p) => new Set(p).add(5)); setStep(6); // auto sang Bước 6 → tự poll kết quả
    } catch (e) {
      setWebhookStatus("error"); setWebhookMsg(e instanceof Error ? e.message : "Lỗi");
      toast(`⚠️ Webhook: ${e instanceof Error ? e.message : "lỗi"}`, true);
    }
  }, [toast]);

  // ── Bước 6: lấy rating DataForSEO (N8N ghi vào target_assessment) ──
  const loadRatings = useCallback(async (domains: string[]) => {
    if (!domains.length) return;
    setLoadingRatings(true);
    try {
      const res = await fetch("/api/picker/ratings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domains }) });
      const d = await res.json();
      setRatings((prev) => {
        const m = { ...prev };
        for (const a of d.assessments ?? []) m[String(a.domain).toLowerCase()] = a.rating;
        return m;
      });
    } catch { /* ignore */ } finally { setLoadingRatings(false); }
  }, []);

  // Upload file kết quả Ahrefs/DataForSEO (có cột rating) → ghi target_assessment → lọc Tốt/TB.
  const uploadResult = useCallback((f: File | null) => {
    if (!f) return;
    f.text().then(async (text) => {
      let parsed: ReturnType<typeof parseUnifiedCsv> = [];
      try { parsed = parseUnifiedCsv(text); } catch (e) { toast(`❌ ${e instanceof Error ? e.message : "parse lỗi"}`, true); return; }
      if (!parsed.length) { toast("File không có dữ liệu (cần cột target_domain + rating)", true); return; }
      const assessments = parsed.filter((u) => u.rating || u.category || u.detail)
        .map((u) => ({ targetDomain: u.targetDomain, rating: u.rating || null, category: u.category || null, detail: u.detail || null, excludedAt: null }));
      const rows: { targetDomain: string; refDomain: string; domainRating: number }[] = [];
      for (const u of parsed) for (const r of u.refs) rows.push({ targetDomain: u.targetDomain, refDomain: r.domain, domainRating: r.dr });
      setUploadingResult(true);
      try {
        const CHUNK = 3000;
        const chunks: (typeof rows)[] = [];
        for (let i = 0; i < rows.length; i += CHUNK) chunks.push(rows.slice(i, i + CHUNK));
        if (!chunks.length) chunks.push([]);
        for (let i = 0; i < chunks.length; i++) {
          const res = await fetch("/api/ahrefs-results/db/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: chunks[i], assessments: i === 0 ? assessments : [] }) });
          if (!res.ok) throw new Error((await res.json()).error ?? "upload lỗi");
        }
        // cập nhật rating cục bộ ngay (không cần chờ loadRatings)
        setRatings((prev) => { const m = { ...prev }; for (const u of parsed) m[u.targetDomain] = u.rating || null; return m; });
        const goods = parsed.filter((u) => (u.rating || "").includes("TỐT") || (u.rating || "").includes("TRUNG BÌNH")).length;
        toast(`✅ Upload ${assessments.length} rating (${goods} Tốt/TB) · ${rows.length} ref`);
      } catch (e) { toast(`❌ ${e instanceof Error ? e.message : "lỗi upload"}`, true); }
      finally { setUploadingResult(false); }
    });
  }, [toast]);

  const buyDomains = useCallback(async (domains: string[]) => {
    if (!domains.length) return;
    if (!confirm(`⚡ MUA THẬT ${domains.length} domain qua Gname? Tiền sẽ bị trừ từ số dư Gname.`)) return;
    setBuying(true); setBuyNote(null);
    try {
      const meta: Record<string, { rating: string | null }> = {};
      for (const d of domains) meta[d] = { rating: ratings[d] ?? null };
      const res = await fetch("/api/gname/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domains, meta }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const results: { domain: string; ok: boolean; msg: string }[] = data.results ?? [];
      const okList = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      const insufficient = failed.some((r) => /insufficient|balance|not enough|不足|余额/i.test(r.msg || ""));
      if (okList.length) toast(`✅ Mua ${okList.length} domain · tổng $${(data.totalCharged ?? 0).toFixed(2)} · đã lưu Kho`);
      if (insufficient) setBuyNote({ ok: false, msg: `⚠️ KHÔNG ĐỦ TIỀN trong tài khoản Gname — nạp thêm rồi mua lại (${failed.length} domain chưa mua).` });
      else if (failed.length) setBuyNote({ ok: false, msg: `${failed.length} domain lỗi: ${(failed[0].msg || "").slice(0, 90)}` });
      else setBuyNote({ ok: true, msg: `Đã mua hết ${okList.length} domain, lưu vào Kho.` });
      setSelectedBuy(new Set());
      setOwned((prev) => { const n = new Set(prev); for (const r of okList) n.add(r.domain); return n; });
    } catch (e) {
      setBuyNote({ ok: false, msg: e instanceof Error ? e.message : "Lỗi mua" });
    } finally { setBuying(false); }
  }, [ratings, toast]);

  // ── Auto: Wayback xong → gửi Clean qua webhook (1 lần/run) ──
  useEffect(() => {
    if (step !== 4 || !wbStarted || sentRef.current || !gated.length) return;
    const stillRunning = gated.some((d) => inFlightWb.has(d) && !wbByDomain.has(d));
    const engaged = gated.some((d) => wbByDomain.has(d) || inFlightWb.has(d));
    if (!stillRunning && engaged) {
      sentRef.current = true;
      const clean = gated.filter((d) => { const wb = wbByDomain.get(d); return !!wb && !wb.hasBetting && !wb.hasAdult && (wb.snapshotCount ?? 0) > 0; });
      setDone((p) => new Set(p).add(4)); setStep(5);
      if (clean.length) sendWebhook(clean);
      else { setWebhookStatus("idle"); toast("Không có domain Clean để gửi", true); }
    }
  }, [step, wbStarted, gated, wbByDomain, inFlightWb, sendWebhook, toast]);

  // ── Bước 6 AUTO-POLL: N8N chạy xong ghi rating → tự lấy (mỗi 15s, tối đa ~10 phút) ──
  useEffect(() => {
    if (step !== 6 || !cleanDomains.length) return;
    pollRef.current = 0;
    setPollExhausted(false);
    loadRatings(cleanDomains);
    const id = setInterval(() => {
      pollRef.current += 1;
      if (pollRef.current >= 40) { clearInterval(id); setPollExhausted(true); return; }
      loadRatings(cleanDomains);
    }, 15000);
    return () => clearInterval(id);
  }, [step, cleanDomains, loadRatings]);

  // ── ORCHESTRATOR ──
  const runPipeline = useCallback(async () => {
    const parsed = parseDomains(pasteText);
    if (!parsed.length) { toast("Không có domain hợp lệ", true); return; }
    setRunning(true); sentRef.current = false; setWbStarted(false); setWebhookStatus("idle");
    setRaw(parsed); setRdap({}); setGated([]);

    // B2: lọc mới (bounded query DFS/Ahrefs)
    let seoSet = new Set<string>();
    try {
      const res = await fetch("/api/ahrefs-results/db/checked", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domains: parsed }) });
      seoSet = new Set(((await res.json()).targets ?? []).map((x: string) => String(x).toLowerCase()));
    } catch { /* ignore */ }
    const bought: string[] = [], flagged: string[] = [], nosnap: string[] = [], checked: string[] = [], fresh: string[] = [];
    for (const dm of parsed) {
      if (owned.has(dm)) bought.push(dm);
      else if (wbFlagged.has(dm)) flagged.push(dm);
      else if (wbNoSnap.has(dm)) nosnap.push(dm);
      else if (wbChecked.has(dm) || seoSet.has(dm)) checked.push(dm);
      else fresh.push(dm);
    }
    setB2({ bought, flagged, nosnap, checked }); setAfterExclude(fresh);
    setDone((p) => new Set(p).add(1).add(2));
    if (!fresh.length) { setStep(2); toast("Không có domain mới", true); setRunning(false); return; }

    // đảm bảo có bảng giá
    let pr = pricing;
    if (!Object.keys(pr).length) {
      try { const d = await (await fetch("/api/gname/pricing")).json(); pr = {}; for (const p of d.pricing ?? []) pr[String(p.tld).toLowerCase()] = { register: p.register, backorder: p.backorder, deposit: p.deposit }; setPricing(pr); } catch { /* ignore */ }
    }
    // đảm bảo có kênh backorder (Channel 2 = $26) cho domain registered
    let bo = boChannel;
    if (!bo) {
      try {
        const ch = await (await fetch("/api/gname/channels")).json();
        const c2 = (ch.channels ?? []).find((c: { channel_name: string }) => c.channel_name === "Channel 2");
        if (c2) { bo = { price: c2.price, deposit: c2.deposit, tlds: c2.tlds }; setBoChannel(bo); }
      } catch { /* ignore */ }
    }

    // B3: Gname check (mua được?) + giá → gate ≤ $26 (available=đăng ký, registered=backorder Ch.2)
    setStep(3);
    const rd = await runRdap(fresh);
    const g = fresh.filter((d) => { const info = priceOf(rd[d]?.status, tldOf(d), pr, bo); return info.acquirable && info.price != null && info.price <= MAX_PRICE; });
    setGated(g); setDone((p) => new Set(p).add(3));
    if (!g.length) { toast("Không domain nào mua được & giá ≤ $26", true); setRunning(false); return; }

    // B4: Wayback (chỉ domain đã gate)
    setStep(4); setWbStarted(true);
    await startWayback(g);
    setRunning(false); // đã trigger; Wayback chạy async → effect tự gửi webhook khi xong
  }, [pasteText, owned, wbFlagged, wbNoSnap, wbChecked, pricing, boChannel, runRdap, startWayback, toast]);

  const reset = () => { setStep(1); setDone(new Set()); setRaw([]); setAfterExclude([]); setGated([]); setB2({ bought: [], flagged: [], nosnap: [], checked: [] }); setRdap({}); setWbStarted(false); setWebhookStatus("idle"); sentRef.current = false; setRatings({}); setSelectedBuy(new Set()); setBuyNote(null); };

  const priceStr = (d: string): string => {
    const info = priceOf(rdap[d]?.status, tldOf(d), pricing, boChannel);
    if (info.price == null) return "—";
    return `$${info.price} ${info.mode === "register" ? "đăng ký" : "BO"}${info.price <= MAX_PRICE ? "" : " ✗"}`;
  };
  const rdapBadge = (d: string) => {
    const st = rdap[d]?.status;
    if (!st) return <span className="text-muted-foreground text-xs">…</span>;
    if (st === "available") return <span className="text-emerald-700 font-bold text-xs">🟢 MUA ĐƯỢC</span>;
    if (st === "premium") return <span className="text-purple-600 text-xs" title="Domain premium — Gname không cho tự mua giá thường">⭐ Premium</span>;
    if (st === "registered") {
      const info = priceOf(st, tldOf(d), pricing, boChannel);
      return info.mode === "backorder"
        ? <span className="text-amber-600 font-bold text-xs" title="Backorder qua Gname Channel 2 ($26, deposit $3 hoàn lại nếu không bắt được)">🟠 BACKORDER</span>
        : <span className="text-muted-foreground text-xs">⚪ đã đăng ký</span>;
    }
    return <span className="text-orange-500 text-xs" title="Gname check lỗi (IP chưa whitelist / rate-limit / mạng) — bấm 'Làm lại' để thử lại.">⚠️ Gname lỗi</span>;
  };
  const wbBadge = (d: string) => {
    if (!gated.includes(d)) return <span className="text-muted-foreground text-xs">— loại</span>;
    if (inFlightWb.has(d)) return <span className="text-blue-600 text-xs inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />chạy</span>;
    const wb = wbByDomain.get(d);
    if (!wb) return <span className="text-muted-foreground text-xs">—</span>;
    if (wb.hasBetting || wb.hasAdult) return <span className="text-rose-600 text-xs">🚨 flagged</span>;
    if ((wb.snapshotCount ?? 0) === 0) return <span className="text-amber-600 text-xs">no snap</span>;
    return <span className="text-emerald-600 text-xs font-medium">✓ clean</span>;
  };

  const copyClean = useCallback(async () => {
    try { await navigator.clipboard.writeText(cleanDomains.join("\n")); } catch { /* ignore */ }
    toast(`✅ Copy ${cleanDomains.length} domain Clean`);
  }, [cleanDomains, toast]);

  const Stat = ({ l, v, c }: { l: string; v: number; c?: string }) => (
    <div className="rounded-lg border px-3 py-2"><p className="text-[11px] text-muted-foreground uppercase">{l}</p><p className={cn("text-xl font-bold", c)}>{v}</p></div>
  );

  return (
    <div className="flex flex-col gap-5 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Domain Picker</h1>
        <p className="text-sm text-muted-foreground mt-1">Pipeline tự động: nhập → lọc mới → mua được?+giá (≤${MAX_PRICE}) → Wayback → gửi Clean qua DataForSEO (N8N).</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-1 flex-wrap">
        {STEPS.map((s, i) => {
          const reachable = s.id <= step || done.has(s.id);
          const active = s.id === step && running;
          return (
            <React.Fragment key={s.id}>
              <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-md text-sm",
                s.id === step ? "bg-foreground text-background font-medium" : done.has(s.id) ? "text-emerald-700" : "text-muted-foreground")}>
                <span className={cn("h-5 w-5 rounded-full grid place-items-center text-xs border",
                  s.id === step ? "border-background" : done.has(s.id) ? "bg-emerald-600 text-white border-emerald-600" : "border-current")}>
                  {active ? <Loader2 className="h-3 w-3 animate-spin" /> : done.has(s.id) ? "✓" : s.id}
                </span>
                {s.label}
              </div>
              {i < STEPS.length - 1 && <span className="text-muted-foreground">›</span>}
            </React.Fragment>
          );
        })}
        <Button size="sm" variant="ghost" onClick={reset} className="ml-auto gap-1.5 text-xs"><RotateCcw className="h-3.5 w-3.5" />Làm lại</Button>
      </div>

      {/* Bước 1: input + chạy */}
      {step === 1 && (
        <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
          <p className="text-sm font-medium">Dán hoặc upload danh sách domain (Spamzilla export / text)</p>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={9}
            placeholder={"example.org\nanother-domain.com\n… mỗi dòng 1 domain"}
            className="w-full rounded-md border border-input bg-background p-3 text-sm font-mono" />
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(e) => onFile(e.target.files?.[0] ?? null)} className="hidden" />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} className="gap-1.5"><Upload className="h-4 w-4" />Upload Spamzilla / file</Button>
            <span className="text-xs text-muted-foreground">{parseDomains(pasteText).length} domain</span>
            <Button size="sm" onClick={runPipeline} disabled={!parseDomains(pasteText).length || running} className="ml-auto gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}Chạy pipeline
            </Button>
          </div>
        </div>
      )}

      {/* Panel tiến trình (step ≥ 2) */}
      {step >= 2 && (
        <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Tiến trình pipeline</p>
            {running && <span className="text-xs text-blue-600 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />đang chạy…</span>}
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            <Stat l="Nhập" v={raw.length} />
            <Stat l="Đã xử lý (loại)" v={b2.bought.length + b2.flagged.length + b2.nosnap.length + b2.checked.length} c="text-rose-600" />
            <Stat l="✨ Mới" v={afterExclude.length} c="text-emerald-600" />
            <Stat l={`≤$${MAX_PRICE} (Wayback)`} v={gated.length} c="text-sky-600" />
            <Stat l="✓ Clean" v={wbStats.clean} c="text-emerald-600" />
            <Stat l="Gửi DFS" v={webhookStatus === "ok" ? cleanDomains.length : 0} c="text-violet-600" />
          </div>
          <p className="text-[11px] text-muted-foreground">Loại B2: đã mua {b2.bought.length} · flagged {b2.flagged.length} · no-snap {b2.nosnap.length} · đã check {b2.checked.length}. Gate ≤${MAX_PRICE}: loại {afterExclude.length - gated.length}. Wayback: flagged {wbStats.flagged} · no-snap {wbStats.nosnap} · đang chạy {wbStats.pending}.</p>

          {step === 5 && (
            <div className="rounded-lg border bg-muted/30 p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm">
                {webhookStatus === "sending" && <><Loader2 className="h-4 w-4 animate-spin text-blue-600" />Đang gửi {cleanDomains.length} domain Clean tới N8N…</>}
                {webhookStatus === "ok" && <span className="text-emerald-700 font-medium">✅ {webhookMsg}</span>}
                {webhookStatus === "error" && <span className="text-rose-600">⚠️ Webhook lỗi: {webhookMsg}. Cấu hình URL trong Cài đặt, hoặc Copy thủ công.</span>}
                {webhookStatus === "idle" && <span className="text-muted-foreground">Không có domain Clean.</span>}
              </div>
              {cleanDomains.length > 0 && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={copyClean} className="gap-1.5"><Copy className="h-3.5 w-3.5" />Copy {cleanDomains.length} Clean</Button>
                  <Button size="sm" variant="outline" onClick={() => sendWebhook(cleanDomains)} disabled={webhookStatus === "sending"} className="gap-1.5"><Send className="h-3.5 w-3.5" />Gửi lại webhook</Button>
                  <Button size="sm" onClick={() => { setDone((p) => new Set(p).add(5)); setStep(6); }} className="ml-auto gap-1.5 bg-foreground text-background">→ Đáng mua (Bước 6)</Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bước 6 — Đáng mua */}
      {step === 6 && (
        <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">Bước 6 — Domain đáng mua (Tốt + Trung bình)</p>
            <input ref={resultFileRef} type="file" accept=".csv,text/csv" onChange={(e) => uploadResult(e.target.files?.[0] ?? null)} className="hidden" />
            <Button size="sm" variant="outline" onClick={() => resultFileRef.current?.click()} disabled={uploadingResult} className="ml-auto gap-1.5 h-8">
              {uploadingResult ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}Upload kết quả Ahrefs/DFS
            </Button>
            <Button size="sm" variant="outline" onClick={() => loadRatings(cleanDomains)} disabled={loadingRatings} className="gap-1.5 h-8">
              {loadingRatings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Lấy lại
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">N8N chạy DataForSEO xong POST rating về <code>/api/n8n/ingest-rating</code> → Bước 6 <b>tự lấy (poll 15s)</b>. Hoặc Upload file kết quả thủ công.</p>

          {buyNote && <div className={cn("rounded-md px-3 py-2 text-sm border", buyNote.ok ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-300")}>{buyNote.msg}</div>}

          {buyList.length === 0 ? (
            <div className="py-4 text-center text-sm flex items-center justify-center gap-2">
              {cleanDomains.length === 0 ? (
                <span className="text-muted-foreground">Chưa có domain — chạy pipeline hoặc upload file kết quả.</span>
              ) : cleanDomains.some((d) => !(d in ratings)) ? (
                pollExhausted ? (
                  <span className="text-rose-600">{`Hết thời gian chờ — còn ${cleanDomains.filter((d) => !(d in ratings)).length}/${cleanDomains.length} domain chưa có kết quả. Kiểm tra N8N (node Ingest Rating) rồi bấm "Lấy lại".`}</span>
                ) : (
                  <><Loader2 className="h-4 w-4 animate-spin text-blue-600" /><span className="text-muted-foreground">{`Đang chờ kết quả DataForSEO từ N8N: còn ${cleanDomains.filter((d) => !(d in ratings)).length}/${cleanDomains.length} domain (tự cập nhật mỗi 15s)…`}</span></>
                )
              ) : (
                <span className="text-amber-600">Đã nhận kết quả tất cả {cleanDomains.length} domain — <b>0 domain đáng mua</b> (đều Rủi Ro / không đạt Tốt+Trung bình).</span>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={selectedBuy.size === buyList.length && buyList.length > 0} onChange={(e) => setSelectedBuy(e.target.checked ? new Set(buyList) : new Set())} />
                  All ({buyList.length})
                </label>
                <Button size="sm" disabled={buying || selectedBuy.size === 0} onClick={() => buyDomains(Array.from(selectedBuy))} className="ml-auto gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
                  {buying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}Mua đã chọn ({selectedBuy.size})
                </Button>
              </div>
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr><th className="px-3 py-2 w-8"></th><th className="px-3 py-2">Domain</th><th className="px-3 py-2">Rating</th><th className="px-3 py-2">Giá</th></tr>
                  </thead>
                  <tbody>
                    {buyList.map((d) => (
                      <tr key={d} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-1.5"><input type="checkbox" checked={selectedBuy.has(d)} onChange={() => setSelectedBuy((p) => { const n = new Set(p); if (n.has(d)) n.delete(d); else n.add(d); return n; })} /></td>
                        <td className="px-3 py-1.5 font-medium"><a href={`https://${d}`} target="_blank" rel="noreferrer" className="hover:underline">{d}</a></td>
                        <td className="px-3 py-1.5 text-xs">{(ratings[d] ?? "").includes("TỐT") ? <span className="text-emerald-700 font-medium">✅ TỐT</span> : <span className="text-amber-600">⚠️ TRUNG BÌNH</span>}</td>
                        <td className="px-3 py-1.5 tabular-nums text-xs">{priceStr(d)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-amber-600">⚠️ &quot;Mua&quot; gọi Gname API thật (trừ tiền). Cần chạy nơi IP đã whitelist (VPS). Không đủ tiền → có cảnh báo.</p>
            </>
          )}
        </div>
      )}

      {/* Bảng domain (step ≥ 3) */}
      {step >= 3 && afterExclude.length > 0 && (
        <div className="rounded-xl border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Domain</th>
                <th className="px-3 py-2">Mua được?</th>
                <th className="px-3 py-2">Giá (≤${MAX_PRICE})</th>
                <th className="px-3 py-2">Wayback</th>
              </tr>
            </thead>
            <tbody>
              {afterExclude.map((d) => {
                const passedGate = gated.includes(d);
                return (
                  <tr key={d} className={cn("border-b last:border-0", !passedGate && step >= 4 ? "opacity-40" : "hover:bg-muted/30")}>
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

      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
        {toasts.map((t) => (<div key={t.id} className={cn("rounded-md px-4 py-2 text-sm shadow-lg", t.err ? "bg-rose-600 text-white" : "bg-foreground text-background")}>{t.msg}</div>))}
      </div>
    </div>
  );
}
