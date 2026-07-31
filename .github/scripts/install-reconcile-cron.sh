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
CID="$(cd /opt/n8n && docker compose ps -q dashboard)"
[ -n "$CID" ] || { echo "$(date -Is) ERROR: dashboard container not found"; exit 1; }
docker exec -i "$CID" node <<'NODE'
const port = process.env.PORT || 3000;
const token = process.env.N8N_API_TOKEN;
if (!token) { console.error("ERROR: no N8N_API_TOKEN in container"); process.exit(1); }
fetch("http://127.0.0.1:" + port + "/api/n8n/wayback-dispatch", {
  method: "POST",
  headers: { Authorization: "Bearer " + token },
})
  .then(async (r) => { console.log(new Date().toISOString(), "HTTP", r.status, await r.text()); if (!r.ok) process.exit(1); })
  .catch((e) => { console.error(new Date().toISOString(), String(e)); process.exit(1); });
NODE
OUTER_EOF
chmod +x "$TICK"

# Crontab của user: mỗi 20' (khớp ngưỡng heartbeat 75'). Xoá dòng cũ rồi thêm lại.
( crontab -l 2>/dev/null | grep -v 'reconcile-tick.sh' ; \
  echo "*/20 * * * * $TICK >> $HOME/reconcile-tick.log 2>&1" ) | crontab -

echo "=== crontab đã cài ==="
crontab -l | grep 'reconcile-tick.sh' || { echo "ERROR: cron chưa vào"; exit 1; }

echo "=== chạy thử 1 lần ngay ==="
"$TICK"
echo "=== xong ==="
