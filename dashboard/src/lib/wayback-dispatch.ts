/**
 * Một "tick" của BỘ ĐIỀU PHỐI TỰ LÀNH (self-healing reconciler) — gọi định kỳ
 * (N8N Schedule mỗi ~20-30 phút → POST /api/n8n/wayback-dispatch), KHÔNG cần tab
 * mở. Mỗi tick đối soát trạng thái từng domain và chỉ chạy BƯỚC CÒN THIẾU:
 *
 *   1. SWEEP     — poll+ingest mọi Wayback run pending (nhả slot Apify).
 *   2. RATING    — gửi domain CHƯA có rating thật qua N8N (Fla→Kelly→DFS).
 *                  RE-ARM placeholder cũ (>45') → chống mất domain khi hết credit;
 *                  CREDIT-AWARE: nếu 1h qua 0 rating về → chỉ gửi probe nhỏ để dò
 *                  credit về, không blast cả backlog.
 *   3. GNAME     — domain rated-good CHƯA check Gname → kick gate job nền (webapp
 *                  đã whitelist IP; check chạy ở đây được, máy khác thì không).
 *   4. WAYBACK   — tạo Wayback run cho domain available(≤$26) chưa check, lấp đầy
 *                  tới CAP (30) slot Apify còn trống.
 *   5. HEARTBEAT — ghi tồn đọng + thời điểm chạy vào app_settings để webapp hiện
 *                  bảng theo dõi + cảnh báo nếu tick ngừng (chống "quên").
 *
 * Idempotent: bước đã có dữ liệu (rating thật / gname_check mới / wayback_result)
 * đều bị bỏ qua. An toàn khi gọi lặp lại.
 */

import { supabase } from "./supabase";
import { readGnamePricing } from "./gname-pricing";
import { listPendingRuns, createRun } from "./wayback-db";
import { pollAndIngestRun } from "./wayback-poll";
import { startWaybackRun, countActiveRuns } from "./apify-wayback";
import { upsertAssessments } from "./ahrefs-db";
import { readSettings, ensureUsableApifyAccount } from "./settings";
import { startGateJob } from "./gname-gate";
import { readReconcileState, writeReconcileState, type CreditFlag, type ReconcileState } from "./pipeline-status";

const CAP = 40;                 // ≤40 concurrent. Apify cho 128 NHƯNG mỗi run xong reconciler
// phải poll + ingest JSONB nặng (content_history/problematic) → CAP=100 dồn nhiều giờ làm
// NGHẼN Supabase (readAll Kho 2,3s→83s, query treo). 40 = throughput khá hơn 30 mà DB thở được.
// Quét SÂU (maxSnapshots cao) → 1 run nặng hơn nhiều → phải chia batch NHỎ để không
// bị Apify timeout. Batch=50 sâu sẽ timeout; batch nhỏ + retry đảm bảo mọi domain xong.
const BATCH = 5;                // domain / Wayback run (deep → nhỏ). Retry → batch=1.
const WB_MAX_ATTEMPTS = 6;      // fail quá số lần → tạm bỏ (log) tránh loop vô hạn
const WB_FAIL_WINDOW_H = 48;    // cửa sổ đếm run fail để retry
const MAX_PRICE = 26;
const AVAIL_WINDOW_H = 24;      // available cache còn hạn

// ── Rating (RE-ARM + credit-aware) ────────────────────────────────────────────
const RATING_BATCH = 140;       // domain / lần gửi N8N khi credit OK
const RATING_REARM_MIN = 45;    // placeholder cũ hơn ngần này → gửi lại (chống mất)
const RATING_PROBE = 15;        // khi nghi hết credit: chỉ gửi bấy nhiêu để dò
const CREDIT_SENT_COOLDOWN_MIN = 90; // "đã gửi gần đây" để suy đoán credit

// ── Gname backfill ────────────────────────────────────────────────────────────
const GNAME_JOB_CAP = 500;      // domain / gate job mỗi tick
const GNAME_TTL_H = 24;         // gname_check còn hạn → khỏi check lại

const tldOf = (d: string) => d.split(".").pop() ?? "";
const isGoodRating = (r: string | null) => !!r && (r.includes("TỐT") || r.includes("TRUNG BÌNH"));

// Phân trang 1 query PostgREST (query đã build sẵn bởi caller) — trả tối đa 1000 dòng.
async function pageAll<T>(build: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> }): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data as T[] | null) ?? [];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export interface DispatchSummary {
  ingestedRuns: number;
  ingestedResults: number;
  // rating
  ratingBacklog: number;
  ratingReArmed: number;
  ratingSent: number;
  ratingProbe: boolean;
  creditFlag: CreditFlag;
  // gname
  gnameBacklog: number;
  gnameKicked: number;
  gnameJobId: string | null;
  // wayback
  dispatched: number;
  dispatchedDomains: number;
  remainingToWayback: number;
  waybackRetried: number;    // domain gửi lại (đã từng fail)
  waybackGivenUp: number;    // fail ≥ WB_MAX_ATTEMPTS → tạm bỏ (soi tay)
  activeAfter: number;
  apifySwitched: boolean;    // tick này có tự đổi account Apify (hết credit) không
  apifyNote: string | null;  // mô tả nếu đổi / tất cả hết credit
}

export async function dispatchTick(): Promise<DispatchSummary> {
  const startedAt = Date.now();
  const sb = supabase();
  const prev = await readReconcileState();
  const { n8nWebhookUrl } = await readSettings();

  // ── 1. SWEEP ────────────────────────────────────────────────────────────────
  const pending = await listPendingRuns();
  let ingestedRuns = 0, ingestedResults = 0;
  {
    let cursor = 0;
    const CONC = 5;
    const worker = async () => {
      while (cursor < pending.length) {
        const r = pending[cursor++];
        try { const res = await pollAndIngestRun(r.runId); if (res.ingested) { ingestedRuns++; ingestedResults += res.ingested.count; } } catch { /* ignore */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, pending.length || 1) }, () => worker()));
  }

  // ── Dữ liệu dùng chung ───────────────────────────────────────────────────────
  const pricingRows = await readGnamePricing();
  const price: Record<string, number | null> = {};
  for (const p of pricingRows) price[String(p.tld).toLowerCase()] = p.register;
  const availCutoff = new Date(Date.now() - AVAIL_WINDOW_H * 3600 * 1000).toISOString();

  const gnameRows = await pageAll<{ domain: string; status: string; drop_eta: string | null }>(
    () => sb.from("gname_checks").select("domain,status,drop_eta").in("status", ["available", "backorder"]).gte("checked_at", availCutoff),
  );
  const acquirable = new Map<string, { status: string; dropEta: string | null }>();
  for (const r of gnameRows) acquirable.set(String(r.domain).toLowerCase(), { status: r.status, dropEta: r.drop_eta });

  const wbRows = await pageAll<{ target_domain: string; snapshot_count: number | null; has_betting: boolean | null; has_adult: boolean | null }>(
    () => sb.from("wayback_results").select("target_domain,snapshot_count,has_betting,has_adult"),
  );
  const checked = new Set<string>();
  const clean = new Set<string>();
  for (const r of wbRows) {
    const d = String(r.target_domain).toLowerCase();
    checked.add(d);
    if (!r.has_betting && !r.has_adult && (r.snapshot_count ?? 0) > 0) clean.add(d);
  }

  // ── 2. RATING (re-arm + credit-aware) ─────────────────────────────────────────
  const rating = await ratingBackfill(clean, acquirable, n8nWebhookUrl, prev);

  // ── 3. GNAME backfill (rated-good chưa check + domain chờ Wayback → re-check) ──
  const gname = await gnameBackfill(checked);

  // ── 4. DISPATCH Wayback (DEEP, batch nhỏ, AUTO-RETRY leo thang) ───────────────
  // "Mọi domain phải có kết quả quét sâu" → run TIMED-OUT/FAILED không làm mất domain:
  // domain đó rớt khỏi in-flight (run terminal) → tick sau tự gửi lại, CÔ LẬP batch=1
  // (gần như luôn xong). Cap WB_MAX_ATTEMPTS chống loop nếu actor thực sự không quét được.
  const inFlight = new Set<string>();
  for (const r of pending) for (const t of r.targets) inFlight.add(String(t).toLowerCase());

  // Đếm số lần fail gần đây của mỗi domain (run TIMED-OUT/FAILED/ABORTED).
  const failCounts = new Map<string, number>();
  {
    const since = new Date(Date.now() - WB_FAIL_WINDOW_H * 3600 * 1000).toISOString();
    const failed = await pageAll<{ targets: string[]; status: string }>(
      () => sb.from("wayback_runs").select("targets,status").in("status", ["TIMED-OUT", "FAILED", "ABORTED"]).gte("started_at", since),
    );
    for (const r of failed) for (const t of (r.targets ?? [])) {
      const d = String(t).toLowerCase();
      failCounts.set(d, (failCounts.get(d) ?? 0) + 1);
    }
  }

  const toWayback = [...acquirable.keys()].filter((d) => {
    if (acquirable.get(d)!.status !== "available") return false;
    if (checked.has(d) || inFlight.has(d)) return false;
    const p = price[tldOf(d)];
    return p != null && Number(p) <= MAX_PRICE;
  });
  // Bỏ domain fail quá nhiều (log để soi tay) — KHÔNG coi là clean (không có result).
  const givenUp = toWayback.filter((d) => (failCounts.get(d) ?? 0) >= WB_MAX_ATTEMPTS);
  const dispatchable = toWayback.filter((d) => (failCounts.get(d) ?? 0) < WB_MAX_ATTEMPTS);
  // Đã từng fail → cô lập batch=1 (ưu tiên). Chưa từng → gom batch nhỏ.
  const retryGroups = dispatchable.filter((d) => failCounts.get(d)).map((d) => [d]);
  const fresh = dispatchable.filter((d) => !failCounts.get(d));
  const freshGroups: string[][] = [];
  for (let i = 0; i < fresh.length; i += BATCH) freshGroups.push(fresh.slice(i, i + BATCH));
  const groups = [...retryGroups, ...freshGroups]; // retry trước để không kẹt mãi

  // Tự đổi account Apify nếu account active hết credit / token lỗi (trước khi dispatch)
  const apifySwitch = await ensureUsableApifyAccount();
  const active = await countActiveRuns();
  const maxRuns = Math.max(0, CAP - active);        // mỗi run = 1 slot concurrency
  let dispatched = 0, dispatchedDomains = 0, waybackRetried = 0;
  for (const g of groups.slice(0, maxRuns)) {
    try {
      const run = await startWaybackRun(g);          // DEEP mặc định (maxSnapshots cao)
      await createRun(run.runId, g, run.status, run.datasetId);
      dispatched++; dispatchedDomains += g.length;
      if (g.length === 1 && failCounts.get(g[0])) waybackRetried++;
    } catch { break; }   // đụng limit / lỗi → dừng, để tick sau
  }
  const remainingToWayback = dispatchable.length - dispatchedDomains;

  // ── 5. HEARTBEAT ─────────────────────────────────────────────────────────────
  const state: ReconcileState = {
    lastTickAt: new Date().toISOString(),
    tookMs: Date.now() - startedAt,
    backlog: { rating: rating.backlog, gname: gname.backlog, wayback: remainingToWayback },
    creditFlag: rating.creditFlag,
    lastRatingSendAt: rating.sent > 0 ? new Date().toISOString() : prev.lastRatingSendAt,
    lastGnameJobId: gname.jobId ?? prev.lastGnameJobId,
    last: {
      ratingReArmed: rating.reArmed,
      ratingSent: rating.sent,
      ratingProbe: rating.probe,
      gnameKicked: gname.kicked,
      waybackDispatched: dispatchedDomains,
      ingestedResults,
    },
  };
  await writeReconcileState(state).catch(() => {});

  return {
    ingestedRuns, ingestedResults,
    ratingBacklog: rating.backlog, ratingReArmed: rating.reArmed, ratingSent: rating.sent, ratingProbe: rating.probe, creditFlag: rating.creditFlag,
    gnameBacklog: gname.backlog, gnameKicked: gname.kicked, gnameJobId: gname.jobId,
    dispatched, dispatchedDomains, remainingToWayback,
    waybackRetried, waybackGivenUp: givenUp.length,
    activeAfter: active + dispatched,
    apifySwitched: apifySwitch.switched,
    apifyNote: apifySwitch.switched ? `Tự đổi Apify: ${apifySwitch.from} → ${apifySwitch.to} (${apifySwitch.reason})` : (apifySwitch.reason ?? null),
  };
}

// ─── Stage 2: RATING backfill ────────────────────────────────────────────────
interface RatingResult { backlog: number; reArmed: number; sent: number; probe: boolean; creditFlag: CreditFlag }

async function ratingBackfill(
  clean: Set<string>,
  acquirable: Map<string, { status: string; dropEta: string | null }>,
  n8nWebhookUrl: string,
  prev: ReconcileState,
): Promise<RatingResult> {
  const sb = supabase();
  const now = Date.now();

  // Universe "cần rating" — map domain → updatedAt (chuỗi ISO) hoặc null (chưa có row).
  // (a) Row kẹt trong target_assessment: rating null (placeholder/chưa chấm) HOẶC
  //     category ~ "API error" (chấm lỗi). excluded_at null (chưa bị loại trừ).
  const need = new Map<string, string | null>();
  const noteOldest = (d: string, ts: string | null) => {
    if (!need.has(d)) { need.set(d, ts); return; }
    // giữ updatedAt CŨ nhất (đã chờ lâu nhất) — null (chưa gửi) coi như cũ nhất.
    const cur = need.get(d) ?? null;
    if (cur === null) return;                 // đã là "cũ nhất" → giữ
    if (ts === null) { need.set(d, null); return; }
    if (Date.parse(ts) < Date.parse(cur)) need.set(d, ts);
  };

  // rating=null nhưng LOẠI marker "DataforSEO checked" — marker này nghĩa là domain
  // ĐÃ được DataForSEO check xong, 0 ref đáng giá → cố tình để rating null (đã xử lý
  // dứt điểm, KHÔNG phải kẹt). Gửi lại chúng = churn vô tận + đốt credit. Chỉ giữ
  // placeholder ("DFS pending"), detail null, hoặc detail khác → là domain thật sự
  // chưa/đang chờ rating.
  const nullRating = await pageAll<{ target_domain: string; updated_at: string; detail: string | null }>(
    () => sb.from("target_assessment").select("target_domain,updated_at,detail").is("rating", null).is("excluded_at", null),
  );
  for (const r of nullRating) {
    if ((r.detail ?? "").trim() === "DataforSEO checked") continue;
    noteOldest(String(r.target_domain).toLowerCase(), r.updated_at);
  }

  const apiErr = await pageAll<{ target_domain: string; updated_at: string }>(
    () => sb.from("target_assessment").select("target_domain,updated_at").ilike("category", "%API%error%").is("excluded_at", null),
  );
  for (const r of apiErr) noteOldest(String(r.target_domain).toLowerCase(), r.updated_at);

  // (b) Domain clean+mua-được nhưng CHƯA có rating thật (gồm cả chưa từng gửi).
  //     Đây là "chặng cuối" — domain đã qua Wayback+Gname, chỉ thiếu rating.
  const cleanAcq = [...clean].filter((d) => acquirable.has(d));
  const done = new Set<string>();  // đã rating thật HOẶC marker "DataforSEO checked"
  for (let i = 0; i < cleanAcq.length; i += 300) {
    const slice = cleanAcq.slice(i, i + 300);
    const { data } = await sb.from("target_assessment").select("target_domain,rating,detail").in("target_domain", slice);
    for (const r of (data ?? []) as { target_domain: string; rating: string | null; detail: string | null }[]) {
      if (r.rating || (r.detail ?? "").trim() === "DataforSEO checked") done.add(String(r.target_domain).toLowerCase());
    }
  }
  for (const d of cleanAcq) {
    if (done.has(d)) continue;         // đã có rating thật / đã check xong → bỏ qua
    if (!need.has(d)) need.set(d, null); // chưa từng gửi → cần gửi
  }

  const backlog = need.size;
  if (!backlog) return { backlog: 0, reArmed: 0, sent: 0, probe: false, creditFlag: "idle" };
  if (!n8nWebhookUrl) return { backlog, reArmed: 0, sent: 0, probe: false, creditFlag: "unknown" };

  // Eligible = chưa từng gửi (null) HOẶC placeholder cũ hơn RE-ARM. Sắp xếp cũ→mới
  // để probe xoay vòng qua backlog theo thời gian.
  const rearmCutoff = now - RATING_REARM_MIN * 60 * 1000;
  const eligible = [...need.entries()]
    .filter(([, ts]) => ts === null || Date.parse(ts) < rearmCutoff)
    .sort((a, b) => (a[1] ? Date.parse(a[1]) : 0) - (b[1] ? Date.parse(b[1]) : 0));
  if (!eligible.length) return { backlog, reArmed: 0, sent: 0, probe: false, creditFlag: "unknown" };

  // Credit-aware: có rating THẬT nào về trong 1h qua không?
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const { count } = await sb
    .from("target_assessment")
    .select("*", { count: "exact", head: true })
    .not("rating", "is", null)
    .gte("updated_at", oneHourAgo);
  const realLastHour = count ?? 0;

  const sentRecently = prev.lastRatingSendAt != null && (now - Date.parse(prev.lastRatingSendAt) < CREDIT_SENT_COOLDOWN_MIN * 60 * 1000);
  let creditFlag: CreditFlag;
  let batchSize: number;
  let probe: boolean;
  if (realLastHour === 0 && sentRecently) {
    // Đã gửi gần đây mà 0 rating về → nhiều khả năng hết credit. Chỉ gửi probe nhỏ
    // để phát hiện lúc credit về (không blast cả backlog vô ích).
    creditFlag = "waiting_credit"; batchSize = RATING_PROBE; probe = true;
  } else {
    creditFlag = realLastHour > 0 ? "flowing" : "unknown"; batchSize = RATING_BATCH; probe = false;
  }

  const toSend = eligible.slice(0, batchSize).map(([d]) => d);
  const reArmed = eligible.slice(0, batchSize).filter(([, ts]) => ts !== null).length;

  // Gửi N8N + đánh dấu placeholder (updated_at=now → rời "eligible" 45', probe xoay
  // vòng; ingest-rating ghi đè khi N8N trả rating thật).
  let sent = 0;
  const nowIso = new Date().toISOString();
  for (let i = 0; i < toSend.length; i += RATING_BATCH) {
    const batch = toSend.slice(i, i + RATING_BATCH);
    try {
      const res = await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: batch, source: "reconcile", ts: nowIso }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        await upsertAssessments(batch.map((d) => ({ targetDomain: d, rating: null, category: null, detail: "DFS pending", excludedAt: null })));
        sent += batch.length;
      }
    } catch { /* ignore batch */ }
  }

  return { backlog, reArmed, sent, probe, creditFlag };
}

// ─── Stage 3: GNAME backfill ─────────────────────────────────────────────────
interface GnameResult { backlog: number; kicked: number; jobId: string | null }

async function gnameBackfill(wbChecked: Set<string>): Promise<GnameResult> {
  const sb = supabase();

  // Rated-good (TỐT / TRUNG BÌNH), chưa loại trừ.
  const good = new Set<string>();
  for (const kw of ["%TỐT%", "%TRUNG BÌNH%"]) {
    const rows = await pageAll<{ target_domain: string }>(
      () => sb.from("target_assessment").select("target_domain").ilike("rating", kw).is("excluded_at", null),
    );
    for (const r of rows) good.add(String(r.target_domain).toLowerCase());
  }
  if (!good.size) return { backlog: 0, kicked: 0, jobId: null };
  const goodArr = [...good];

  // Đã mua (domain_inventory) → không cần check Gname.
  const owned = new Set<string>();
  for (const r of await pageAll<{ domain: string }>(() => sb.from("domain_inventory").select("domain"))) {
    owned.add(String(r.domain).toLowerCase());
  }

  // Lần check Gname MỚI NHẤT của mỗi domain rated-good (status + thời điểm).
  const latest = new Map<string, { status: string; checkedAt: string }>();
  for (let i = 0; i < goodArr.length; i += 200) {
    const slice = goodArr.slice(i, i + 200);
    const { data, error } = await sb
      .from("gname_checks").select("domain,status,checked_at").in("domain", slice)
      .order("checked_at", { ascending: false });
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { domain: string; status: string; checked_at: string }[]) {
      const d = String(r.domain).toLowerCase();
      if (!latest.has(d)) latest.set(d, { status: r.status, checkedAt: r.checked_at }); // desc → first = mới nhất
    }
  }

  const staleCutoffMs = Date.now() - GNAME_TTL_H * 3600 * 1000;
  const staleCutoffISO = new Date(staleCutoffMs).toISOString();

  // ── SET 1: rated-good cần check (chưa từng check HOẶC available/backorder quá hạn
  //    24h). Giá trị map = checkedAt (null nếu chưa từng check → ưu tiên trước).
  const need = new Map<string, string | null>();
  for (const d of goodArr) {
    if (owned.has(d)) continue;
    const l = latest.get(d);
    if (!l) { need.set(d, null); continue; }               // chưa từng check
    if ((l.status === "available" || l.status === "backorder") && Date.parse(l.checkedAt) < staleCutoffMs) need.set(d, l.checkedAt);
  }

  // ── SET 2: domain ĐANG CHỜ Wayback — available + gname STALE >24h — BẤT KỂ rating.
  //    Vì pipeline chạy gname→wayback→rating: domain chờ wayback thường CHƯA rating,
  //    không nằm trong SET 1. Re-check để hàng đợi wayback luôn tươi: domain bị đăng
  //    ký thì rớt (khỏi phí wayback), còn available thì ở lại + được scan.
  //    gname_checks upsert 1 dòng/domain → status=available + checked_at<cutoff = latest stale.
  const availStale = await pageAll<{ domain: string; checked_at: string }>(
    () => sb.from("gname_checks").select("domain,checked_at").eq("status", "available").lt("checked_at", staleCutoffISO),
  );
  for (const r of availStale) {
    const d = String(r.domain).toLowerCase();
    if (owned.has(d) || wbChecked.has(d)) continue;        // đã mua / đã scan → khỏi re-check
    if (!need.has(d)) need.set(d, r.checked_at);
  }

  const backlog = need.size;
  if (!backlog) return { backlog: 0, kicked: 0, jobId: null };

  // Không xếp chồng job: nếu đang có gate job chạy (cập nhật trong 10' qua) → chờ.
  const runningCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: runningJobs } = await sb
    .from("gname_gate_jobs").select("id").eq("status", "running").gte("updated_at", runningCutoff).limit(1);
  if (runningJobs && runningJobs.length) return { backlog, kicked: 0, jobId: null };

  // Ưu tiên: chưa từng check (null) trước, rồi CŨ NHẤT trước (sắp rớt khỏi hàng đợi).
  const batch = [...need.entries()]
    .sort((a, b) => (a[1] === null ? 0 : Date.parse(a[1])) - (b[1] === null ? 0 : Date.parse(b[1])))
    .slice(0, GNAME_JOB_CAP)
    .map(([d]) => d);
  const jobId = await startGateJob(batch);
  return { backlog, kicked: batch.length, jobId };
}
