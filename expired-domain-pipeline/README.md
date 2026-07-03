# Expired Domain Pipeline

Tự dựng nguồn domain drop (.com/.net/.org) + tự tính các chỉ số **rẻ** từ dữ liệu công khai
miễn phí để **lọc mạnh TRƯỚC**, rồi mới enrich phần sống sót bằng DataForSEO.

Chạy **standalone** (CLI Python, không phải trong webapp). Mỗi module là một sub-command:
`python -m pipeline <step> [options]`.

Trạng thái: **Phase 1–7 đã dựng xong** (20/20 unit test pass). Tích hợp webapp làm sau.

---

## Cài đặt

**Windows (máy cá nhân) — 1 cú đúp:** chạy **`setup.bat`** (tự tạo `.venv` + cài thư viện).
Sau đó mỗi lần dùng:
```bat
.venv\Scripts\activate
python -m pipeline --help
```

**Thủ công (mọi OS):**
```bash
cd expired-domain-pipeline
python -m venv .venv
# Windows: .venv\Scripts\activate    |    Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
```

Yêu cầu: **Python 3.11+**. Phase 1 **không cần credential** (dump Wikipedia công khai).
Đã test chạy trực tiếp trên **Windows** (20/20 test pass, output UTF-8 tiếng Việt OK).

---

## Phase 1 — WPL (Wikipedia external-link count)

**WPL = số link từ Wikipedia trỏ về một domain** — thay cột WPL của ExpiredDomains.
Nguồn: dump `externallinks` của Wikimedia (miễn phí, phát hành ~1 lần/tháng).

### Lưu ý schema (quan trọng)
Bảng `externallinks` của MediaWiki **đã đổi cấu trúc (~2024)**: bỏ cột `el_to` (URL đầy đủ),
thay bằng `el_to_domain_index` (host đảo nhãn, TLD đứng trước, có dấu chấm cuối) + `el_to_path`.
Module này **tự đọc `CREATE TABLE`** ở đầu dump để lấy layout cột hiện hành và parse đúng —
hỗ trợ **cả schema cũ lẫn mới**, không hardcode tên cột.

### Chạy

1) (Tuỳ chọn) Tải dump thủ công cho nhanh/ổn định (vài GB):
```bash
mkdir -p data/dumps
# ví dụ enwiki:
curl -L -o data/dumps/enwiki-externallinks.sql.gz \
  https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-externallinks.sql.gz
```
Nếu không tải trước, các lệnh dưới sẽ **tự tải** (resumable) từ URL trong `config.yaml`.

2) **Verify parser trước** khi chạy full (in vài chục domain mẫu):
```bash
python -m pipeline wpl sample --dump data/dumps/enwiki-externallinks.sql.gz --n 30
```
Nhìn bằng mắt xem domain ra có hợp lý không (vd `nytimes.com`, `bbc.co.uk`…).

3) Build bảng `wpl`:
```bash
python -m pipeline wpl build --dump data/dumps/enwiki-externallinks.sql.gz
# hoặc tự tải:  python -m pipeline wpl build --wiki enwiki
# test nhanh 100k link đầu:  python -m pipeline wpl build --dump ... --limit 100000
```

4) Tra cứu / join:
```bash
python -m pipeline wpl lookup nytimes.com
python -m pipeline wpl annotate --in domains.txt --out domains_wpl.csv
```
`annotate`: input mỗi dòng 1 domain → CSV `domain,wp_links` (UTF-8 BOM, domain không có = 0).

### Bộ nhớ (RAM)
Đếm bằng dict, **định kỳ flush cộng dồn sang SQLite** khi số domain duy nhất đạt `flush_size`
(mặc định 1,000,000 trong `config.yaml`). Máy RAM thấp → hạ `flush_size` (vd 300000).
Không nạp cả file GB vào RAM; đọc streaming theo dòng.

---

## Cấu trúc

```
expired-domain-pipeline/
├── config.yaml          # URL dump, flush_size, skip_domains…
├── .env(.example)       # credential (Phase 2+); Phase 1 không cần
├── requirements.txt
├── data/                # dump + SQLite (gitignored)
│   └── pipeline.db      # hub join dữ liệu (SQLite)
├── pipeline/
│   ├── __main__.py      # CLI (typer)
│   ├── config.py        # load config.yaml + .env
│   ├── db.py            # SQLite schema (wpl/ccrank/wayback/drops)
│   ├── domains.py       # registered domain + giải mã domain-index
│   ├── httpx_dl.py      # tải dump resumable
│   └── wpl.py           # Phase 1
└── tests/               # pytest cho parser + registered-domain
```

## Test
```bash
pytest -q
```
Bao gồm test cho parser WPL (schema cũ & mới, escape SQL, multi-line) và hàm rút registered domain.

## Chạy full pipeline (thứ tự)

```bash
# Phase 1 — WPL (1 lần/tháng, khi có dump mới)
python -m pipeline wpl build --dump enwiki-externallinks.sql.gz

# Phase 2 — drops (mỗi ngày): build snapshot 2 ngày liên tiếp rồi diff
python -m pipeline drops pull --tld com            # cần CZDS creds trong .env
#   hoặc test không cần CZDS:  drops from-zone --tld com --zone com.zone.gz
python -m pipeline drops diff --tld com            # → bảng drops + drops_<date>.csv

# Phase 3 — wayback (tuổi/crawl) cho domain drop
python -m pipeline wayback check --from drops --concurrency 10 --rps 5

# Phase 4 — ccrank (authority Common Crawl), chỉ nạp domain đã drop
python -m pipeline ccrank load --rankfile cc-domain-ranks.txt.gz --filter drops

# Phase 5 — filter: cắt drops → candidates
python -m pipeline filter run                      # → data/candidates.csv

# Phase 6 — dataforseo: enrich phần sống sót (tốn tiền — có estimate + xác nhận)
python -m pipeline dataforseo enrich               # cần DFS_LOGIN/DFS_PASSWORD

# Phase 7 — score: chấm & xuất
python -m pipeline score run --top 2000            # → data/final_<date>.csv
```

Mỗi bước **idempotent**, cache HTTP, tôn trọng rate limit, xử lý streaming cho file lớn.

## Các phase
| Phase | Cmd | Làm gì | Nguồn (miễn phí trừ P6) |
|------|-----|--------|------|
| 1 | `wpl` | số link Wikipedia/domain | Wikimedia externallinks dump |
| 2 | `drops` | domain drop mỗi ngày | ICANN CZDS zone diff |
| 3 | `wayback` | tuổi + số crawl | Wayback CDX API |
| 4 | `ccrank` | authority sơ bộ | Common Crawl domain rank |
| 5 | `filter` | phễu lọc rẻ (join + name features + pre_score) | (local) |
| 6 | `dataforseo` | rank/refdomains/backlinks/spam | DataForSEO bulk (💰) |
| 7 | `score` | final_score + export | (local) |

## Tích hợp webapp (bước sau)
Import `final_*.csv` vào Supabase → trang review trong dashboard → đẩy sang **Domain Picker →
Wayback → Mua** (luồng hiện có). Chưa làm — theo lựa chọn "dựng pipeline trước, tích hợp sau".

## Ràng buộc
- Không log/echo credential. Mọi bước idempotent, cache HTTP, tôn trọng rate limit.
- Ưu tiên streaming cho file lớn.
