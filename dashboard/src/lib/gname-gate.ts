/**
 * Gate Bước 3 chạy NỀN server-side (table: gname_gate_jobs).
 *
 * Vì check hàng nghìn domain qua Gname tốn ~1-2 tiếng, không thể để chạy trong
 * request HTTP (proxy timeout) hay browser (tab phải mở). Thay vào đó:
 *   startGateJob() tạo 1 job row rồi kick off worker NỀN (fire-and-forget) — vẫn
 *   chạy tiếp sau khi route đã trả jobId. Worker check Gname (concurrency thấp +
 *   cache), cập nhật tiến độ vào job row mỗi ~2s. Browser poll getGateJob() để
 *   hiện progress + nạp domain mua được vào Wayback.
 *
 * Lưu ý: job sống trong tiến trình Node của server (Next standalone = 1 process).
 * Nếu container restart giữa chừng, job "running" sẽ đứng — browser tự phát hiện
 * qua updated_at không nhích (xem picker) và cho chạy lại.
 */

import { supabase } from "./supabase";
import { checkDomain, statusOf, type GnameStatus } from "./gname";
import { readFreshChecks, writeChecks } from "./gname-checks-cache";

const TABLE = "gname_gate_jobs";
const CACHE_TTL_HOURS = 24;   // domain check <24h thì tin cache, không gọi lại
const CONCURRENCY = 3;        // server-side an toàn hơn browser nhưng vẫn né rate-limit Gname
const PACING_MS = 350;        // giãn nhịp giữa các call/worker → giảm rate-limit Gname (như path cũ)
const PERSIST_MS = 2000;      // throttle cập nhật tiến độ

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GateResult {
  available: string[];
  premium: string[];
  backorder: { domain: string; dropEta: string | null }[];
  error: string[];
}

export interface GateJob {
  id: string;
  status: string;             // running | done | error
  total: number;
  checked: number;
  available: number;
  backorder: number;
  registered: number;
  errored: number;
  cached: number;
  result: GateResult;
  errorMsg: string | null;
  createdAt: string;
  updatedAt: string;
}

const EMPTY: GateResult = { available: [], premium: [], backorder: [], error: [] };

// Giữ tham chiếu job đang chạy trong tiến trình (tránh GC lo, và để biết cái nào còn sống).
const running = new Set<string>();

interface DbRow {
  id: string; status: string; total: number; checked: number; available: number;
  backorder: number; registered: number; errored: number; cached: number;
  result: GateResult | null; error_msg: string | null; created_at: string; updated_at: string;
}

function rowToJob(r: DbRow): GateJob {
  const res = r.result && typeof r.result === "object" ? r.result : EMPTY;
  return {
    id: r.id, status: r.status, total: r.total, checked: r.checked, available: r.available,
    backorder: r.backorder, registered: r.registered, errored: r.errored, cached: r.cached,
    result: {
      available: res.available ?? [],
      premium: res.premium ?? [],
      backorder: res.backorder ?? [],
      error: res.error ?? [],
    },
    errorMsg: r.error_msg, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** Tạo job + kick off worker nền. Trả jobId ngay. */
export async function startGateJob(domainsRaw: string[]): Promise<string> {
  const domains = Array.from(new Set(domainsRaw.map((d) => String(d ?? "").toLowerCase().trim()).filter(Boolean)));
  const sb = supabase();
  const { data, error } = await sb
    .from(TABLE)
    .insert({ status: "running", total: domains.length, result: EMPTY })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const jobId = (data as { id: string }).id;

  running.add(jobId);
  void runGate(jobId, domains)
    .catch(async (e) => {
      await sb.from(TABLE).update({
        status: "error",
        error_msg: e instanceof Error ? e.message : String(e),
        updated_at: new Date().toISOString(),
      }).eq("id", jobId).then(() => {}, () => {});
    })
    .finally(() => running.delete(jobId));

  return jobId;
}

export async function getGateJob(jobId: string): Promise<GateJob | null> {
  const sb = supabase();
  const { data, error } = await sb.from(TABLE).select("*").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return rowToJob(data as DbRow);
}

function bucket(result: GateResult, domain: string, status: GnameStatus, dropEta: string | null): "registered" | null {
  if (status === "available") result.available.push(domain);
  else if (status === "premium") result.premium.push(domain);
  else if (status === "backorder") result.backorder.push({ domain, dropEta });
  else if (status === "error") result.error.push(domain);
  else return "registered";   // registered → chỉ đếm, không lưu (đỡ phình jsonb)
  return null;
}

async function runGate(jobId: string, domains: string[]): Promise<void> {
  const sb = supabase();
  const result: GateResult = { available: [], premium: [], backorder: [], error: [] };
  let checked = 0, registered = 0, cachedCount = 0;

  const persist = async (status: "running" | "done") => {
    await sb.from(TABLE).update({
      status,
      checked,
      available: result.available.length,
      backorder: result.backorder.length,
      registered,
      errored: result.error.length,
      cached: cachedCount,
      result,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);
  };

  // 1) Cache: domain đã check gần đây thì dùng luôn, không gọi API.
  const cache = await readFreshChecks(domains, CACHE_TTL_HOURS);
  const toCheck: string[] = [];
  for (const d of domains) {
    const c = cache.get(d);
    if (c) {
      cachedCount++; checked++;
      if (bucket(result, d, c.status, c.dropEta) === "registered") registered++;
    } else {
      toCheck.push(d);
    }
  }
  await persist("running");

  // 2) Check phần còn lại với concurrency + throttle persist + ghi cache theo mẻ.
  const cacheWrites: { domain: string; status: GnameStatus; dropEta: string | null; code: number | null }[] = [];
  let cursor = 0, lastPersist = Date.now();
  const flushCache = async () => {
    if (!cacheWrites.length) return;
    const batch = cacheWrites.splice(0, cacheWrites.length);
    await writeChecks(batch).catch(() => {});
  };
  const worker = async () => {
    while (cursor < toCheck.length) {
      const d = toCheck[cursor++];
      const c = await checkDomain(d);
      const status = statusOf(c);
      if (bucket(result, d, status, c.deletionDate) === "registered") registered++;
      cacheWrites.push({ domain: d, status, dropEta: c.deletionDate, code: c.code });
      checked++;
      if (Date.now() - lastPersist > PERSIST_MS) {
        lastPersist = Date.now();
        await persist("running");
        await flushCache();
      }
      await sleep(PACING_MS);   // giãn nhịp → né rate-limit
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toCheck.length || 1) }, () => worker()));

  await flushCache();
  await persist("done");
}
