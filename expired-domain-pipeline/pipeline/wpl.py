"""WPL = số link từ Wikipedia trỏ về mỗi domain (thay cột WPL của ExpiredDomains).

Đọc dump `<wiki>-latest-externallinks.sql.gz` của Wikimedia, TỰ ĐỌC `CREATE TABLE`
để lấy layout cột hiện hành (schema đổi ~2024: bỏ `el_to`, thêm
`el_to_domain_index` + `el_to_path`), rút registered domain rồi đếm số link/domain.

Streaming (RAM giới hạn): đếm bằng dict, định kỳ flush cộng dồn sang SQLite.
"""
from __future__ import annotations

import csv
import gzip
import re
from pathlib import Path
from typing import Iterable, Iterator, Optional

import typer
from tqdm import tqdm

from .config import db_path, load_config, resolve_path
from .db import get_conn, init_db
from .domains import host_from_domain_index, host_from_url, registered_domain
from .httpx_dl import download

app = typer.Typer(help="WPL — Wikipedia external-link count per domain.")


# ─── SQL dump parsing ────────────────────────────────────────────────────────

def _split_top_level_commas(s: str) -> list[str]:
    parts, buf, depth, inq = [], [], 0, False
    for ch in s:
        if inq:
            buf.append(ch)
            if ch == "'":
                inq = False
        elif ch == "'":
            inq = True; buf.append(ch)
        elif ch == "(":
            depth += 1; buf.append(ch)
        elif ch == ")":
            depth -= 1; buf.append(ch)
        elif ch == "," and depth == 0:
            parts.append("".join(buf)); buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append("".join(buf))
    return parts


def find_columns_in_create(sql: str) -> list[str]:
    """Lấy tên cột theo THỨ TỰ từ câu CREATE TABLE (bỏ dòng KEY/PRIMARY/…)."""
    start = sql.find("(")
    if start < 0:
        return []
    depth, end = 0, -1
    for i in range(start, len(sql)):
        if sql[i] == "(":
            depth += 1
        elif sql[i] == ")":
            depth -= 1
            if depth == 0:
                end = i
                break
    inner = sql[start + 1: end if end > 0 else len(sql)]
    cols: list[str] = []
    for part in _split_top_level_commas(inner):
        p = part.strip()
        if not p.startswith("`"):
            continue  # KEY / PRIMARY KEY / UNIQUE / … không bắt đầu bằng backtick
        m = re.match(r"`([^`]+)`", p)
        if m:
            cols.append(m.group(1))
    return cols


def parse_row_tuples(s: str) -> Iterator[list[Optional[str]]]:
    """Parse phần sau 'VALUES' của một câu INSERT → yield từng tuple (list field)."""
    i, n = 0, len(s)
    while i < n:
        while i < n and s[i] != "(":
            if s[i] == ";":
                return
            i += 1
        if i >= n:
            return
        i += 1  # skip '('
        fields: list[Optional[str]] = []
        while i < n:
            while i < n and s[i] in " \t\r\n":
                i += 1
            if i >= n:
                break
            if s[i] == ")":
                i += 1
                break
            if s[i:i + 8].lower() == "_binary ":
                i += 8
                while i < n and s[i] in " \t":
                    i += 1
            c = s[i] if i < n else ""
            if c == "'":
                i += 1
                buf: list[str] = []
                while i < n:
                    ch = s[i]
                    if ch == "\\":
                        if i + 1 < n:
                            nx = s[i + 1]
                            buf.append(
                                {"n": "\n", "t": "\t", "r": "\r", "0": "\0",
                                 "b": "\b", "Z": "\x1a"}.get(nx, nx)
                            )
                            i += 2
                            continue
                        i += 1
                        continue
                    if ch == "'":
                        if i + 1 < n and s[i + 1] == "'":
                            buf.append("'"); i += 2; continue
                        i += 1
                        break
                    buf.append(ch); i += 1
                fields.append("".join(buf))
            elif c == "0" and i + 1 < n and s[i + 1] in "xX":
                j = i + 2
                while j < n and s[j] in "0123456789abcdefABCDEF":
                    j += 1
                try:
                    fields.append(bytes.fromhex(s[i + 2:j]).decode("utf-8", "replace"))
                except ValueError:
                    fields.append("")
                i = j
            else:
                j = i
                while j < n and s[j] not in ",)":
                    j += 1
                tok = s[i:j].strip()
                fields.append(None if tok.upper() == "NULL" else tok)
                i = j
            while i < n and s[i] in " \t\r\n":
                i += 1
            if i < n and s[i] == ",":
                i += 1
                continue
            if i < n and s[i] == ")":
                i += 1
                break
        yield fields
        while i < n and s[i] not in ",;":
            i += 1
        if i < n and s[i] == ";":
            return
        if i < n and s[i] == ",":
            i += 1


def detect_url_column(columns: list[str]) -> tuple[str, int]:
    """Trả (mode, index): 'url'/el_to (cũ) hoặc 'domain_index'/el_to_domain_index (mới)."""
    if "el_to" in columns:
        return "url", columns.index("el_to")
    if "el_to_domain_index" in columns:
        return "domain_index", columns.index("el_to_domain_index")
    raise ValueError(
        f"Không tìm thấy cột URL trong externallinks. Cột đọc được: {columns}"
    )


def _domain_from_field(field: Optional[str], mode: str) -> Optional[str]:
    if field is None:
        return None
    host = host_from_url(field) if mode == "url" else host_from_domain_index(field)
    return registered_domain(host)


def _is_insert_line(line: str) -> bool:
    ls = line.lstrip()
    return ls[:11].upper() == "INSERT INTO" and "`externallinks`" in ls[:80]


def _values_pos(line: str) -> int:
    p = line.upper().find("VALUES")
    return p + 6 if p >= 0 else -1


def iter_domains(lines: Iterable[str], skip: set[str]) -> Iterator[str]:
    """Từ các dòng dump → yield registered domain (đã bỏ self-links & skip set).

    Tự đọc CREATE TABLE để biết cột nào chứa URL trước khi parse INSERT.
    """
    columns: Optional[list[str]] = None
    mode = ""
    idx = -1
    capturing = False
    create_buf: list[str] = []
    for line in lines:
        if columns is None:
            if not capturing and "CREATE TABLE" in line and "`externallinks`" in line:
                capturing = True
            if capturing:
                create_buf.append(line)
                if "ENGINE=" in line or line.strip().endswith(");"):
                    columns = find_columns_in_create("".join(create_buf))
                    mode, idx = detect_url_column(columns)
                    capturing = False
            continue
        if _is_insert_line(line):
            pos = _values_pos(line)
            if pos < 0:
                continue
            for row in parse_row_tuples(line[pos:]):
                field = row[idx] if 0 <= idx < len(row) else None
                dom = _domain_from_field(field, mode)
                if dom and dom not in skip:
                    yield dom


def count_domains_from_text(dump_text: str, skip: Optional[set[str]] = None) -> dict[str, int]:
    """Tiện cho test/nhỏ: parse cả một chuỗi dump → dict {domain: count}."""
    counts: dict[str, int] = {}
    for dom in iter_domains(dump_text.splitlines(keepends=True), skip or set()):
        counts[dom] = counts.get(dom, 0) + 1
    return counts


# ─── IO helpers ──────────────────────────────────────────────────────────────

def _open_dump(path: Path):
    if str(path).endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return open(path, "rt", encoding="utf-8", errors="replace")


def _resolve_dump(dump: Optional[str], url: Optional[str], wiki: str, cfg: dict) -> Path:
    if dump:
        p = resolve_path(dump)
        if not p.exists():
            raise FileNotFoundError(f"Dump không tồn tại: {p}")
        return p
    if not url:
        url = cfg["wpl"]["wikis"].get(wiki)
        if not url:
            raise ValueError(f"Chưa cấu hình URL cho wiki '{wiki}' trong config.yaml")
    dest = resolve_path(f"data/dumps/{wiki}-externallinks.sql.gz")
    typer.echo(f"↓ Tải dump: {url}")
    return download(url, dest)


def _flush(conn, counts: dict[str, int]) -> None:
    if not counts:
        return
    conn.executemany(
        "INSERT INTO wpl(domain, wp_links) VALUES(?, ?) "
        "ON CONFLICT(domain) DO UPDATE SET wp_links = wp_links + excluded.wp_links",
        list(counts.items()),
    )
    conn.commit()
    counts.clear()


# ─── CLI ─────────────────────────────────────────────────────────────────────

@app.command()
def build(
    dump: str = typer.Option(None, help="Đường dẫn file dump local (.sql.gz hoặc .sql)."),
    url: str = typer.Option(None, help="URL dump (ghi đè config)."),
    wiki: str = typer.Option("enwiki", help="Tên wiki trong config.yaml."),
    db: str = typer.Option(None, help="Đường dẫn SQLite (mặc định từ config)."),
    flush_size: int = typer.Option(None, help="Số domain duy nhất/lần flush (RAM)."),
    limit: int = typer.Option(0, help="Chỉ xử lý N link đầu (để test nhanh, 0 = full)."),
):
    """Parse dump externallinks → bảng wpl(domain, wp_links). Chạy lại = rebuild sạch."""
    cfg = load_config()
    dbp = resolve_path(db) if db else db_path()
    flush = flush_size or cfg["wpl"]["flush_size"]
    skip = set(cfg["wpl"].get("skip_domains", []))
    path = _resolve_dump(dump, url, wiki, cfg)

    conn = get_conn(dbp)
    init_db(conn)
    conn.execute("DELETE FROM wpl")
    conn.commit()

    counts: dict[str, int] = {}
    processed = 0
    with _open_dump(path) as f:
        gen = iter_domains(f, skip)
        for dom in tqdm(gen, unit="link", desc=f"WPL {wiki}"):
            counts[dom] = counts.get(dom, 0) + 1
            processed += 1
            if len(counts) >= flush:
                _flush(conn, counts)
            if limit and processed >= limit:
                break
    _flush(conn, counts)

    total_domains = conn.execute("SELECT COUNT(*) FROM wpl").fetchone()[0]
    total_links = conn.execute("SELECT COALESCE(SUM(wp_links),0) FROM wpl").fetchone()[0]
    conn.close()
    typer.echo(
        f"✓ WPL xong: {total_domains:,} domain · {total_links:,} link "
        f"(đã xử lý {processed:,} external link)."
    )


@app.command()
def lookup(domain: str, db: str = typer.Option(None)):
    """Tra nhanh wp_links của 1 domain."""
    from .domains import registered_domain as _rd
    dbp = resolve_path(db) if db else db_path()
    conn = get_conn(dbp)
    key = _rd(domain) or domain.strip().lower()
    row = conn.execute("SELECT wp_links FROM wpl WHERE domain=?", (key,)).fetchone()
    conn.close()
    typer.echo(f"{key}\t{row[0] if row else 0}")


@app.command()
def annotate(
    in_: str = typer.Option(..., "--in", help="File domain (mỗi dòng 1 domain)."),
    out: str = typer.Option(..., "--out", help="CSV output (UTF-8 BOM)."),
    db: str = typer.Option(None),
):
    """Thêm cột wp_links cho một danh sách domain (không có = 0)."""
    from .domains import registered_domain as _rd
    dbp = resolve_path(db) if db else db_path()
    conn = get_conn(dbp)
    inp, outp = resolve_path(in_), resolve_path(out)
    outp.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(inp, "r", encoding="utf-8") as fi, \
            open(outp, "w", encoding="utf-8-sig", newline="") as fo:
        w = csv.writer(fo)
        w.writerow(["domain", "wp_links"])
        for line in fi:
            d = line.strip()
            if not d:
                continue
            key = _rd(d) or d.lower()
            row = conn.execute("SELECT wp_links FROM wpl WHERE domain=?", (key,)).fetchone()
            w.writerow([d, row[0] if row else 0])
            n += 1
    conn.close()
    typer.echo(f"✓ Ghi {n:,} dòng → {outp}")


@app.command()
def sample(
    dump: str = typer.Option(None),
    url: str = typer.Option(None),
    wiki: str = typer.Option("enwiki"),
    n: int = typer.Option(30, help="Số mẫu in ra để verify parser."),
):
    """In vài chục URL/domain mẫu để KIỂM TRA parser trước khi chạy full."""
    cfg = load_config()
    path = _resolve_dump(dump, url, wiki, cfg)
    printed = 0
    with _open_dump(path) as f:
        for dom in iter_domains(f, set()):
            typer.echo(dom)
            printed += 1
            if printed >= n:
                break
    typer.echo(f"— {printed} domain mẫu (kiểm tra bằng mắt rồi mới chạy `build`).")
