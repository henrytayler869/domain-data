"""Phase 8 — push: đẩy candidates lên Supabase (bảng expired_candidates của webapp
"Domain Drop"), BỎ QUA domain đã có trong hệ thống (đã mua / đã đánh giá / đã
bought/excluded) → mỗi ngày chỉ thêm domain MỚI thật sự.

Credential Supabase: đọc SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY từ env (.env),
nếu thiếu thì fallback đọc dashboard/.env.local (chạy chung máy với webapp).
"""
from __future__ import annotations

import re
import sqlite3

import typer

from .config import db_path, load_config, resolve_path

app = typer.Typer(help="push — đẩy candidates lên Supabase (Domain Drop).")

TABLE = "expired_candidates"

# Cột đẩy lên (KHÔNG gồm status/imported_at → để DB tự default; giữ status cũ nếu domain đã có).
PUSH_COLS = [
    "domain", "tld", "drop_date", "final_score", "wp_links", "cc_rank", "cc_harmonic",
    "first_year", "crawl_count", "dfs_rank", "referring_domains", "backlinks",
    "spam_score", "length", "has_hyphen", "has_digit", "is_dict_word", "pre_score",
]
_BOOL_COLS = {"has_hyphen", "has_digit", "is_dict_word"}


def _get_creds() -> tuple[str, str]:
    import os
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if url and key:
        return url, key
    cfg = load_config().get("push", {}) or {}
    envfile = resolve_path(cfg.get("dashboard_env", "../dashboard/.env.local"))
    if envfile.exists():
        text = envfile.read_text(encoding="utf-8", errors="replace")

        def g(k: str):
            m = re.search(rf"^{k}\s*=\s*(.+)$", text, re.M)
            return m.group(1).strip().strip('"').strip("'") if m else None
        url = url or g("SUPABASE_URL")
        key = key or g("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "Thiếu SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — đặt trong .env "
            "hoặc để pipeline cạnh dashboard/ (đọc dashboard/.env.local)."
        )
    return url, key


def _fetch_domains(client, base: str, headers: dict, table: str,
                   col: str = "domain", extra: str = "") -> set[str]:
    out: set[str] = set()
    off, LIM = 0, 1000
    while True:
        r = client.get(f"{base}/rest/v1/{table}?select={col}&limit={LIM}&offset={off}{extra}",
                       headers=headers)
        if r.status_code == 404:  # bảng chưa tồn tại
            return out
        r.raise_for_status()
        data = r.json()
        for row in data:
            v = row.get(col)
            if v:
                out.add(str(v).lower())
        if len(data) < LIM:
            break
        off += LIM
    return out


@app.command()
def run(
    db: str = typer.Option(None),
    limit: int = typer.Option(0, help="Chỉ đẩy top N theo final_score (0=all)."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Chỉ đếm, không ghi."),
):
    """Đẩy candidates → expired_candidates, bỏ qua domain đã có trong DB."""
    import httpx

    url, key = _get_creds()
    headers_r = {"apikey": key, "Authorization": f"Bearer {key}"}
    headers_w = {**headers_r, "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"}

    dbp = resolve_path(db) if db else db_path()
    conn = sqlite3.connect(str(dbp))
    conn.row_factory = sqlite3.Row
    have = {r[1] for r in conn.execute("PRAGMA table_info(candidates)").fetchall()}
    if not have:
        typer.echo("Chưa có bảng candidates — chạy filter/score trước.")
        raise typer.Exit(1)
    order = "ORDER BY final_score DESC" if "final_score" in have else ""
    rows = [dict(r) for r in conn.execute(f"SELECT * FROM candidates {order}").fetchall()]
    conn.close()
    if limit:
        rows = rows[:limit]
    if not rows:
        typer.echo("Không có candidate để đẩy.")
        return

    with httpx.Client(timeout=60.0) as client:
        # Domain đã "xử lý" trong hệ thống → bỏ qua.
        handled: set[str] = set()
        handled |= _fetch_domains(client, url, headers_r, "domain_inventory")          # đã mua
        handled |= _fetch_domains(client, url, headers_r, "target_assessment", "target_domain")  # đã đánh giá
        handled |= _fetch_domains(client, url, headers_r, TABLE, "domain",
                                  extra="&status=neq.new")                             # đã bought/excluded
        typer.echo(f"Đã có trong DB (bỏ qua): {len(handled):,} domain")

        payload = []
        for r in rows:
            d = str(r.get("domain") or "").lower()
            if not d or d in handled:
                continue
            obj = {}
            for c in PUSH_COLS:
                v = r.get(c)
                obj[c] = (bool(v) if v is not None else False) if c in _BOOL_COLS else v
            payload.append(obj)

        skipped = len(rows) - len(payload)
        if dry_run:
            typer.echo(f"[dry-run] Sẽ đẩy {len(payload):,} MỚI · bỏ {skipped:,} đã có.")
            return
        if not payload:
            typer.echo(f"Không có domain mới (tất cả {len(rows):,} đã có trong DB).")
            return

        for i in range(0, len(payload), 500):
            resp = client.post(f"{url}/rest/v1/{TABLE}?on_conflict=domain",
                               headers=headers_w, content=__import__("json").dumps(payload[i:i + 500]))
            if resp.status_code >= 300:
                raise RuntimeError(f"Push lỗi {resp.status_code}: {resp.text[:200]}")
    typer.echo(f"✓ push: đẩy {len(payload):,} domain MỚI lên Domain Drop · bỏ {skipped:,} đã có.")
