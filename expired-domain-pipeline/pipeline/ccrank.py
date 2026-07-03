"""Phase 4 — ccrank: authority sơ bộ (miễn phí) từ Common Crawl domain-level rank.

File domain-ranks (TSV, gz): các cột
  harmonicc_pos  harmonicc_val  pr_pos  pr_val  <reversed_domain>
`reversed_domain` kiểu 'com.example' → un-reverse thành 'example.com'.
cc_rank = thứ hạng (nhỏ = mạnh); cc_harmonic = harmonic centrality value.
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterator, Optional

import typer

from .config import db_path, resolve_path
from .db import get_conn, init_db
from .domains import host_from_domain_index, registered_domain
from .util import open_text_read

app = typer.Typer(help="ccrank — nạp Common Crawl domain rank.")


def parse_rank_line(line: str, rank: str = "harmonic") -> Optional[tuple[str, int, float]]:
    """(domain, cc_rank, cc_harmonic) từ 1 dòng domain-ranks. None nếu header/hỏng."""
    line = line.rstrip("\n")
    if not line or line[0] == "#":
        return None
    f = line.split("\t") if "\t" in line else line.split()
    if len(f) < 5:
        return None
    rev = f[-1].strip()
    host = host_from_domain_index(rev)  # 'com.example' -> 'example.com'
    dom = registered_domain(host) if host else None
    if not dom:
        return None
    try:
        cc_rank = int(f[0]) if rank == "harmonic" else int(f[2])
        cc_harmonic = float(f[1])
    except (ValueError, IndexError):
        return None
    return dom, cc_rank, cc_harmonic


def iter_ranks(fileobj, rank: str = "harmonic") -> Iterator[tuple[str, int, float]]:
    for line in fileobj:
        row = parse_rank_line(line, rank)
        if row:
            yield row


@app.command()
def load(
    rankfile: str = typer.Option(..., help="File domain-ranks (.gz local) hoặc URL."),
    rank: str = typer.Option("harmonic", help="harmonic | pagerank (dùng làm cc_rank)."),
    filter: str = typer.Option("drops", help="drops = chỉ nạp domain đã drop; all = nạp hết."),
    db: str = typer.Option(None),
):
    """Nạp Common Crawl rank vào bảng ccrank (mặc định chỉ domain trong `drops`)."""
    dbp = resolve_path(db) if db else db_path()
    conn = get_conn(dbp)
    init_db(conn)

    path = rankfile
    if rankfile.startswith(("http://", "https://")):
        from .httpx_dl import download
        path = download(rankfile, resolve_path("data/dumps/cc-domain-ranks.txt.gz"))

    keep: Optional[set[str]] = None
    if filter == "drops":
        keep = {r[0] for r in conn.execute("SELECT DISTINCT domain FROM drops").fetchall()}
        if not keep:
            typer.echo("⚠️ Bảng drops rỗng — chạy Phase 2 trước, hoặc dùng --filter all.")
            raise typer.Exit(1)
        typer.echo(f"Chỉ nạp rank cho {len(keep):,} domain đã drop.")

    conn.execute("DELETE FROM ccrank")
    conn.commit()
    n = 0
    batch = []
    with open_text_read(path) as f:
        for dom, cc_rank, cc_h in iter_ranks(f, rank):
            if keep is not None and dom not in keep:
                continue
            batch.append((dom, cc_rank, cc_h))
            n += 1
            if len(batch) >= 5000:
                conn.executemany(
                    "INSERT OR REPLACE INTO ccrank(domain,cc_rank,cc_harmonic) VALUES(?,?,?)", batch)
                conn.commit(); batch.clear()
    if batch:
        conn.executemany(
            "INSERT OR REPLACE INTO ccrank(domain,cc_rank,cc_harmonic) VALUES(?,?,?)", batch)
        conn.commit()
    conn.close()
    typer.echo(f"✓ ccrank: nạp {n:,} domain (rank={rank}).")
