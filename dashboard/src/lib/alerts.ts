/**
 * Cảnh báo Telegram cho pipeline chạy không người trông (mỗi đợt quét vài k–vài chục k
 * domain, vài tháng mới quay lại). Gọi cuối mỗi tick (wayback-dispatch):
 *   - tick đầy đủ (20'): sắp hết tiền / Wayback tạm dừng / key lỗi / VPS sắp hết hạn / đợt quét xong
 *   - tick nhẹ (5'): tick đầy đủ ngừng chạy (heartbeat cũ)
 * Chống spam: chỉ gửi khi cảnh báo MỚI bật hoặc nhắc lại sau REMIND_H; hết lỗi → báo "đã ổn".
 * Container dashboard chết hẳn thì app không tự báo được → reconcile-tick.sh trên VPS báo thay.
 */

import { readOps, writeOps, type AlertMark } from "./ops-settings";
import { sendTelegram, vnTime } from "./telegram";
import { computeReadiness } from "./campaign-readiness";
import { isTickHealthy, TICK_STALE_MINUTES, type ReconcileState } from "./pipeline-status";

const REMIND_H = 12;
const DASH = "https://domaindata.project896.com";

// Ngưỡng — chọn theo tốc độ chi hiện tại (~$150/ngày Apify+OpenAI khi Wayback chạy hết công suất).
export const ALERT_THRESHOLDS = {
  apifyUsd: 30,          // ≈ 5 giờ chạy
  dfsUsd: 5,
  ahrefsUnits: 100_000,  // ≈ 330 domain chấm rating
  vpsDays: 5,
};

interface Cond { key: string; active: boolean; msg: string; okMsg: string }

async function evaluate(state: ReconcileState, kind: "full" | "light"): Promise<Cond[]> {
  if (kind === "light") {
    const ageMin = state.lastTickAt ? Math.round((Date.now() - Date.parse(state.lastTickAt)) / 60000) : null;
    return [{
      key: "tick_stale", active: !isTickHealthy(state),
      msg: `🔴 Tick đầy đủ của pipeline đã ngừng ${ageMin ?? "?"} phút (ngưỡng ${TICK_STALE_MINUTES}'). Rating + Gname đang không chạy — kiểm tra cron /root/reconcile-tick.sh trên VPS.`,
      okMsg: "✅ Tick đầy đủ của pipeline chạy lại bình thường.",
    }];
  }

  const r = await computeReadiness(0);
  const T = ALERT_THRESHOLDS;
  const conds: Cond[] = [
    {
      key: "wayback_paused", active: !!state.waybackPaused,
      msg: state.waybackPaused === "apify_credit"
        ? "🔴 Wayback ĐANG DỪNG: Apify hết credit. Nạp tại https://console.apify.com/billing (hoặc thêm tài khoản Apify khác trong Cài đặt)."
        : "🔴 Wayback ĐANG DỪNG: OpenAI hết credit / key lỗi. Nạp tại https://platform.openai.com/settings/organization/billing/overview",
      okMsg: "✅ Wayback chạy lại bình thường.",
    },
    {
      key: "apify_low", active: r.raw.apifyRemainingUsd != null && r.raw.apifyRemainingUsd < T.apifyUsd,
      msg: `🟠 Apify sắp hết: còn $${r.raw.apifyRemainingUsd?.toFixed(2)} (≈ vài giờ chạy). Nạp tại https://console.apify.com/billing`,
      okMsg: "✅ Apify đã đủ credit.",
    },
    {
      key: "openai_bad", active: r.raw.openaiOk === false,
      msg: `🔴 OpenAI không dùng được (${r.checks.find((c) => c.key === "openai")?.detail}). Chấm rating + Wayback sẽ dừng. Nạp/kiểm tra key tại https://platform.openai.com/settings/organization/billing/overview`,
      okMsg: "✅ OpenAI key dùng lại được.",
    },
    {
      key: "ahrefs_low", active: r.raw.ahrefsRemainingUnits != null && r.raw.ahrefsRemainingUnits < T.ahrefsUnits,
      msg: `🟠 Ahrefs còn ${Math.round(r.raw.ahrefsRemainingUnits ?? 0).toLocaleString("en-US")} unit — sắp chuyển sang DataForSEO (tốn tiền ~$0,03/domain).`,
      okMsg: "✅ Ahrefs đã đủ unit.",
    },
    {
      key: "dfs_low", active: r.raw.dfsBalanceUsd != null && r.raw.dfsBalanceUsd < T.dfsUsd,
      msg: `🟠 DataForSEO còn $${r.raw.dfsBalanceUsd?.toFixed(2)} — dự phòng chấm rating sắp hết.`,
      okMsg: "✅ DataForSEO đã đủ số dư.",
    },
    {
      key: "gname_bad", active: r.raw.gnameOk === false,
      msg: `🔴 Gname không kết nối được (${r.checks.find((c) => c.key === "gname")?.detail}). Nếu vừa đổi IP VPS: thêm IP mới vào whitelist API trên Gname.`,
      okMsg: "✅ Gname kết nối lại được.",
    },
    {
      key: "vps_expiry", active: r.raw.vpsDaysLeft != null && r.raw.vpsDaysLeft <= T.vpsDays,
      msg: `🟠 VPS còn ${r.raw.vpsDaysLeft} ngày là hết hạn — gia hạn trên panel nhà cung cấp, rồi cập nhật ngày mới ở trang Chuẩn bị đợt quét.`,
      okMsg: "✅ VPS đã gia hạn.",
    },
  ];
  return conds;
}

/** Không ném lỗi — cảnh báo hỏng không được làm hỏng tick. */
export async function runAlerts(state: ReconcileState, kind: "full" | "light", extra?: { buyable72h?: number }): Promise<void> {
  try {
    const ops = await readOps();
    if (!ops.telegramBotToken || !ops.telegramChatId) return;
    const conds = await evaluate(state, kind);
    const alerts: Record<string, AlertMark> = { ...ops.alerts };
    const now = new Date();
    const lines: string[] = [];

    for (const c of conds) {
      const prev = alerts[c.key];
      if (c.active) {
        const due = !prev?.active || !prev.sentAt || now.getTime() - Date.parse(prev.sentAt) > REMIND_H * 3600_000;
        if (due) { lines.push(c.msg); alerts[c.key] = { active: true, sentAt: now.toISOString(), msg: c.msg }; }
      } else if (prev?.active) {
        lines.push(c.okMsg);
        alerts[c.key] = { active: false, sentAt: now.toISOString(), msg: c.okMsg };
      }
    }

    // Đợt quét xong (chỉ tick đầy đủ): hàng chờ Wayback + rating về 0 → báo 1 lần.
    let campaignDone = ops.campaignDone;
    if (kind === "full") {
      const empty = state.backlog.wayback === 0 && state.backlog.rating === 0;
      if (empty && !campaignDone) {
        lines.push(`🎉 Đợt quét đã xong: hết domain chờ Wayback + chấm rating.${extra?.buyable72h != null ? ` ${extra.buyable72h} domain đáng mua (72h).` : ""} Xem Domain Picker → "Khôi phục từ DB". Nên giảm/tạm ngưng các gói trả theo tháng nếu chưa chạy đợt mới.`);
        campaignDone = true;
      } else if (!empty && campaignDone) {
        campaignDone = false;
      }
    }

    if (!lines.length && campaignDone === ops.campaignDone) return;
    if (lines.length) {
      const text = `<b>DomainData · ${vnTime(now)}</b>\n\n${lines.join("\n\n")}\n\n${DASH}/campaign`;
      const sent = await sendTelegram(ops.telegramBotToken, ops.telegramChatId, text);
      if (!sent.ok) { console.error("[alerts] telegram:", sent.error); return; }   // gửi lỗi → không đánh dấu, tick sau thử lại
    }
    await writeOps({ alerts, campaignDone });
  } catch (e) {
    console.error("[alerts]", e instanceof Error ? e.message : e);
  }
}
