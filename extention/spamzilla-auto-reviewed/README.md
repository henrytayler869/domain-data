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

## 🆕 Tạo Filter từ CSV (v1.4)

Mục **"▸ Tạo Filter từ CSV"** ở cuối bảng điều khiển giúp **nạp 1 file danh sách domain →
tự tạo & lưu hàng loạt Saved Filter** trên SpamZilla, mỗi filter tối đa **20 domain** ở ô
**Include Domains**. Mỗi filter được set sẵn:

| Mục | Giá trị |
|-----|---------|
| **SZ Score** | Min `0`, Max để trống |
| **SZ Age** | Min `3`, Max để trống |
| **Remove Reviewed** | ✅ tick |
| **Include Domains** | 20 domain của batch (phân cách bằng dấu phẩy) |
| **Domain Source** | Chỉ tick **Expired Domains - Register Now!** + **Pending Delete**, bỏ hết còn lại |

Mọi thiết lập khác được **reset về mặc định** (đúng như nút *Reset Filter* của SpamZilla)
trước khi áp 5 mục trên → mỗi filter đồng nhất, chỉ khác nhau danh sách Include Domains.

### Cách dùng

1. Bấm **"▸ Tạo Filter từ CSV"** để mở mục này.
2. **Chọn file** (`.csv` / `.txt`) chứa danh sách domain.
   - File có dòng tiêu đề kiểu `===== Batch 1/39 (…) =====`: mỗi tiêu đề là **1 filter**,
     **tên filter = nguyên văn dòng tiêu đề** (khớp cách bạn đã đặt tên trước đây). Nhóm nào
     >20 domain sẽ tự tách thành `... (2)`, `... (3)`…
   - File CSV phẳng (không có tiêu đề): gom hết domain rồi **chia mỗi 20**, đặt tên theo
     **Mẫu tên** — hỗ trợ `{prefix}` (Prefix tên / mặc định lấy từ tên file), `{i}` (số thứ tự),
     `{n}` (tổng số filter). Mặc định: `{prefix} {i}/{n}`.
3. Xem trước **số filter · số domain** + vài tên đầu tiên ở ô thông tin.
4. Bấm **"▶ Tạo & Lưu filter"**. Extension lần lượt set field + gọi `POST /filter/save/`
   (dùng chính jQuery + CSRF của trang) cho từng batch, có **nghỉ giữa mỗi lần** (mặc định
   800ms, chỉnh được) và **thử lại 1 lần** khi lỗi. Nút **■ Dừng** để ngắt.
5. Kết quả hiện ở dòng trạng thái: `X lưu OK, Y lỗi / tổng`. Reload trang để thấy filter mới
   trong dropdown / *Load Filter*.

### Bỏ qua filter trùng tên

Tick **"Bỏ qua filter trùng tên"** (mặc định bật) để **không tạo lại** những filter đã tồn tại.
Extension đọc tên filter đã có từ dropdown **quick-filters**, select **user_filters** (modal Save)
và bảng **Load Filter**, so khớp theo tên (đã gom khoảng trắng thừa). Ví dụ bạn đã tạo tay:

```
===== Batch 1/39  (20 domain, DR 95-100) =====
===== Batch 2/39  (20 domain, DR 94-95) =====
```

→ khi nạp lại file 39 batch, 2 filter này bị **⏭ bỏ qua**, chỉ 37 filter còn lại được tạo mới.
Ô xem trước hiển thị sẵn *"N filter đã tồn tại → sẽ bỏ qua"* trước khi chạy; kết quả cuối ghi rõ
`X lưu OK, S bỏ qua (trùng), Y lỗi`. Bỏ tick nếu muốn tạo mới bất chấp trùng tên.

> ⚠️ Lưu ý: khi **bỏ tick** dedup, chạy lại cùng file sẽ tạo **trùng tên**. Domain luôn được
> **chuẩn hoá + khử trùng trong từng batch** (bỏ `www.`, `http(s)://`).

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
