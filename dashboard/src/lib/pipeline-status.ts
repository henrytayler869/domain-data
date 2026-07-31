/**
 * Heartbeat + backlog của bộ điều phối tự lành (reconciler).
 *
 * Lưu 1 record JSON trong app_settings (key="pipeline_reconcile") — mỗi tick của
 * dispatchTick() ghi lại: chạy lúc nào, còn tồn đọng bao nhiêu ở mỗi tầng
 * (rating/gname/wayback), tình trạng credit, và tick đã làm gì. Webapp đọc để
 * hiện bảng theo dõi + cảnh báo khi tick ngừng chạy (chống "quên").
 *
 * Không cần DDL: app_settings là bảng key/value jsonb dùng chung (xem settings.ts).
 */

import { supabase } from "./supabase";

const TABLE = "app_settings";
const KEY = "pipeline_reconcile";

// Tick chạy mỗi ~20-30' (N8N Schedule). Quá 2× ngưỡng này mà không có tick mới →
// coi như bộ điều phối đã dừng → cảnh báo đỏ trên webapp.
export const TICK_STALE_MINUTES = 75;

export type CreditFlag =
  | "flowing"        // rating thật đang về → credit OK
  | "waiting_credit" // đã gửi mà 1h qua 0 rating về → credit nhiều khả năng hết
  | "unknown"        // chưa đủ dữ liệu để kết luận
  | "idle";          // không có gì cần rating

export interface ReconcileBacklog {
  rating: number;    // domain chưa có rating thật (đang chờ credit / đang gửi)
  gname: number;     // domain rated-good chưa check Gname
  wayback: number;   // domain mua được chưa check Wayback
}

export interface ReconcileState {
  lastTickAt: string | null;      // ISO — tick gần nhất chạy xong
  tookMs: number;                 // thời lượng tick gần nhất
  backlog: ReconcileBacklog;
  creditFlag: CreditFlag;
  lastRatingSendAt: string | null;// lần cuối gửi domain qua N8N để rating
  lastGnameJobId: string | null;  // gate job Gname gần nhất reconciler kick off
  // Tóm tắt hành động tick gần nhất (để hiển thị / debug).
  last: {
    ratingReArmed: number;        // placeholder cũ được gửi lại
    ratingSent: number;           // tổng domain gửi rating tick này
    ratingProbe: boolean;         // tick này chỉ gửi probe (nghi hết credit)
    gnameKicked: number;          // domain đẩy vào gate job Gname
    waybackDispatched: number;    // domain tạo Wayback run mới
    ingestedResults: number;      // kết quả Wayback thu về
  };
}

const EMPTY: ReconcileState = {
  lastTickAt: null,
  tookMs: 0,
  backlog: { rating: 0, gname: 0, wayback: 0 },
  creditFlag: "unknown",
  lastRatingSendAt: null,
  lastGnameJobId: null,
  last: { ratingReArmed: 0, ratingSent: 0, ratingProbe: false, gnameKicked: 0, waybackDispatched: 0, ingestedResults: 0 },
};

export async function readReconcileState(): Promise<ReconcileState> {
  try {
    const sb = supabase();
    const { data, error } = await sb.from(TABLE).select("value").eq("key", KEY).maybeSingle();
    if (error) throw new Error(error.message);
    const v = (data?.value ?? null) as Partial<ReconcileState> | null;
    if (!v) return { ...EMPTY };
    return {
      ...EMPTY,
      ...v,
      backlog: { ...EMPTY.backlog, ...(v.backlog ?? {}) },
      last: { ...EMPTY.last, ...(v.last ?? {}) },
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function writeReconcileState(state: ReconcileState): Promise<void> {
  const sb = supabase();
  const { error } = await sb
    .from(TABLE)
    .upsert({ key: KEY, value: state, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/** Tick có còn "sống" không (chạy trong TICK_STALE_MINUTES gần đây). */
export function isTickHealthy(state: ReconcileState, now = Date.now()): boolean {
  if (!state.lastTickAt) return false;
  const age = now - new Date(state.lastTickAt).getTime();
  return age <= TICK_STALE_MINUTES * 60 * 1000;
}
