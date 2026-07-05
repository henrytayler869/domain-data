"""Phase 2 — drops: lấy domain vừa xoá mỗi ngày bằng cách diff zone file ICANN CZDS.

- pull:     CZDS download zone <tld> → rút registered domain duy nhất (sorted) → snapshot ngày.
- from-zone: build snapshot từ zone file local (đỡ cần CZDS lúc test).
- diff:     so 2 snapshot gần nhất → domain drop → bảng drops + drops_<date>.csv.
"""
from __future__ import annotations

import csv
import datetime as _dt
import tempfile
from pathlib import Path
from typing import Iterator, Optional

import typer

from .config import db_path, resolve_path
from .db import get_conn, init_db
from .util import diff_sorted, open_text_read, sort_unique_to_file

app = typer.Typer(help="drops — diff zone CZDS lấy domain drop hằng ngày.")

# Các RR type hợp lệ trong zone (để nhận diện cột type, bỏ qua TTL/IN).
_RTYPES = {
    "NS", "DS", "A", "AAAA", "SOA", "RRSIG", "NSEC", "NSEC3", "NSEC3PARAM",
    "DNSKEY", "TXT", "CNAME", "MX", "CAA", "TLSA", "SRV", "PTR", "NAPTR",
}


def extract_registered_from_zone_line(line: str, tld: str) -> Optional[str]:
    """Registered domain từ 1 dòng zone: chỉ lấy owner của bản ghi NS ở depth-2.

    Bỏ glue (A/AAAA của nameserver, depth>=3) và DS/RRSIG…
    """
    line = line.strip()
    if not line or line[0] in ";$":
        return None
    parts = line.split()
    if len(parts) < 4:
        return None
    rtype = None
    for p in parts[1:]:
        pu = p.upper()
        if pu in _RTYPES:
            rtype = pu
            break
    if rtype != "NS":
        return None
    owner = parts[0].rstrip(".").lower()
    labels = owner.split(".")
    if len(labels) != 2 or labels[-1] != tld.lower().lstrip("."):
        return None
    return owner


def iter_zone_domains(fileobj, tld: str) -> Iterator[str]:
    for line in fileobj:
        d = extract_registered_from_zone_line(line, tld)
        if d:
            yield d


def build_snapshot(zone_path: str | Path, tld: str, out_path: str | Path,
                   chunk_size: int = 2_000_000) -> int:
    """Zone file → snapshot sorted-unique registered domain (gz)."""
    with open_text_read(zone_path) as f:
        return sort_unique_to_file(iter_zone_domains(f, tld), out_path, chunk_size=chunk_size)


def _today() -> str:
    return _dt.date.today().strftime("%Y%m%d")


def _snapshot_path(tld: str, date: str) -> Path:
    return resolve_path(f"data/zones/{tld}/{date}.txt.gz")


def _list_snapshots(tld: str) -> list[Path]:
    d = resolve_path(f"data/zones/{tld}")
    if not d.exists():
        return []
    return sorted(d.glob("*.txt.gz"))


# ─── CLI ─────────────────────────────────────────────────────────────────────

@app.command()
def pull(
    tld: str = typer.Option(..., help="TLD: com/net/org…"),
    date: str = typer.Option(None, help="Ngày snapshot YYYYMMDD (mặc định hôm nay)."),
    chunk_size: int = typer.Option(2_000_000, help="Số domain/lần spill (RAM)."),
):
    """Tải zone <tld> qua CZDS + build snapshot sorted-unique cho ngày."""
    from .czds import download_zone, get_token, link_for_tld

    date = date or _today()
    out = _snapshot_path(tld, date)
    token = get_token()
    url = link_for_tld(token, tld)
    if not url:
        raise typer.BadParameter(f"Tài khoản CZDS chưa được duyệt/không thấy zone '{tld}'.")
    typer.echo(f"↓ CZDS zone {tld} …")
    zones_dir = resolve_path("data/zones")
    zones_dir.mkdir(parents=True, exist_ok=True)
    # Temp path cố định (không dùng mkstemp — trên Windows unlink file đang mở handle sẽ lỗi).
    tmp = zones_dir / f"_{tld}_download.zone.gz"
    tmp.unlink(missing_ok=True)
    Path(str(tmp) + ".part").unlink(missing_ok=True)
    try:
        download_zone(url, token, tmp)
        n = build_snapshot(tmp, tld, out, chunk_size=chunk_size)
    finally:
        tmp.unlink(missing_ok=True)
        Path(str(tmp) + ".part").unlink(missing_ok=True)
    typer.echo(f"✓ Snapshot {tld} {date}: {n:,} domain → {out}")


@app.command("from-zone")
def from_zone(
    tld: str = typer.Option(...),
    zone: str = typer.Option(..., help="Zone file local (.gz hoặc text)."),
    date: str = typer.Option(None),
    chunk_size: int = typer.Option(2_000_000),
):
    """Build snapshot từ zone file LOCAL (không cần CZDS)."""
    date = date or _today()
    out = _snapshot_path(tld, date)
    n = build_snapshot(resolve_path(zone), tld, out, chunk_size=chunk_size)
    typer.echo(f"✓ Snapshot {tld} {date}: {n:,} domain → {out}")


@app.command()
def diff(
    tld: str = typer.Option(...),
    date: str = typer.Option(None, help="Snapshot 'hôm nay' (mặc định: mới nhất)."),
    db: str = typer.Option(None),
):
    """Diff snapshot mới nhất vs trước đó → domain drop → bảng drops + CSV."""
    snaps = _list_snapshots(tld)
    if len(snaps) < 2:
        raise typer.BadParameter(f"Cần >=2 snapshot của '{tld}' để diff (có {len(snaps)}).")
    if date:
        today = _snapshot_path(tld, date)
        if today not in snaps:
            raise typer.BadParameter(f"Không có snapshot {tld} {date}.")
        prev = snaps[snaps.index(today) - 1]
    else:
        today, prev = snaps[-1], snaps[-2]
    drop_date = today.name.split(".")[0]  # YYYYMMDD (bỏ .txt.gz, không chỉ .gz)

    dbp = resolve_path(db) if db else db_path()
    conn = get_conn(dbp)
    init_db(conn)
    out_csv = resolve_path(f"data/drops_{drop_date}.csv")
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as fo:
        w = csv.writer(fo)
        w.writerow(["domain", "tld", "drop_date"])
        batch = []
        for dom in diff_sorted(prev, today):
            w.writerow([dom, tld, drop_date])
            batch.append((dom, tld, drop_date))
            n += 1
            if len(batch) >= 5000:
                conn.executemany("INSERT OR IGNORE INTO drops(domain,tld,drop_date) VALUES(?,?,?)", batch)
                conn.commit(); batch.clear()
        if batch:
            conn.executemany("INSERT OR IGNORE INTO drops(domain,tld,drop_date) VALUES(?,?,?)", batch)
            conn.commit()
    conn.close()
    typer.echo(f"✓ Drop {tld} {drop_date}: {n:,} domain (prev={prev.stem}) → {out_csv}")


@app.command("list")
def list_snaps(tld: str = typer.Option(...)):
    """Liệt kê snapshot đã có của một TLD."""
    for p in _list_snapshots(tld):
        typer.echo(p.stem)
