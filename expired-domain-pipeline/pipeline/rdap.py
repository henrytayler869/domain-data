"""Phase 9 — rdap: tra trạng thái vòng đời domain qua RDAP (miễn phí) → cập nhật
expired_candidates.rdap_status / drop_eta trên Supabase.

Chạy MỖI NGÀY trong daily.bat: domain đi redemption → pending-delete mất ~30 ngày,
nên phải refresh hằng ngày thì cảnh báo 'mua ngay' (banner đỏ trên Domain Drop) mới
tự bật đúng lúc domain vào pending-delete / available.
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import json as _json
from collections import Counter

import typer

from .push import _get_creds

app = typer.Typer(help="rdap — trạng thái vòng đời domain (RDAP) → Supabase.")


def _rdap_url(domain: str) -> str:
    d = domain.lower().strip()
    # .org → PIR trực tiếp; TLD khác → bootstrap rdap.org (tự redirect đúng registry).
    return (f"https://rdap.publicinterestregistry.org/rdap/domain/{d}"
            if d.endswith(".org") else f"https://rdap.org/domain/{d}")


def classify(status_arr, expiration: str | None, today: _dt.date) -> tuple[str, str | None]:
    """(rdap_status, drop_eta) từ mảng status RDAP + ngày hết hạn.

    drop_eta = ngày mua được (dự kiến). .org drop ~75 ngày sau ngày hết hạn GỐC
    (grace + redemption 30 + pending 5). Khi 'auto renew period' thì RDAP đã +1 năm
    vào expiration nên phải trừ lại 1 năm để ra ngày gốc.
    """
    s = {str(x).lower() for x in (status_arr or [])}
    orig = None
    if expiration:
        try:
            orig = _dt.date.fromisoformat(expiration[:10])
            if "auto renew period" in s:
                orig -= _dt.timedelta(days=365)
        except Exception:
            orig = None
    est = (orig + _dt.timedelta(days=75)).isoformat() if orig else None

    if "pending delete" in s:
        return "pendingDelete", (today + _dt.timedelta(days=5)).isoformat()
    if "redemption period" in s:
        return "redemptionPeriod", est or (today + _dt.timedelta(days=35)).isoformat()
    if s & {"client hold", "server hold", "auto renew period", "pending renew"}:
        return "expiring", est or (today + _dt.timedelta(days=75)).isoformat()
    return "active", None


async def _fetch(client, domain: str, sem, today: _dt.date):
    async with sem:
        try:
            r = await client.get(_rdap_url(domain), timeout=20.0,
                                 headers={"Accept": "application/rdap+json"})
            if r.status_code == 404:
                return domain, "available", today.isoformat()
            if r.status_code != 200:
                return domain, "error", None
            j = r.json()
            events = {e.get("eventAction"): e.get("eventDate") for e in (j.get("events") or [])}
            st, eta = classify(j.get("status"), events.get("expiration"), today)
            return domain, st, eta
        except Exception:
            return domain, "error", None


async def _run_all(domains, concurrency):
    import httpx
    today = _dt.date.today()
    sem = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(follow_redirects=True,
                                 headers={"User-Agent": "expired-domain-pipeline/0.1"}) as c:
        return await asyncio.gather(*[_fetch(c, d, sem, today) for d in domains])


def _fetch_new_domains(url: str, key: str) -> list[str]:
    import httpx
    H = {"apikey": key, "Authorization": f"Bearer {key}"}
    out, off, LIM = [], 0, 1000
    with httpx.Client(timeout=60) as c:
        while True:
            r = c.get(f"{url}/rest/v1/expired_candidates?status=eq.new&select=domain"
                      f"&limit={LIM}&offset={off}", headers=H)
            r.raise_for_status()
            d = r.json()
            out += [x["domain"] for x in d]
            if len(d) < LIM:
                break
            off += LIM
    return out


def _update(url: str, key: str, results) -> int:
    """PATCH rdap_status/checked_at/drop_eta. Bỏ qua 'error' (giữ giá trị cũ, thử lại ngày sau)."""
    import httpx
    H = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    now = _dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    groups: dict[tuple[str, str | None], list[str]] = {}
    for dom, st, eta in results:
        if st == "error":
            continue
        groups.setdefault((st, eta), []).append(dom)
    n = 0
    with httpx.Client(timeout=60) as c:
        for (st, eta), doms in groups.items():
            body = _json.dumps({"rdap_status": st, "rdap_checked_at": now, "drop_eta": eta})
            for i in range(0, len(doms), 150):
                chunk = doms[i:i + 150]
                inlist = "(" + ",".join(chunk) + ")"
                r = c.patch(f"{url}/rest/v1/expired_candidates",
                            params={"domain": f"in.{inlist}"},
                            headers={**H, "Prefer": "return=minimal"}, content=body)
                if r.status_code >= 300:
                    raise RuntimeError(f"RDAP update lỗi {r.status_code}: {r.text[:200]}")
                n += len(chunk)
    return n


@app.command()
def run(
    concurrency: int = typer.Option(5, help="Số request RDAP song song."),
    limit: int = typer.Option(0, help="Chỉ check N domain (0=all)."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Chỉ in, không ghi Supabase."),
):
    """Tra RDAP cho MỌI candidate status='new' → cập nhật rdap_status/drop_eta."""
    url, key = _get_creds()
    domains = _fetch_new_domains(url, key)
    if limit:
        domains = domains[:limit]
    if not domains:
        typer.echo("Không có domain 'new' để tra RDAP.")
        return
    typer.echo(f"RDAP: {len(domains):,} domain (concurrency={concurrency})")
    results = asyncio.run(_run_all(domains, concurrency))
    cc = Counter(st for _, st, _ in results)
    typer.echo("Kết quả: " + " · ".join(f"{k}={v}" for k, v in cc.most_common()))
    if dry_run:
        for dom, st, eta in results[:20]:
            typer.echo(f"  {dom:<32} {st:<16} eta={eta}")
        typer.echo("[dry-run] không ghi Supabase.")
        return
    written = _update(url, key, results)
    buyable = cc.get("pendingDelete", 0) + cc.get("available", 0)
    typer.echo(f"✓ RDAP: cập nhật {written:,} domain.")
    if buyable:
        typer.echo(f"🔴 {buyable} domain CẦN MUA NGAY (pending-delete / available).")
