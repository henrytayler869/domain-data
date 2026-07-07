# Spamzilla → Domain Picker (Playwright)

Tự động: mở Spamzilla → duyệt lần lượt các **Saved Filter preset** → gom domain →
bulk **Reviewed** (để không hiện lại) → dán toàn bộ vào **Bước 1** của Domain Picker.

- Dùng **profile Playwright riêng** (`.pw-profile/`, gitignore) — lần đầu tự đăng nhập,
  session được lưu lại cho các lần sau.
- **Không tự giải Cloudflare captcha** — script dừng lại để bạn giải tay rồi Enter.

## Cài đặt

```bash
pip install playwright
# Script dùng Chrome hệ thống (channel="chrome") nên KHÔNG cần tải browser.
# Nếu máy không có Chrome: đổi CHANNEL=None trong script rồi chạy:
#   python -m playwright install chromium
```

## Quy trình dùng

1. **Lấy selector (1 lần):**
   ```bash
   python spamzilla_review.py --discover
   ```
   Đăng nhập Spamzilla trong cửa sổ mở ra, mở đúng trang filter, Enter để quét DOM.
   Dán output cho Claude → điền `SEL` + `FILTER_PRESETS` + `SPAMZILLA_URL` trong script.

2. **Chạy thử (không đánh Reviewed):**
   ```bash
   python spamzilla_review.py --dry-run
   ```

3. **Chạy thật:**
   ```bash
   python spamzilla_review.py
   ```
   Thêm `--no-run` nếu chỉ muốn dán vào Bước 1 mà chưa bấm "Chạy pipeline".

## Cần chỉnh trong `spamzilla_review.py`

| Biến | Ý nghĩa |
|---|---|
| `SPAMZILLA_URL` | URL trang danh sách/filter sau khi login |
| `FILTER_PRESETS` | Tên các saved filter cần duyệt (đúng chữ trong dropdown) |
| `SEL[...]` | Selector: dropdown filter, ô domain, nút select-all + Reviewed, phân trang, login marker |
| `WEBAPP_PICKER` | Đã set sẵn = `https://domaindata.project896.com/domain-picker` |

Mỗi lần chạy còn lưu backup `domains_YYYYMMDD_HHMM.txt` (gitignore) phòng khi cần.
