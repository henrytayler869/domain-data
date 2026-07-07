#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
spamzilla_review.py — Playwright tự động:
  1) Mở Chrome (profile Playwright RIÊNG, persistent) → Spamzilla.
  2) Đăng nhập (thủ công lần đầu, session được lưu lại) + DỪNG cho bạn giải
     Cloudflare captcha bằng tay khi gặp (KHÔNG tự giải — đúng quy tắc).
  3) Duyệt lần lượt các Saved Filter preset → gom domain → bulk 'Reviewed'
     (để domain đã duyệt không hiện lại).
  4) Gộp + dedupe toàn bộ → mở Domain Picker (webapp) → tự dán vào Bước 1.

CÁCH DÙNG
  Lần đầu / lấy selector:   python spamzilla_review.py --discover
  Chạy thật:                python spamzilla_review.py
  Chạy nhưng KHÔNG Reviewed (an toàn thử): python spamzilla_review.py --dry-run
  Không auto bấm 'Chạy pipeline' ở webapp:  python spamzilla_review.py --no-run

CÀI ĐẶT
  pip install playwright
  # dùng Chrome hệ thống (channel='chrome') nên KHÔNG cần 'playwright install'.
  # Nếu máy không có Chrome, đổi CHANNEL=None ở dưới rồi: python -m playwright install chromium
"""
from __future__ import annotations
import argparse
import datetime as dt
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout, Page

# ═══════════════════════ CONFIG — chỉnh sau khi chạy --discover ═══════════════════════
HERE = Path(__file__).resolve().parent
PROFILE_DIR = HERE / ".pw-profile"          # session Chrome lưu ở đây (đã gitignore)
CHANNEL = "chrome"                          # "chrome" = dùng Chrome hệ thống; None = Chromium của Playwright

# ── NẾU CLOUDFLARE VẪN CHẶN (Turnstile kẹt "Verifying") ──────────────────────────────
# Profile riêng ở trên còn "mới/lạ" nên hay bị nghi. Dùng profile Chrome THẬT (đã có
# lịch sử + cookie cf_clearance từ lúc bạn lướt Spamzilla bình thường) sẽ dễ qua nhất.
# Cách: ĐÓNG HẾT Chrome, rồi bỏ comment 2 dòng dưới (đổi "Default" thành "Profile 1"…
# nếu tài khoản kengnam896 nằm ở profile khác — xem chrome://version → Profile Path):
# PROFILE_DIR = Path(r"C:\Users\henry\AppData\Local\Google\Chrome\User Data")
# CHROME_PROFILE_DIR = "Default"   # thư mục con của profile; None nếu không dùng
CHROME_PROFILE_DIR = None

SPAMZILLA_URL = "https://www.spamzilla.io/"                     # TODO: URL trang danh sách/filter sau khi login
WEBAPP_PICKER = "https://domaindata.project896.com/domain-picker"

# Tên các Saved Filter preset cần duyệt — ĐÚNG như chữ hiển thị trong dropdown Spamzilla.
FILTER_PRESETS: list[str] = [
    # "Bộ lọc 1",
    # "Bộ lọc 2",
]

# Selector Spamzilla — điền sau khi --discover cho ra kết quả.
SEL = {
    "filter_dropdown": "",   # dropdown/menu để chọn saved filter (vd: "select#saved-filters")
    "domain_cell":     "",   # ô chứa domain trong mỗi dòng (vd: "table tbody tr td.domain a")
    "table_ready":     "",   # 1 element CHẮC CHẮN có khi bảng đã load xong
    "select_all":      "",   # checkbox 'chọn tất cả' ở header bảng
    "reviewed_btn":    "",   # nút bulk 'Reviewed'
    "next_page":       "",   # nút sang trang kế (để "" nếu bộ lọc không phân trang)
    "login_marker":    "",   # element CHỈ có khi CHƯA đăng nhập (vd: 'input[name="password"]')
}

# Webapp Bước 1 — ổn định, thường không cần đổi.
SEL_WEBAPP_TEXTAREA = "textarea"
SEL_WEBAPP_RUN_NAME = "Chạy pipeline"       # tên nút (accessible name)

DOMAIN_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+$")
# ═════════════════════════════════════════════════════════════════════════════════════


def log(msg: str) -> None:
    print(f"[{dt.datetime.now():%H:%M:%S}] {msg}", flush=True)


def pause(msg: str) -> None:
    """Dừng có chủ đích để người dùng thao tác tay (login / captcha)."""
    print("\n" + "─" * 68)
    print("⏸  " + msg)
    input("   → Làm xong trong cửa sổ trình duyệt rồi ẤN ENTER ở đây... ")
    print("─" * 68 + "\n")


def on_cloudflare(page: Page) -> bool:
    """Nhận diện trang thử thách Cloudflare (KHÔNG tự giải)."""
    try:
        if "just a moment" in (page.title() or "").lower():
            return True
    except Exception:
        pass
    for sel in (
        "#challenge-form",
        "#cf-chl-widget",
        'iframe[src*="challenges.cloudflare.com"]',
        'iframe[title*="Cloudflare"]',
    ):
        try:
            if page.locator(sel).count() > 0:
                return True
        except Exception:
            pass
    return False


def ensure_human_checks(page: Page, expect_sel: str = "") -> None:
    """Gặp Cloudflare → dừng cho giải tay. Gặp trang login → dừng cho đăng nhập."""
    if on_cloudflare(page):
        pause("Cloudflare captcha xuất hiện — giải bằng tay trong trình duyệt.")
    if SEL["login_marker"] and page.locator(SEL["login_marker"]).count() > 0:
        pause("Spamzilla CHƯA đăng nhập — đăng nhập bằng tay (session sẽ được lưu).")
    if expect_sel:
        try:
            page.wait_for_selector(expect_sel, timeout=20_000)
        except PWTimeout:
            pause(f"Chưa thấy phần tử mong đợi ({expect_sel}). Kiểm tra trang rồi tiếp tục.")


def discover(page: Page) -> None:
    """In cấu trúc DOM trang hiện tại để xác định selector (dropdown, bảng, nút Reviewed…)."""
    print("\n" + "=" * 72)
    print("DISCOVER —", page.url)
    print("Title:", page.title())
    print("=" * 72)

    js_selects = """() => [...document.querySelectorAll('select')].map(s => ({
        id: s.id, name: s.name, cls: s.className,
        options: [...s.options].slice(0,40).map(o => o.textContent.trim()).filter(Boolean)
    }))"""
    print("\n### <select> (ứng viên dropdown Saved Filter):")
    for s in page.evaluate(js_selects):
        print("  select", {k: v for k, v in s.items() if v})

    js_btns = """() => [...document.querySelectorAll('button, a, input[type=button], input[type=submit]')]
        .map(b => (b.innerText || b.value || '').trim())
        .filter(t => t && t.length < 40)
        .filter((t,i,a) => a.indexOf(t) === i).slice(0,80)"""
    print("\n### Nút/Link có chữ (tìm 'Reviewed', 'Select all', 'Next'…):")
    for t in page.evaluate(js_btns):
        print("   •", t)

    js_th = "() => [...document.querySelectorAll('table th')].map(t => t.innerText.trim()).slice(0,30)"
    print("\n### Tiêu đề cột bảng (th):")
    print("  ", page.evaluate(js_th))

    js_rows = """() => [...document.querySelectorAll('table tbody tr')].slice(0,3).map(
        tr => [...tr.querySelectorAll('td')].map(td => (td.innerText||'').trim().slice(0,30)))"""
    print("\n### 3 dòng đầu của bảng (tìm cột chứa domain):")
    for r in page.evaluate(js_rows):
        print("   ", r)

    js_chk = """() => [...document.querySelectorAll('input[type=checkbox]')].slice(0,6).map(c => ({
        id: c.id, name: c.name, cls: c.className }))"""
    print("\n### checkbox (ứng viên 'select all'):")
    for c in page.evaluate(js_chk):
        print("  ", {k: v for k, v in c.items() if v})
    print("\n" + "=" * 72)
    print("→ Dán toàn bộ output này cho Claude để điền SEL + FILTER_PRESETS.")
    print("=" * 72 + "\n")


def extract_domains(page: Page) -> list[str]:
    """Lấy domain từ bảng hiện tại, tự phân trang nếu có SEL['next_page']."""
    found: list[str] = []
    seen: set[str] = set()
    page_no = 1
    while True:
        if SEL["table_ready"]:
            try:
                page.wait_for_selector(SEL["table_ready"], timeout=15_000)
            except PWTimeout:
                pass
        cells = page.locator(SEL["domain_cell"])
        for txt in cells.all_inner_texts():
            d = txt.strip().lower().lstrip("*. ")
            d = re.sub(r"^https?://", "", d).split("/")[0]
            if DOMAIN_RE.match(d) and d not in seen:
                seen.add(d)
                found.append(d)
        log(f"    trang {page_no}: tổng {len(found)} domain")
        # phân trang
        if not SEL["next_page"]:
            break
        nxt = page.locator(SEL["next_page"])
        if nxt.count() == 0 or not nxt.first.is_enabled():
            break
        nxt.first.click()
        page.wait_for_timeout(1500)
        ensure_human_checks(page, SEL["table_ready"])
        page_no += 1
    return found


def mark_reviewed(page: Page, dry_run: bool) -> None:
    """Bulk: chọn tất cả → bấm Reviewed."""
    if dry_run:
        log("    [dry-run] BỎ QUA bấm Reviewed")
        return
    if SEL["select_all"]:
        page.locator(SEL["select_all"]).first.check()
        page.wait_for_timeout(400)
    page.locator(SEL["reviewed_btn"]).first.click()
    page.wait_for_timeout(2000)
    ensure_human_checks(page, SEL["table_ready"])
    log("    ✅ đã bấm Reviewed cho bộ lọc này")


def select_preset(page: Page, name: str) -> None:
    """Chọn 1 Saved Filter preset theo tên trong dropdown."""
    dd = page.locator(SEL["filter_dropdown"]).first
    try:
        dd.select_option(label=name)          # nếu là <select> chuẩn
    except Exception:
        dd.click()                            # nếu là menu custom
        page.get_by_text(name, exact=True).first.click()
    page.wait_for_timeout(1500)
    ensure_human_checks(page, SEL["table_ready"])


def push_to_webapp(page: Page, domains: list[str], auto_run: bool) -> None:
    log(f"Mở webapp Bước 1 và dán {len(domains)} domain…")
    page.goto(WEBAPP_PICKER, wait_until="domcontentloaded")
    if "/login" in page.url:
        pause("Webapp yêu cầu đăng nhập — đăng nhập bằng tay (session sẽ được lưu).")
        page.goto(WEBAPP_PICKER, wait_until="domcontentloaded")
    page.wait_for_selector(SEL_WEBAPP_TEXTAREA, timeout=20_000)
    ta = page.locator(SEL_WEBAPP_TEXTAREA).first
    ta.fill("\n".join(domains))
    page.wait_for_timeout(500)
    if auto_run:
        try:
            page.get_by_role("button", name=SEL_WEBAPP_RUN_NAME).click(timeout=5000)
            log("▶️  Đã bấm 'Chạy pipeline'.")
        except Exception as e:
            log(f"Không auto bấm được nút chạy ({e}). Domain đã dán sẵn, bấm tay giúp.")
    else:
        log("Đã dán domain vào Bước 1 (chưa bấm chạy — dùng --no-run).")


def validate_config(discover_mode: bool) -> None:
    missing = [k for k in ("filter_dropdown", "domain_cell", "reviewed_btn") if not SEL[k]]
    if discover_mode:
        return
    if missing:
        sys.exit(f"❌ Chưa điền SEL: {missing}. Chạy `--discover` trước rồi điền vào file.")
    if not FILTER_PRESETS:
        sys.exit("❌ FILTER_PRESETS đang rỗng. Điền tên các saved filter cần duyệt.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--discover", action="store_true", help="In cấu trúc DOM để lấy selector")
    ap.add_argument("--dry-run", action="store_true", help="Chạy nhưng KHÔNG bấm Reviewed")
    ap.add_argument("--no-run", action="store_true", help="Dán domain nhưng KHÔNG auto bấm Chạy pipeline")
    args = ap.parse_args()
    validate_config(args.discover)

    PROFILE_DIR.mkdir(exist_ok=True)
    launch_args = ["--disable-blink-features=AutomationControlled", "--start-maximized"]
    if CHROME_PROFILE_DIR:
        launch_args.append(f"--profile-directory={CHROME_PROFILE_DIR}")
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            channel=CHANNEL,
            headless=False,
            chromium_sandbox=True,                        # bỏ cờ --no-sandbox (đỡ bị Cloudflare nghi + hết banner)
            ignore_default_args=["--enable-automation"],  # gỡ cờ tự-động-hoá → ẩn navigator.webdriver
            no_viewport=True,                             # dùng kích thước cửa sổ thật
            args=launch_args,
        )
        # Ẩn nốt dấu hiệu webdriver còn sót → Turnstile hiện thử thách BÌNH THƯỜNG để bạn tự tick.
        ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined});")
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        log(f"Mở Spamzilla: {SPAMZILLA_URL}")
        page.goto(SPAMZILLA_URL, wait_until="domcontentloaded")
        ensure_human_checks(page)

        if args.discover:
            pause("Mở đúng trang FILTER/danh sách domain (chọn 1 preset bất kỳ), rồi Enter để quét DOM.")
            discover(page)
            input("Xem xong output. Enter để đóng trình duyệt... ")
            ctx.close()
            return

        all_domains: list[str] = []
        seen: set[str] = set()
        for name in FILTER_PRESETS:
            log(f"▶ Bộ lọc: {name}")
            select_preset(page, name)
            doms = extract_domains(page)
            new = [d for d in doms if d not in seen]
            seen.update(new)
            all_domains.extend(new)
            log(f"    +{len(new)} domain mới (tổng {len(all_domains)})")
            mark_reviewed(page, args.dry_run)

        if not all_domains:
            log("Không gom được domain nào. Kiểm tra selector/preset.")
            ctx.close()
            return

        # Backup ra file phòng khi cần
        out = HERE / f"domains_{dt.datetime.now():%Y%m%d_%H%M}.txt"
        out.write_text("\n".join(all_domains), encoding="utf-8")
        log(f"💾 Lưu backup: {out.name} ({len(all_domains)} domain)")

        push_to_webapp(page, all_domains, auto_run=not args.no_run)
        input("\nXong. Enter để đóng trình duyệt... ")
        ctx.close()


if __name__ == "__main__":
    main()
