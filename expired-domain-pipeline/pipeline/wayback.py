"""Phase 3 — wayback: tuổi (first_year) + số crawl (proxy) từ Wayback CDX API (miễn phí).

CDX: collapse=timestamp:4 → ~1 dòng/năm. first_year = năm nhỏ nhất; crawl_count = số dòng.
Async có giới hạn concurrency + rps + backoff 429, cache theo domain (bảng wayback).
"""
from __future__ import annotations

import asyncio
import datetime as _dt
from pathlib import Path
from typing import Iterable, Optional

import typer

from .config import db_path, resolve_path
from .db import get_conn, init_db

app = typer.Typer(help="wayback — tuổi & số crawl từ Wayback CDX.")

CDX_URL = ("http://web.archive.org/cdx/search/cdx"
           "?url={domain}&output=json&fl=timestamp&collapse=timestamp:4&limit=100000")


def parse_cdx_json(data) -> tuple[Optional[int], int]:
    """(first_year, crawl_count) từ JSON CDX. Dòng đầu là header → bỏ."""
    if not isinstance(data, list) or len(data) <= 1:
        return None, 0
    rows = data[1:]
    years = []
    for r in rows:
        if r and isinstance(r, list) and str(r[0])[:4].isdigit():
            years.append(int(str(r[0])[:4]))
    return (min(years) if years else None), len(rows)


class _RateLimiter:
    def __init__(self, rps: float):
        self.min_interval = 1.0 / rps if rps and rps > 0 else 0.0
        self._lock = asyncio.Lock()
        self._next = 0.0

    async def wait(self):
        if self.min_interval <= 0:
            return
        async with self._lock:
            loop = asyncio.get_running_loop()
            now = loop.time()
            if now < self._next:
                await asyncio.sleep(self._next - now)
                now = loop.time()
            self._next = now + self.min_interval


async def _fetch(client, domain: str, sem, lim: "_RateLimiter", retries: int = 5):
    import httpx
    async with sem:
        for attempt in range(retries):
            await lim.wait()
            try:
                r = await client.get(CDX_URL.format(domain=domain), timeout=30.0)
                if r.status_code == 429:
                    await asyncio.sleep(min(60, 2 ** attempt))
                    continue
                r.raise_for_status()
                return parse_cdx_json(r.json())
            except Exception:  # noqa: BLE001 — network/JSON đều retry
                await asyncio.sleep(min(30, 2 ** attempt))
        return None, 0


async def _run_gather(domains: list[str], concurrency: int, rps: float, conn):
    import httpx
    sem = asyncio.Semaphore(concurrency)
    lim = _RateLimiter(rps)
    now = _dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    results: list[tuple] = []
    async with httpx.AsyncClient(headers={"User-Agent": "expired-domain-pipeline/0.1"}) as client:
        async def one(d):
            fy, cc = await _fetch(client, d, sem, lim)
            return (d, fy, cc, now)
        coros = [one(d) for d in domains]
        for i in range(0, len(coros), 2000):
            chunk = await asyncio.gather(*coros[i:i + 2000])
            conn.executemany(
                "INSERT OR REPLACE INTO wayback(domain,first_year,crawl_count,checked_at) "
                "VALUES(?,?,?,?)", chunk)
            conn.commit()
            results.extend(chunk)
            typer.echo(f"  … {min(i + 2000, len(coros)):,}/{len(coros):,}")
    return results


def _load_domains(in_file: Optional[str], from_table: Optional[str], conn) -> list[str]:
    if in_file:
        with open(resolve_path(in_file), "r", encoding="utf-8") as f:
            return [ln.strip().lower() for ln in f if ln.strip()]
    if from_table in ("drops", "candidates"):
        col = "domain"
        rows = conn.execute(f"SELECT DISTINCT {col} FROM {from_table}").fetchall()
        return [r[0] for r in rows]
    raise typer.BadParameter("Cần --in <file> hoặc --from drops|candidates")


@app.command()
def check(
    in_: str = typer.Option(None, "--in", help="File domain (mỗi dòng 1)."),
    from_table: str = typer.Option(None, "--from", help="drops | candidates."),
    concurrency: int = typer.Option(10, help="Số request song song."),
    rps: float = typer.Option(5.0, help="Request/giây (tránh 429)."),
    limit: int = typer.Option(0, help="Chỉ check N domain (0=all)."),
    db: str = typer.Option(None),
):
    """Check Wayback cho danh sách domain (bỏ qua domain đã có cache)."""
    dbp = resolve_path(db) if db else db_path()
    conn = get_conn(dbp)
    init_db(conn)
    domains = _load_domains(in_, from_table, conn)
    cached = {r[0] for r in conn.execute("SELECT domain FROM wayback").fetchall()}
    todo = [d for d in dict.fromkeys(domains) if d and d not in cached]
    if limit:
        todo = todo[:limit]
    if not todo:
        typer.echo("Không có domain mới cần check (đã cache hết).")
        return
    typer.echo(f"Wayback: {len(todo):,} domain (concurrency={concurrency}, rps={rps})")
    asyncio.run(_run_gather(todo, concurrency, rps, conn))
    conn.close()
    typer.echo("✓ Wayback xong.")
