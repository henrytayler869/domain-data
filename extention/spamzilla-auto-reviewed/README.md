# SpamZilla Auto Reviewed (Chrome Extension)

Tự động **chọn tất cả domain → bấm Reviewed → lặp qua từng trang → lặp qua từng filter**
trên SpamZilla, **gom toàn bộ domain** và **lưu ra file `.txt`** để nạp vào Domain Picker (Bước 1).

Chạy trong Chrome thật của bạn nên **không dính Cloudflare bot-detection** như Playwright.

## Cách cài (Load unpacked)

1. Giải nén / để nguyên thư mục `spamzilla-auto-reviewed`.
2. Mở Chrome, vào `chrome://extensions`.
3. Bật **Developer mode** (góc trên bên phải).
4. Bấm **Load unpacked** → chọn thư mục `spamzilla-auto-reviewed`.
5. Vào trang danh sách domain của SpamZilla
   (ví dụ `https://www.spamzilla.io/domains/...`).
   Một bảng điều khiển nhỏ sẽ hiện ở **góc dưới bên phải**.

## Cách dùng

- **▶ Bắt đầu (filter này)**: chạy vòng lặp review + **gom domain** cho filter đang mở.
- **⏩ Duyệt TẤT CẢ filter**: tự lặp qua từng saved-filter trong dropdown → mỗi filter đều
  review + gom domain, rồi sang filter kế. Xong hết thì bấm **Lưu TXT**.
- **■ Dừng**: dừng ngay sau bước đang chạy.
- **💾 Lưu TXT**: tải **toàn bộ domain đã gom** (qua mọi trang / mọi filter) ra file
  `spamzilla_domains_YYYYMMDD_HHMM.txt` (mỗi domain 1 dòng) → nạp vào **Bước 1** của Domain Picker.
- **⧉ Copy trang**: copy domain **trang hiện tại** vào clipboard.
- **🗑 Xoá bộ nhớ**: xoá danh sách domain đã gom (bắt đầu mẻ mới).
- **🔎 Log filter**: in các ứng viên dropdown filter ra Console (F12) — dùng khi
  "Duyệt TẤT CẢ filter" không tự tìm được dropdown (gửi log để chỉnh selector).
- **Nghỉ (ms)** / **Giới hạn lần (0=∞)** / **–** (thu gọn): như cũ.

> **Bộ nhớ domain** được lưu bền bằng `chrome.storage.local` — sống qua reload trang và
> chuyển filter. Vì vậy bạn có thể **tự chuyển từng filter + bấm "Bắt đầu"** cho mỗi cái
> (nếu auto-duyệt không hợp UI), domain vẫn cộng dồn; cuối cùng bấm **Lưu TXT** là đủ.

## Logic xử lý (v1.3 — hợp với filter loại trừ reviewed)

Filter SpamZilla thường bật **loại trừ domain đã reviewed**. Nếu đi **tiến lên từng trang**,
server truy vấn lại loại bỏ reviewed → các domain còn lại **dồn về trang 1** → đi tiến sẽ
**bỏ sót**. Vì vậy extension **chỉ xử lý TRANG 1**:

Mỗi vòng lặp:

1. **Gom** toàn bộ domain trang 1 vào bộ nhớ.
2. Bấm **"chọn tất cả"** (`input.select-on-check-all`) → **Reviewed** (`a.reviewed-button`).
3. **Chờ mạng rảnh** (`inject.js` theo dõi XHR/fetch → sự kiện `SZ_NET_IDLE`) để chắc chắn
   Reviewed đã **lưu xong** — tránh sót do chưa kịp lưu.
4. **Re-query trang 1**: bấm **Next** rồi **First/Prev** (PJAX fetch lại) → 25 domain
   chưa reviewed kế tiếp **dồn lên trang 1**.
5. Lặp lại tới khi **trang 1 rỗng** (hoặc trang 1 không đổi → coi như hết).

Nhờ vậy **không phải quay lại trang 1 thủ công** nữa — extension tự làm việc đó mỗi vòng.

> ⚠️ Cách này **giả định filter có bật loại trừ reviewed** (đúng như thiết lập của bạn). Nếu
> chạy trên filter KHÔNG loại reviewed, nó sẽ dừng sau trang 1 (vì trang 1 không đổi).

Ngoài ra `inject.js` tự bỏ qua hộp thoại `confirm()`/`alert()` khi đang chạy để không treo.

## Lưu ý

- Extension chỉ chạy trên `spamzilla.io`.
- Nếu SpamZilla đổi giao diện/class, chỉ cần sửa phần `SEL` ở đầu file `content.js`.
- **"Duyệt TẤT CẢ filter"** tự tìm dropdown saved-filter (`SEL.filterSelect`). Nếu SpamZilla
  dùng UI filter kiểu khác (không phải `<select>`), nút sẽ báo không tìm thấy → bấm
  **🔎 Log filter**, gửi log ở Console cho dev để chỉnh `SEL.filterSelect` / cách chọn filter.
  Trong lúc chờ, dùng cách thủ công: tự chọn từng filter rồi bấm **Bắt đầu** (domain vẫn cộng dồn).
- Sau khi sửa code, vào `chrome://extensions` bấm **Reload** (biểu tượng ⟳) trên extension.
- Nếu nút Reviewed cần xác nhận lại bằng popup khác (không phải confirm/alert chuẩn),
  hãy tăng "Nghỉ (ms)" hoặc báo lại để chỉnh.
