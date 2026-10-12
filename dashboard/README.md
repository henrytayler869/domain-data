# Dashboard

Webapp Next.js của DData (Domain Picker, Kho Domain, Settings…).

## Chạy local

```bash
npm ci
npm run dev
```

Mở http://localhost:3000. Biến môi trường đặt trong `dashboard/.env.local`.

## Deploy

Merge vào `main` (có thay đổi trong `dashboard/`) → GitHub Actions `.github/workflows/deploy.yml`
rsync code lên VPS (`/opt/domaindata/dashboard/`) rồi build + restart container `dashboard`
bằng `docker compose` trong `/opt/n8n`. Có thể chạy tay qua "Run workflow" (workflow_dispatch).
