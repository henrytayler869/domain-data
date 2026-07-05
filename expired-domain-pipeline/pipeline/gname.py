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
def price(tld: str = typer.Option("all", help="TLD (vd 'org') hoặc 'all' = toàn bộ.")):
    """Lấy giá register + backorder → lưu Supabase gname_pricing (mặc định TẤT CẢ TLD)."""
    import httpx
    appid, appkey = _gname_creds()
    want = tld.lower().lstrip(".")

    jp = _post("/api/domain/price", {}, appid, appkey)
    if jp.get("code") != 1:
        if _is_ip_error(jp):
            raise typer.Exit(1)
        typer.echo(f"❌ /api/domain/price lỗi: {jp.get('msg')}")
        raise typer.Exit(1)

    # Map TLD -> kênh backorder RẺ NHẤT.
    jb = _post("/api/backorder/channel", {}, appid, appkey)
    bo_map: dict[str, tuple] = {}
    if jb.get("code") == 1:
        for ch in jb.get("data") or []:
            p, dep, name = float(ch.get("price") or 0), float(ch.get("deposit") or 0), ch.get("channel_name")
            for t in (ch.get("tlds") or []):
                t = str(t).lower().lstrip(".")
                if t not in bo_map or p < bo_map[t][0]:
                    bo_map[t] = (p, dep, name)
    elif _is_ip_error(jb):
        raise typer.Exit(1)

    now = _dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    rows = []
    for x in jp.get("data") or []:
        t = str(x.get("Tld", "")).lower().lstrip(".")
        if not t or (want != "all" and t != want):
            continue
        bo = bo_map.get(t)
        rows.append({
            "tld": t, "register": float(x.get("Register") or 0), "renew": float(x.get("Renew") or 0),
            "backorder": bo[0] if bo else None, "deposit": bo[1] if bo else None,
            "channel": bo[2] if bo else None, "updated_at": now,
        })
    if not rows:
        typer.echo(f"Không thấy giá cho TLD '{want}'.")
        raise typer.Exit(1)
    for r in rows[:5]:
        typer.echo(f"  {r['tld']}: register=${r['register']} | backorder=${r['backorder']} (dep ${r['deposit']})")
    if len(rows) > 5:
        typer.echo(f"  … tổng {len(rows)} TLD")

    url, key = _get_creds()
    H = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
         "Prefer": "resolution=merge-duplicates,return=minimal"}
    ok = 0
    for i in range(0, len(rows), 200):
        r = httpx.post(f"{url}/rest/v1/gname_pricing?on_conflict=tld", headers=H, json=rows[i:i + 200], timeout=30)
        if r.status_code >= 300:
            typer.echo(f"⚠️ Lưu Supabase lỗi {r.status_code}: {r.text[:150]}")
            break
        ok += len(rows[i:i + 200])
    typer.echo(f"✓ Đã lưu giá {ok} TLD vào gname_pricing.")
