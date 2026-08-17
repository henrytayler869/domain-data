#!/usr/bin/env bash
# Một lệnh cho dev local: mở SSH tunnel tới DB VPS (nền) rồi chạy Next.js dev.
# Ctrl+C tắt cả dev lẫn tunnel. Target VPS: arg 1 > $VPS_SSH > .dev-tunnel.env.
#   ./dev.sh              (đọc .dev-tunnel.env)
#   ./dev.sh user@host
set -uo pipefail

LPORT="${LPORT:-8088}"; RPORT="${RPORT:-8088}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# 1) Target VPS
TARGET="${1:-${VPS_SSH:-}}"
if [ -z "$TARGET" ] && [ -f "$HERE/.dev-tunnel.env" ]; then
  # shellcheck disable=SC1091
  . "$HERE/.dev-tunnel.env"; TARGET="${VPS_SSH:-}"
fi
if [ -z "$TARGET" ]; then
  echo "❌ Chưa biết VPS (user@host)."
  echo "   echo 'VPS_SSH=user@host' > $HERE/.dev-tunnel.env   (đã gitignore)   hoặc:  ./dev.sh user@host"
  exit 1
fi

HAVE_CURL=0; command -v curl >/dev/null 2>&1 && HAVE_CURL=1
probe() { curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$LPORT/" 2>/dev/null || echo 000; }

TUNNEL_PID=""
cleanup() {
  if [ -n "$TUNNEL_PID" ] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null
    echo; echo "🛑 Đã tắt tunnel."
  fi
}
trap cleanup EXIT

# 2) Tunnel (bỏ qua nếu đã chạy sẵn)
if [ "$HAVE_CURL" = 1 ] && [ "$(probe)" != "000" ]; then
  echo "✅ Tunnel đã chạy sẵn (localhost:$LPORT) — dùng lại."
else
  echo "🔌 Mở tunnel  localhost:$LPORT → $TARGET → (VPS) 127.0.0.1:$RPORT ..."
  ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
    -L "127.0.0.1:$LPORT:localhost:$RPORT" "$TARGET" &
  TUNNEL_PID=$!
  ok=0
  for i in $(seq 1 10); do
    sleep 1
    kill -0 "$TUNNEL_PID" 2>/dev/null || { echo "❌ SSH thoát ngay — kiểm tra target/khoá SSH."; exit 1; }
    if [ "$HAVE_CURL" = 1 ]; then
      [ "$(probe)" != "000" ] && { ok=1; break; }
    else
      [ "$i" -ge 3 ] && { ok=1; break; }
    fi
  done
  [ "$ok" = 1 ] || { echo "❌ Tunnel không lên sau 10s. Kiểm tra proxy VPS / SSH."; exit 1; }
  echo "✅ Tunnel UP (http://localhost:$LPORT)."
fi

# 3) Next.js dev (foreground). Ctrl+C → thoát → trap cleanup tắt tunnel.
echo "▶ npm run dev   (Ctrl+C để tắt cả dev + tunnel)"
cd "$HERE/dashboard"
npm run dev
