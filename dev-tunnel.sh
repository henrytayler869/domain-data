#!/usr/bin/env bash
# Mở SSH tunnel để DEV LOCAL đọc DB VPS (Postgres self-host qua PostgREST).
# Local :8088 → (SSH, mã hoá) → VPS 127.0.0.1:8088 → domaindata-proxy → PostgREST.
#
# Target VPS (user@host) lấy theo thứ tự: tham số 1 > biến VPS_SSH > file .dev-tunnel.env
#   ./dev-tunnel.sh user@host
#   VPS_SSH=user@host ./dev-tunnel.sh
#   echo 'VPS_SSH=user@host' > .dev-tunnel.env   # file này đã gitignore
#
# Sau khi tunnel UP: giữ cửa sổ chạy, để .env.local local trỏ SUPABASE_URL=http://localhost:8088.
set -uo pipefail

LPORT="${LPORT:-8088}"
RPORT="${RPORT:-8088}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# 1) Xác định target VPS
TARGET="${1:-${VPS_SSH:-}}"
if [ -z "$TARGET" ] && [ -f "$HERE/.dev-tunnel.env" ]; then
  # shellcheck disable=SC1091
  . "$HERE/.dev-tunnel.env"
  TARGET="${VPS_SSH:-}"
fi
if [ -z "$TARGET" ]; then
  echo "❌ Chưa biết VPS (user@host). Chọn 1 cách:"
  echo "   ./dev-tunnel.sh user@host"
  echo "   VPS_SSH=user@host ./dev-tunnel.sh"
  echo "   echo 'VPS_SSH=user@host' > $HERE/.dev-tunnel.env   (đã gitignore)"
  exit 1
fi

# 2) Đã chạy sẵn? (Caddy proxy trả 'domaindata proxy' 200 ở '/', không cần key)
probe() { curl -s -o /dev/null -w '%{http_code}' --max-time 4 "http://localhost:$LPORT/" 2>/dev/null || echo 000; }
if command -v curl >/dev/null 2>&1 && [ "$(probe)" != "000" ]; then
  echo "✅ localhost:$LPORT đã phản hồi — tunnel có vẻ đang chạy rồi. Không mở thêm."
  exit 0
fi

echo "🔌 Mở tunnel  localhost:$LPORT → $TARGET → (VPS) 127.0.0.1:$RPORT"
SSH_OPTS=(-N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -L "127.0.0.1:$LPORT:localhost:$RPORT")

# 3) autossh (tự reconnect) nếu có, else ssh thường
if command -v autossh >/dev/null 2>&1; then
  echo "▶ autossh — tự kết nối lại khi rớt. Ctrl+C để dừng."
  exec autossh -M 0 "${SSH_OPTS[@]}" "$TARGET"
fi

echo "▶ ssh — rớt mạng thì chạy lại script. Ctrl+C để dừng."
ssh "${SSH_OPTS[@]}" "$TARGET" &
PID=$!
trap 'kill "$PID" 2>/dev/null; echo; echo "🛑 Tunnel đã đóng."; exit 0' INT TERM
sleep 3
if ! kill -0 "$PID" 2>/dev/null; then
  echo "❌ SSH thoát ngay. Kiểm tra: target đúng chưa, khoá SSH có quyền, hoặc port $LPORT đang bận."
  exit 1
fi
if command -v curl >/dev/null 2>&1; then
  CODE="$(probe)"
  if [ "$CODE" != "000" ]; then
    echo "✅ Tunnel UP — local dev đọc DB VPS qua http://localhost:$LPORT (HTTP $CODE)."
  else
    echo "⚠️ Chưa thấy phản hồi ở localhost:$LPORT (tunnel vẫn đang thử). Kiểm tra proxy trên VPS."
  fi
else
  echo "✅ Tunnel đã khởi động (không có curl để tự test)."
fi
echo "   Giữ cửa sổ này mở suốt lúc dev. Ctrl+C để dừng."
wait "$PID"
