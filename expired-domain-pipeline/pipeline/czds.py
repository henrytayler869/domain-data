"""ICANN CZDS client — auth + list + download zone file. Không log credential."""
from __future__ import annotations

import os
from pathlib import Path

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

AUTH_URL = "https://account-api.icann.org/api/authenticate"
LINKS_URL = "https://czds-api.icann.org/czds/downloads/links"
_UA = "expired-domain-pipeline/0.1"


def get_token() -> str:
    """Lấy access token: ưu tiên CZDS_TOKEN, nếu không thì auth bằng user/pass."""
    tok = os.getenv("CZDS_TOKEN")
    if tok:
        return tok.strip()
    user = os.getenv("CZDS_USERNAME")
    pw = os.getenv("CZDS_PASSWORD")
    if not user or not pw:
        raise RuntimeError(
            "Thiếu credential CZDS: đặt CZDS_TOKEN hoặc CZDS_USERNAME/CZDS_PASSWORD trong .env"
        )
    r = httpx.post(AUTH_URL, json={"username": user, "password": pw},
                   headers={"User-Agent": _UA}, timeout=60.0)
    r.raise_for_status()
    return r.json()["accessToken"]


@retry(stop=stop_after_attempt(4), wait=wait_exponential(multiplier=2, min=2, max=30))
def list_links(token: str) -> list[str]:
    """Danh sách URL zone file mà tài khoản được duyệt."""
    r = httpx.get(LINKS_URL, headers={"Authorization": f"Bearer {token}", "User-Agent": _UA},
                  timeout=60.0)
    r.raise_for_status()
    return list(r.json())


def link_for_tld(token: str, tld: str) -> str | None:
    tld = tld.lower().lstrip(".")
    for url in list_links(token):
        # URL kiểu .../czds/downloads/<tld>.zone
        name = url.rstrip("/").split("/")[-1].lower()
        if name in (f"{tld}.zone", tld, f"{tld}.txt"):
            return url
    return None


@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=2, min=2, max=60))
def download_zone(url: str, token: str, dest: str | Path, chunk: int = 1 << 20) -> Path:
    """Tải zone file (gz) về dest, streaming. (Zone .com rất lớn — ~15GB giải nén.)"""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    with httpx.stream("GET", url, headers={"Authorization": f"Bearer {token}", "User-Agent": _UA},
                      follow_redirects=True, timeout=120.0) as r:
        r.raise_for_status()
        with open(part, "wb") as f:
            for block in r.iter_bytes(chunk):
                f.write(block)
    part.rename(dest)
    return dest
