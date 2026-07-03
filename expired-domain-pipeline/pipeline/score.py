"""Phase 7 — score: tính final_score (kết hợp mọi tín hiệu) + xuất final_YYYYMMDD.csv."""
from __future__ import annotations

import csv
import datetime as _dt
import math
from pathlib import Path
from typing import Optional

import typer

from .config import db_path, load_config, resolve_path
from .db import get_conn, init_db

app = typer.Typer(help="score — final_score + xuất CSV.")

_DEFAULT_WEIGHTS = {
    "wp": 1.5, "cc": 1.0, "dfs_rank": 1.0, "refdom": 1.5,
    "backlinks": 0.5, "age": 0.1, "spam": 2.0,
}

_EXPORT_COLS = [
    "domain", "tld", "drop_date", "final_score",
    "wp_links", "cc_rank", "cc_harmonic", "first_year", "crawl_count",
    "dfs_rank", "referring_domains", "backlinks", "spam_score",
    "length", "has_hyphen", "has_digit", "is_dict_word", "pre_score",
]


def compute_final_score(r: dict, w: dict, year: int) -> float:
    def L(x):
        return math.log10((x or 0) + 1)
    cc_rank = r.get("cc_rank")
    cc = 0.0 if cc_rank is None else max(0.0, 8.0 - math.log10(cc_rank + 1))
    fy = r.get("first_year")
    age = 0.0 if fy is None else max(0, year - fy)
    return (
        w["wp"] * L(r.get("wp_links"))
        + w["cc"] * cc
        + w["dfs_rank"] * ((r.get("dfs_rank") or 0) / 100.0)
        + w["refdom"] * L(r.get("referring_domains"))
        + w["backlinks"] * L(r.get("backlinks"))
        + w["age"] * age
        - w["spam"] * ((r.get("spam_score") or 0) / 100.0)
    )


def _ensure_col(conn):
    have = {r[1] for r in conn.execute("PRAGMA table_info(candidates)").fetchall()}
    if "final_score" not in have:
        conn.execute("ALTER TABLE candidates ADD COLUMN final_score REAL")
        conn.commit()


@app.command()
def run(
    top: int = typer.Option(0, help="Chỉ xuất top N (0 = tất cả)."),
    date: str = typer.Option(None, help="Hậu tố ngày cho file (mặc định hôm nay)."),
    db: str = typer.Option(None),
    out: str = typer.Option(None, help="Đường dẫn CSV (mặc định data/final_<date>.csv)."),
):
    """Chấm final_score cho candidates → xuất final_<date>.csv (UTF-8 BOM), sort giảm dần."""
    cfg = load_config().get("score", {}) or {}
    w = {**_DEFAULT_WEIGHTS, **(cfg.get("weights") or {})}
    year = _dt.date.today().year
    date = date or _dt.date.today().strftime("%Y%m%d")

    dbp = resolve_path(db) if db else db_path()
    conn = get_conn(dbp)
    init_db(conn)
    conn.row_factory = __import__("sqlite3").Row
    have = {r[1] for r in conn.execute("PRAGMA table_info(candidates)").fetchall()}
    if not have:
        typer.echo("Chưa có bảng candidates. Chạy Phase 5 (filter) trước.")
        raise typer.Exit(1)
    _ensure_col(conn)

    rows = [dict(r) for r in conn.execute("SELECT * FROM candidates").fetchall()]
    for r in rows:
        r["final_score"] = round(compute_final_score(r, w, year), 4)
    conn.executemany("UPDATE candidates SET final_score=? WHERE domain=?",
                     [(r["final_score"], r["domain"]) for r in rows])
    conn.commit()

    rows.sort(key=lambda r: r["final_score"], reverse=True)
    if top:
        rows = rows[:top]

    outp = resolve_path(out) if out else resolve_path(f"data/final_{date}.csv")
    outp.parent.mkdir(parents=True, exist_ok=True)
    with open(outp, "w", encoding="utf-8-sig", newline="") as fo:
        wri = csv.writer(fo)
        wri.writerow(_EXPORT_COLS)
        for r in rows:
            wri.writerow([r.get(c, "") if r.get(c) is not None else "" for c in _EXPORT_COLS])
    conn.close()
    typer.echo(f"✓ score: xuất {len(rows):,} domain → {outp}")
