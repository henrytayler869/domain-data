"""Phase 10 — gname: giá mua domain qua Gname API (register + backorder).

CHẠY TỪ MÁY/VPS CÓ IP ĐÃ WHITELIST trên Gname (API Settings → whitelist IP).
Vercel KHÔNG whitelist được (IP động) → Gname chạy ở pipeline, đẩy giá vào Supabase
(bảng gname_pricing) để webapp đọc hiển thị.

  python -m pipeline gname ip      -> in IP công khai máy này (để whitelist).
  python -m pipeline gname price   -> lấy giá register + backorder .org -> Supabase.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import re
import time
import urllib.parse

import typer

from .config import resolve_path
from .push import _get_creds  # supabase url/key (đọc dashboard/.env.local)

app = typer.Typer(help="gname — giá mua (register + backorder) qua Gname API.")

GNAME_BASE = "https://api.gname.com"
_SAFE = "-_.!~*'()"  # ký tự encodeURIComponent KHÔNG mã hoá → khớp chữ ký lib TS


def _gname_creds() -> tuple[str, str]:
    import os
    appid, appkey = os.getenv("GNAME_APPID"), os.getenv("GNAME_APPKEY")
    if not (appid and appkey):
        envfile = resolve_path("../dashboard/.env.local")
        if envfile.exists():
            text = envfile.read_text(encoding="utf-8", errors="replace")

            def gg(k):
                m = re.search(rf"^{k}\s*=\s*(.+)$", text, re.M)
                return m.group(1).strip().strip('"').strip("'") if m else None
            appid = appid or gg("GNAME_APPID")
            appkey = appkey or gg("GNAME_APPKEY")
    if not appid or not appkey:
        raise RuntimeError("Thiếu GNAME_APPID/GNAME_APPKEY (đặt trong dashboard/.env.local).")
    return appid, appkey


def _sign(params: dict, appkey: str) -> str:
    a = "&".join(f"{k}={urllib.parse.quote(str(params[k]).strip(), safe=_SAFE)}" for k in sorted(params))
    return hashlib.md5((a + appkey).encode()).hexdigest().upper()


def _post(path: str, params: dict, appid: str, appkey: str) -> dict:
    import httpx
    full = {**params, "appid": appid, "gntime": str(int(time.time()))}
    full["gntoken"] = _sign(full, appkey)
    r = httpx.post(GNAME_BASE + path, data=full,
                   headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=25)
    try:
        return r.json()
    except Exception:
        return {"code": -999, "msg": r.text[:200]}


def _is_ip_error(j: dict) -> bool:
    msg = str(j.get("msg", "")).lower()
    if "white list" in msg or "whitelist" in msg:
        m = re.search(r"ip:\s*([0-9.]+)", msg)
        typer.echo(f"❌ IP {m.group(1) if m else '?'} CHƯA whitelist trên Gname. "
                   f"Vào API Settings → whitelist IP này rồi chạy lại.")
        return True
    return False


@app.command()
def ip():
    """In IP công khai của máy này (để whitelist trên Gname API Settings)."""
    import httpx
    for u in ("https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"):
        try:
            v = httpx.get(u, timeout=10).text.strip()
            if v:
                typer.echo(f"IP công khai máy này: {v}")
                typer.echo("→ Thêm IP này vào Gname → API Settings → whitelist.")
                return
        except Exception:
            continue
    typer.echo("Không lấy được IP tự động — xem tại https://whatismyipaddress.com")


@app.command()
def price(tld: str = typer.Option("org", help="TLD (không dấu chấm).")):
    """Lấy giá register + backorder cho TLD → lưu Supabase gname_pricing."""
    import httpx
    appid, appkey = _gname_creds()
    tld = tld.lower().lstrip(".")

    jp = _post("/api/price", {}, appid, appkey)
    if jp.get("code") != 1:
        if _is_ip_error(jp):
            raise typer.Exit(1)
        typer.echo(f"❌ /api/price lỗi: {jp.get('msg')}")
        raise typer.Exit(1)
    reg = renew = None
    for x in jp.get("data") or []:
        if str(x.get("Tld", "")).lower().lstrip(".") == tld:
            reg = float(x["Register"]); renew = float(x.get("Renew") or 0)
            break

    jb = _post("/api/backorder/channel", {}, appid, appkey)
    bo_price = bo_dep = bo_ch = None
    if jb.get("code") == 1:
        for ch in jb.get("data") or []:
            tlds = [str(t).lower().lstrip(".") for t in (ch.get("tlds") or [])]
            if tld in tlds:
                p = float(ch.get("price") or 0)
                if bo_price is None or p < bo_price:
                    bo_price, bo_dep, bo_ch = p, float(ch.get("deposit") or 0), ch.get("channel_name")
    elif _is_ip_error(jb):
        raise typer.Exit(1)

    typer.echo(f"{tld}: register=${reg} renew=${renew} | backorder=${bo_price} (deposit ${bo_dep}, {bo_ch})")

    url, key = _get_creds()
    H = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
         "Prefer": "resolution=merge-duplicates,return=minimal"}
    row = {"tld": tld, "register": reg, "renew": renew, "backorder": bo_price, "deposit": bo_dep,
           "channel": bo_ch, "updated_at": _dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"}
    r = httpx.post(f"{url}/rest/v1/gname_pricing?on_conflict=tld", headers=H, json=[row], timeout=30)
    if r.status_code >= 300:
        typer.echo(f"⚠️ Lưu Supabase lỗi {r.status_code}: {r.text[:150]}")
    else:
        typer.echo(f"✓ Đã lưu giá {tld} vào gname_pricing.")
