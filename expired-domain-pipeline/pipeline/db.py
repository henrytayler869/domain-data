"""SQLite hub — join dữ liệu giữa các phase."""
from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS wpl (
    domain   TEXT PRIMARY KEY,
    wp_links INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ccrank (
    domain      TEXT PRIMARY KEY,
    cc_rank     INTEGER,
    cc_harmonic REAL
);
CREATE TABLE IF NOT EXISTS wayback (
    domain      TEXT PRIMARY KEY,
    first_year  INTEGER,
    crawl_count INTEGER,
    checked_at  TEXT
);
CREATE TABLE IF NOT EXISTS drops (
    domain    TEXT NOT NULL,
    tld       TEXT NOT NULL,
    drop_date TEXT NOT NULL,
    PRIMARY KEY (domain, drop_date)
);
"""


def get_conn(path: str | Path) -> sqlite3.Connection:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    # Tối ưu ghi hàng loạt (WPL flush nhiều lần).
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()
