"""Phase 5 — filter: phễu lọc RẺ. Join drops + wpl + ccrank + wayback + name features,
tính pre_score (trọng số cấu hình), giữ domain qua ngưỡng → bảng/candidates.csv.
"""
from __future__ import annotations

import csv
import datetime as _dt
import math
from pathlib import Path
from typing import Optional

import typer

from .config import db_path, load_config, resolve_path
from .db import get_conn, init_db

app = typer.Typer(help="filter — lọc rẻ trước khi tiêu tiền DataForSEO.")

CANDIDATES_DDL = """
CREATE TABLE IF NOT EXISTS candidates (
    domain       TEXT PRIMARY KEY,
    tld          TEXT,
    drop_date    TEXT,
    wp_links     INTEGER DEFAULT 0,
    cc_rank      INTEGER,
    cc_harmonic  REAL,
    first_year   INTEGER,
    crawl_count  INTEGER,
    length       INTEGER,
    has_hyphen   INTEGER,
    has_digit    INTEGER,
    is_dict_word INTEGER,
    pre_score    REAL
);
"""

_DEFAULT_FILTER = {
    "keep": {"min_wp": 1, "max_cc_rank": 5_000_000, "min_age_years": 8},
    "weights": {"wp": 2.0, "cc": 1.5, "age": 0.15, "dict": 1.5, "hyphen": 1.0, "digit": 0.7},
    "wordlist": None,
}


def _load_wordset(path: Optional[str]) -> set[str]:
    if not path:
        return set()
    p = resolve_path(path)
    if not p.exists():
        return set()
    with open(p, "r", encoding="utf-8") as f:
        return {w.strip().lower() for w in f if w.strip()}


def name_features(domain: str, wordset: set[str]) -> tuple[int, bool, bool, bool, str]:
    """length(sld), has_hyphen, has_digit, is_dict_word, tld."""
    sld = domain.split(".")[0]
    tld = domain.rsplit(".", 1)[-1] if "." in domain else ""
    return (
        len(sld),
        "-" in sld,
        any(c.isdigit() for c in sld),
        (sld in wordset) if wordset else False,
        tld,
    )


def pre_score(wp_links: int, cc_rank: Optional[int], first_year: Optional[int],
              is_dict: bool, has_hyphen: bool, has_digit: bool,
              weights: dict, year: int) -> float:
    wp = math.log10(wp_links + 1)                                  # 0..~5
    cc = 0.0 if cc_rank is None else max(0.0, 8.0 - math.log10(cc_rank + 1))  # rank 1→8
    age = 0.0 if first_year is None else max(0, year - first_year)
    return (
        weights["wp"] * wp
        + weights["cc"] * cc
        + weights["age"] * age
        + weights["dict"] * (1 if is_dict else 0)
        - weights["hyphen"] * (1 if has_hyphen else 0)
        - weights["digit"] * (1 if has_digit else 0)
    )


@app.command()
def run(
    drop_date: str = typer.Option(None, help="Chỉ lọc drops của ngày này (mặc định: tất cả)."),
    db: str = typer.Option(None),
    out: str = typer.Option("data/candidates.csv", help="CSV output."),
):
    """Lọc drops → candidates. In thống kê vào/ra theo từng tín hiệu."""
    cfg = load_config().get("filter", {}) or {}
    keep = {**_DEFAULT_FILTER["keep"], **(cfg.get("keep") or {})}
    weights = {**_DEFAULT_FILTER["weights"], **(cfg.get("weights") or {})}
    wordset = _load_wordset(cfg.get("wordlist", _DEFAULT_FILTER["wordlist"]))
    year = _dt.date.today().year

    dbp = resolve_path(db) if db else db_path()
    conn = get_conn(dbp)
    init_db(conn)
    conn.executescript(CANDIDATES_DDL)

    where = "WHERE d.drop_date = ?" if drop_date else ""
    params = (drop_date,) if drop_date else ()
    sql = f"""
        SELECT d.domain, d.tld, d.drop_date,
               COALESCE(w.wp_links,0), c.cc_rank, c.cc_harmonic,
               wb.first_year, wb.crawl_count
        FROM drops d
        LEFT JOIN wpl     w  ON w.domain  = d.domain
        LEFT JOIN ccrank  c  ON c.domain  = d.domain
        LEFT JOIN wayback wb ON wb.domain = d.domain
        {where}
    """

    total = 0
    kept = 0
    by = {"wp": 0, "cc": 0, "age": 0}
    outp = resolve_path(out)
    outp.parent.mkdir(parents=True, exist_ok=True)
    conn.execute("DELETE FROM candidates")
    conn.commit()

    with open(outp, "w", encoding="utf-8-sig", newline="") as fo:
        w = csv.writer(fo)
        cols = ["domain", "tld", "drop_date", "wp_links", "cc_rank", "cc_harmonic",
                "first_year", "crawl_count", "length", "has_hyphen", "has_digit",
                "is_dict_word", "pre_score"]
        w.writerow(cols)
        batch = []
        for domain, tld, dd, wp_links, cc_rank, cc_h, first_year, crawl_count in conn.execute(sql, params):
            total += 1
            length, has_hyphen, has_digit, is_dict, _tld = name_features(domain, wordset)
            pass_wp = wp_links >= keep["min_wp"]
            pass_cc = cc_rank is not None and cc_rank <= keep["max_cc_rank"]
            pass_age = first_year is not None and first_year <= (year - keep["min_age_years"])
            if not (pass_wp or pass_cc or pass_age):
                continue
            kept += 1
            by["wp"] += pass_wp
            by["cc"] += pass_cc
            by["age"] += pass_age
            ps = round(pre_score(wp_links, cc_rank, first_year, is_dict,
                                 has_hyphen, has_digit, weights, year), 4)
            row = [domain, tld, dd, wp_links, cc_rank, cc_h, first_year, crawl_count,
                   length, int(has_hyphen), int(has_digit), int(is_dict), ps]
            w.writerow(row)
            batch.append(tuple(row))
            if len(batch) >= 5000:
                conn.executemany(
                    "INSERT OR REPLACE INTO candidates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
                conn.commit(); batch.clear()
        if batch:
            conn.executemany(
                "INSERT OR REPLACE INTO candidates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
            conn.commit()
    conn.close()
    typer.echo(
        f"✓ filter: {total:,} drops → giữ {kept:,} candidates "
        f"(qua wp={by['wp']:,} · cc={by['cc']:,} · age={by['age']:,}) → {outp}"
    )
