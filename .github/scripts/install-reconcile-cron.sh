#!/usr/bin/env bash
# Cài "nhịp tim" cho bộ điều phối tự lành bằng NATIVE VPS cron.
# Chạy TRÊN VPS (được pipe qua `ssh ... bash -s`). Idempotent — chạy lại an toàn.
#
# Tick gọi /api/n8n/wayback-dispatch TỪ BÊN TRONG container dashboard:
#   - dùng N8N_API_TOKEN + PORT sẵn có trong container (không cần biết/không lộ token)
#   - hit http://127.0.0.1 → bỏ qua Cloudflare hoàn toàn
# Cron của user (không cần sudo; VPS_USER đã ở docker group để chạy docker).
set -euo pipefail

TICK="$HOME/reconcile-tick.sh"

cat > "$TICK" <<'OUTER_EOF'
#!/usr/bin/env bash
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
# Tham số 1 = "wayback" → tick NHẸ (chỉ sweep + nạp slot Wayback); bỏ trống → tick đầy đủ.
QS=""; [ "${1:-}" = "wayback" ] && QS="?only=wayback"

# Tick lỗi (container chết / HTTP lỗi) → app không tự báo được → báo Telegram từ VPS.
# Cần /root/telegram.env (TG_TOKEN=..., TG_CHAT=...). Tối đa 1 tin / 3 giờ.
notify_fail() {
  local ENVF="$HOME/telegram.env" STAMP="$HOME/.tick-fail-notified"
  [ -f "$ENVF" ] || return 0
  # shellcheck disable=SC1090
  . "$ENVF"
  [ -n "${TG_TOKEN:-}" ] && [ -n "${TG_CHAT:-}" ] || return 0
  if [ -f "$STAMP" ] && [ $(( $(date +%s) - $(stat -c %Y "$STAMP") )) -lt 10800 ]; then return 0; fi
  touch "$STAMP"
  curl -s -m 15 "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TG_CHAT}" \
    --data-urlencode "text=🔴 DomainData: tick pipeline LỖI trên VPS ($1). Dashboard có thể đã sập — kiểm tra: cd /opt/n8n && docker compose ps" >/dev/null || true
}

CID="$(cd /opt/n8n && docker compose ps -q dashboard)"
[ -n "$CID" ] || { echo "$(date -Is) ERROR: dashboard container not found"; notify_fail "container dashboard không chạy"; exit 1; }
trap 'notify_fail "gọi /api/n8n/wayback-dispatch thất bại"' ERR
docker exec -i -e TICK_QS="$QS" "$CID" node <<'NODE'
const port = process.env.PORT || 3000;
const token = process.env.N8N_API_TOKEN;
if (!token) { console.error("ERROR: no N8N_API_TOKEN in container"); process.exit(1); }
fetch("http://127.0.0.1:" + port + "/api/n8n/wayback-dispatch" + (process.env.TICK_QS || ""), {
  method: "POST",
  headers: { Authorization: "Bearer " + token },
})
  .then(async (r) => { console.log(new Date().toISOString(), "HTTP", r.status, await r.text()); if (!r.ok) process.exit(1); })
  .catch((e) => { console.error(new Date().toISOString(), String(e)); process.exit(1); });
NODE
OUTER_EOF
chmod +x "$TICK"

# Crontab của user: tick đầy đủ mỗi 20' (khớp ngưỡng heartbeat 75') + tick nhẹ Wayback
# mỗi 5' ở các phút LỆCH tick đầy đủ (không chạy chồng → không gửi trùng / vượt cap slot).
# Xoá dòng cũ rồi thêm lại.
# Lưu ý: `crontab -l` trả exit 1 khi user CHƯA có crontab → phải bọc `|| true` để
# không bị set -e/pipefail giết trước khi cài.
EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$EXISTING" | grep -v 'reconcile-tick.sh' || true)"
{ printf '%s\n' "$FILTERED"
  echo "*/20 * * * * $TICK >> $HOME/reconcile-tick.log 2>&1"
  echo "5,10,15,25,30,35,45,50,55 * * * * $TICK wayback >> $HOME/reconcile-tick-wayback.log 2>&1"
} | crontab -

echo "=== crontab đã cài ==="
crontab -l | grep 'reconcile-tick.sh' || { echo "ERROR: cron chưa vào"; exit 1; }

echo "=== chạy thử 1 lần ngay ==="
if "$TICK"; then echo "=== tick OK ==="; else echo "=== tick FAILED (xem output trên) ==="; exit 1; fi
