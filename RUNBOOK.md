# RUNBOOK — chạy một đợt quét domain

Viết cho người **vài tháng mới quay lại một lần** và không nhớ phải làm gì. Đọc từ trên xuống.

> Lối tắt: mở **https://domaindata.project896.com/campaign** (menu **Chuẩn bị đợt quét**).
> Trang đó tự kiểm tra số dư từng công cụ, ước tính cần nạp bao nhiêu cho N domain, và có link nạp tiền.

---

## 1. Pipeline chạy thế nào

```
Danh sách domain ──► Gname: còn mua được? giá ≤ $26 ──► Wayback: lịch sử web có cá cược/người lớn? ──► Chấm rating (ref + anchor) ──► Đáng mua
                     (miễn phí)                         (Apify + OpenAI, tốn tiền nhất)            (Ahrefs unit, hết thì DataForSEO)
```

- Chạy **nền trên VPS** bằng cron — đóng trình duyệt vẫn chạy:
  - tick đầy đủ mỗi 20 phút: chấm rating, check Gname, gửi Wayback
  - tick nhẹ mỗi 5 phút: nạp lại slot Wayback trống (40 run song song)
- Tốc độ: Gname ~1.500 domain/giờ · Wayback ~200 domain/giờ (khâu chậm nhất) · rating ~100–2.000/giờ.

## 2. Công cụ phải trả tiền

| Công cụ | Dùng cho | Kiểu trả | Nạp ở đâu | Cấu hình trong app |
|---|---|---|---|---|
| **Apify** | Quét Wayback (actor `welcomed_sunshine~wayback-machine-actor`) | Gói tháng ($199 credit/tháng) + nạp thêm | console.apify.com/billing | Cài đặt → Apify (nhiều tài khoản, tự chuyển khi hết) |
| **OpenAI** | AI đọc nội dung Wayback + phân loại rating (gpt-4o-mini) | Trả trước credit | platform.openai.com → Billing | Cài đặt → OpenAI API; **và** biến `OPENAI_API_KEY` trên actor Apify |
| **Ahrefs** | Ref domain + anchor để chấm rating | 3 gói tháng (unit làm mới mỗi tháng) | app.ahrefs.com → Billing | Cài đặt → Ahrefs MCP token 1/2/3 |
| **DataForSEO** | Dự phòng chấm rating khi Ahrefs hết unit | Trả trước | app.dataforseo.com | Cài đặt → DataforSEO |
| **Gname** | Check còn mua được (miễn phí) + **mua domain** | Nạp số dư khi định mua | gname.com | Cài đặt → Gname (nhiều tài khoản) |
| **VPS** | Chạy toàn bộ hệ thống | Gia hạn theo kỳ | Panel nhà cung cấp VPS | Nhập hạn ở trang Chuẩn bị đợt quét |

**OpenAI không có API xem số dư** → app chỉ biết key còn dùng được hay đã hết. Nên bật **auto-recharge** trên OpenAI.

## 3. Chi phí tham khảo (đo 15/10/2026)

| Khâu | Đơn giá |
|---|---|
| Gname check | miễn phí |
| Wayback (Apify) | ~$0,025 / domain (~$0,01 khi run gom 5 domain) |
| Wayback (OpenAI) | ~$0,007 / domain |
| Chấm rating (Ahrefs) | ~300 unit / domain |
| Chấm rating (DataForSEO, khi hết Ahrefs) | ~$0,03 / domain |
| Chấm rating (OpenAI) | ~$0,0003 / domain |

Ví dụ **10.000 domain**: ~79% mua được → ~7.900 quét Wayback (**~$200 Apify + ~$55 OpenAI**, ~40 giờ) → ~40% sạch → ~3.200 chấm rating (**~960k unit Ahrefs**) → ~15% Tốt/TB → **~500 domain đáng mua**. Chưa gồm tiền mua domain.

Trang **Chuẩn bị đợt quét** tính lại theo tỉ lệ thực tế trong DB — dùng số ở đó.

## 4. Trước mỗi đợt quét

1. Mở **Chuẩn bị đợt quét** → nhập số domain → **Tính lại**.
2. Nạp tiền các dòng **Thiếu** (bấm "Nạp tiền"), rồi **Làm mới số dư** tới khi hết đỏ.
   - Gói Apify/Ahrefs đã tạm ngưng ở đợt trước → bật lại.
   - OpenAI: nạp ≥ số "Cần cho đợt này" + 20%.
3. Mục **Kiểm tra vận hành** phải đều **Đủ**:
   - *Pipeline nền đang chạy* — nếu đỏ xem mục 7.3.
   - *Gname kết nối được* — nếu đỏ thường do **IP VPS chưa whitelist** (mục 7.2).
   - *OpenAI key dùng được*.
4. Kiểm tra **hạn VPS** đủ cho số ngày chạy (+ vài ngày dư).

## 5. Chạy đợt quét

1. **Domain Picker** → dán hoặc upload danh sách (Spamzilla export / text) → **Chạy pipeline**.
2. Có thể đóng trang. Theo dõi ở khung **Pipeline nền** (Domain Picker) — số "xong (1 giờ)" phải nhảy; số "chờ" đứng yên là bình thường (hàng đợi vào ≈ ra).
3. Không có thông báo đẩy — **vào kiểm tra 1–2 lần/ngày**: thanh đỏ trên đầu mọi trang báo khi Wayback dừng / hết credit / cron ngừng; trang **Chuẩn bị đợt quét** → “Làm mới số dư” để xem còn đủ tiền không.
4. **Xong đợt** khi “chờ Wayback” và “chờ chấm rating” trong khung Pipeline nền về 0.

## 6. Khi thấy cảnh báo / thiếu tiền

| Dấu hiệu (thanh đỏ hoặc trang Chuẩn bị đợt quét) | Làm gì |
|---|---|
| Wayback tạm dừng: Apify hết credit | Nạp Apify hoặc thêm tài khoản Apify khác trong Cài đặt. Tối đa 5 phút sau tự chạy lại. |
| Wayback tạm dừng: OpenAI hết credit / key lỗi | Nạp OpenAI. Đổi key thì đổi **cả 2 chỗ**: Cài đặt → OpenAI **và** env `OPENAI_API_KEY` trên actor Apify (rồi Build actor). |
| Apify “Cần xem”/“Thiếu” | Nạp trước khi về 0. |
| Ahrefs còn ít unit | Bình thường sẽ tự chuyển DataForSEO — đảm bảo DataForSEO có ≥ $10, hoặc chờ ngày làm mới unit. |
| Gname không kết nối được | Thêm IP VPS vào whitelist API trên Gname (mục 7.2). |
| “Bộ điều phối tự lành không chạy” / tick ngừng | Mục 7.3. |
| Hết hàng chờ (đợt quét xong) | Domain Picker → **Khôi phục từ DB** → chọn mua. Sau đó mục 8. |

## 7. Sự cố thường gặp

### 7.1 Trang web báo 522 / 503 / không vào được
- Cloudflare **522** = không tới được VPS. Thử SSH `root@177.5.66.86`. Không vào được → **Reboot** trên panel VPS.
- Reboot vẫn không được, panel báo "Normal", security group mở hết → khả năng IP bị chặn phía nhà cung cấp → mở ticket / xin đổi IP (mục 7.4).
- Lưu ý: máy local có VPN thì test port từ máy mình **không đáng tin** — dùng check-host.net.

### 7.2 Gname báo "IP … is not in the white list"
Vào trang API của **mỗi** tài khoản Gname → thêm IP VPS hiện tại (`177.5.66.86`) vào whitelist. Tick sau tự check lại.

### 7.3 Pipeline nền không chạy
```bash
ssh root@177.5.66.86
crontab -l | grep reconcile          # phải có 2 dòng (*/20 và 5,10,15,…)
tail -n 5 /root/reconcile-tick.log   # tick đầy đủ
tail -n 5 /root/reconcile-tick-wayback.log
cd /opt/n8n && docker compose ps     # container dashboard phải Up
```
Cài lại cron: chạy `.github/scripts/install-reconcile-cron.sh` trên VPS (`ssh root@177.5.66.86 'bash -s' < .github/scripts/install-reconcile-cron.sh`).

### 7.4 Đổi IP VPS — phải sửa ở đâu
1. Cloudflare DNS: bản ghi A của `domaindata`, `pipelinedomain`, `vietlott` (.project896.com).
2. GitHub secret `VPS_HOST` (tài khoản owner `henrytayler869`) — nếu không deploy sẽ lỗi.
3. Whitelist IP trên **mọi** tài khoản Gname.
4. File `.dev-tunnel.env` ở máy local (`VPS_SSH=root@<IP>`).

### 7.5 Deploy lỗi
Deploy = push vào `dashboard/**` trên `main` → GitHub Actions `deploy.yml` build Docker trên VPS. Hay lỗi `npm ETIMEDOUT` do mạng VPS → push lại (commit rỗng vào `dashboard/`).

## 8. Sau đợt quét

- Mua domain đáng mua (Domain Picker Bước 6 / Kho Domain), nạp Gname theo số domain định mua.
- **Tạm ngưng** các gói trả theo tháng không cần tới đợt sau (Apify, Ahrefs Standard/Advanced) để khỏi mất tiền.
- Cập nhật hạn VPS nếu vừa gia hạn.

## 9. Thông tin hệ thống (không chứa bí mật)

| | |
|---|---|
| Dashboard | https://domaindata.project896.com (Cloudflare → VPS) |
| VPS | `177.5.66.86` (Singapore, Ubuntu 22.04, 4 core / 8 GB) |
| Thư mục | `/opt/n8n` (compose: dashboard, n8n, caddy) · `/opt/domaindata/db` (Postgres + PostgREST + proxy) |
| Cron | `/root/reconcile-tick.sh` (log `/root/reconcile-tick*.log`) |
| Wayback actor | Apify `welcomed_sunshine~wayback-machine-actor` (source chỉ có trên Apify) |
| Mọi key/token | Lưu trong DB (bảng `app_settings`), nhập qua trang **Cài đặt** |
