"""Phase 6 — dataforseo: enrich `candidates` bằng Backlinks bulk endpoints (Live).

Endpoints (mỗi call tối đa 1000 targets; body [{"targets":[...]}]):
  bulk_ranks/live            -> rank              (0..1000)
  bulk_referring_domains/live-> referring_domains
  bulk_backlinks/live        -> backlinks
  bulk_spam_score/live       -> spam_score        (0..100)
Auth Basic (DFS_LOGIN/DFS_PASSWORD). Parse theo item.target (không dựa thứ tự).
Estimate chi phí trước khi chạy; ghi tổng cost thực tế.
"""
from __future__ import annotations

import asyncio
import math
import os
from pathlib import Path
from typing import Optional

import typer

from .config import db_path, load_config, resolve_path
from .db import get_conn, init_db

app = typer.Typer(help="dataforseo — enrich candidates (bulk backlinks).")

BASE = "https://api.dataforseo.com/v3/backlinks"
ENDPOINTS = {
    "dfs_rank": ("bulk_ranks/live", "rank"),
    "referring_domains": ("bulk_referring_domains/live", "referring_domains"),
    "backlinks": ("bulk_backlinks/live", "backlinks"),
    "spam_score": ("bulk_spam_score/live", "spam_score"),
}


def parse_bulk_response(data: dict, field: str) -> dict[str, object]:
    """{target: value} — duyệt tasks[].result[].items[].target (không theo thứ tự)."""
    out: dict[str, object] = {}
    for task in (data.get("tasks") or []):
        for res in (task.get("result") or []):
            for item in (res.get("items") or []):
                t = item.get("target")
                if t:
                    out[str(t).lower()] = item.get(field)
    return out


def response_cost(data: dict) -> float:
    if isinstance(data.get("cost"), (int, float)):
        return float(data["cost"])
    return sum(float(t.get("cost") or 0) for t in (data.get("tasks") or []))


def _ensure_columns(conn):
    have = {r[1] for r in conn.execute("PRAGMA table_info(candidates)").fetchall()}
    for col in ("dfs_rank", "referring_domains", "backlinks", "spam_score"):
        if col not in have:
            conn.execute(f"ALTER TABLE candidates ADD COLUMN {col} INTEGER")
    conn.commit()


def _chunks(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


async def _post(client, path: str, targets: list[str], field: str, sem):
    async with sem:
        r = await client.post(f"{BASE}/{path}", json=[{"targets": targets}], timeout=120.0)
        r.raise_for_status()
        data = r.json()
        return parse_bulk_response(data, field), response_cost(data)


async def _run(targets: list[str], concurrency: int, login: str, pw: str):
    import httpx
    sem = asyncio.Semaphore(concurrency)
    merged: dict[str, dict] = {t: {} for t in targets}
    total_cost = 0.0
    async with httpx.AsyncClient(auth=(login, pw),
                                 headers={"User-Agent": "expired-domain-pipeline/0.1"}) as client:
        for col, (path, field) in ENDPOINTS.items():
            coros = [_post(client, path, ch, field, sem) for ch in _chunks(targets, 1000)]
            results = await asyncio.gather(*coros)
            for by_target, cost in results:
                total_cost += cost
                for t, v in by_target.items():
                    if t in merged:
                        merged[t][col] = v
            typer.echo(f"  ✓ {col}")
    return merged, total_cost


@app.command()
def enrich(
    concurrency: int = typer.Option(10, help="Số request song song (DFS cho <=30)."),
    price_per_call: float = typer.Option(0.02, help="Giá ước tính mỗi call (để estimate)."),
    yes: bool = typer.Option(False, "--yes", help="Bỏ qua xác nhận chi phí."),
    limit: int = typer.Option(0, help="Chỉ enrich N candidate đầu (0=all)."),
    db: str = typer.Option(None),
):
    """Enrich candidates bằng 4 bulk endpoint. Estimate chi phí trước khi chạy."""
    login = os.getenv("DFS_LOGIN")
    pw = os.getenv("DFS_PASSWORD")
    if not login or not pw:
        raise typer.BadParameter("Thiếu DFS_LOGIN/DFS_PASSWORD trong .env")

    dbp = resolve_path(db) if db else db_path()
    conn = get_conn(dbp)
    init_db(conn)
    _ensure_columns(conn)
    targets = [r[0] for r in conn.execute(
        "SELECT domain FROM candidates ORDER BY pre_score DESC").fetchall()]
    if limit:
        targets = targets[:limit]
    if not targets:
        typer.echo("Không có candidate. Chạy Phase 5 (filter) trước.")
        return

    n_calls = len(ENDPOINTS) * math.ceil(len(targets) / 1000)
    est = n_calls * price_per_call
    cfg = load_config().get("dataforseo", {}) or {}
    max_cost = float(cfg.get("max_cost_usd", 5.0))
    typer.echo(f"Targets: {len(targets):,} · call dự kiến: {n_calls} · ước tính ~${est:.2f}")
    if not yes and est > max_cost and not typer.confirm(
            f"Ước tính ${est:.2f} > ngưỡng ${max_cost:.2f}. Tiếp tục?"):
        raise typer.Abort()

    merged, cost = asyncio.run(_run(targets, concurrency, login, pw))

    rows = []
    for t, d in merged.items():
        if not d:
            continue
        rows.append((d.get("dfs_rank"), d.get("referring_domains"),
                     d.get("backlinks"), d.get("spam_score"), t))
    conn.executemany(
        "UPDATE candidates SET dfs_rank=?, referring_domains=?, backlinks=?, spam_score=? "
        "WHERE domain=?", rows)
    conn.commit()
    conn.close()
    typer.echo(f"✓ dataforseo: cập nhật {len(rows):,} domain · 💰 cost thực tế ~${cost:.4f}")
