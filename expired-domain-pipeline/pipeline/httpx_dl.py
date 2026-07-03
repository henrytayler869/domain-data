"""Tải file lớn: streaming + resume (HTTP Range) + retry/backoff.

Tôn trọng giới hạn Wikimedia (khuyến nghị <=3 kết nối/IP) — hàm này 1 kết nối.
"""
from __future__ import annotations

from pathlib import Path

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential
from tqdm import tqdm

# Wikimedia yêu cầu User-Agent mô tả + liên hệ (nếu không dễ bị 403).
_UA = "expired-domain-pipeline/0.1 (personal research; contact henrytayler869@gmail.com)"


@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=2, min=2, max=60))
def download(url: str, dest: str | Path, chunk: int = 1 << 20) -> Path:
    """Tải `url` về `dest`, resume nếu có `.part`. Idempotent: file đủ kích thước -> bỏ qua."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")

    # Đã có file hoàn chỉnh?
    if dest.exists() and dest.stat().st_size > 0:
        return dest

    existing = part.stat().st_size if part.exists() else 0
    headers = {"User-Agent": _UA}
    if existing:
        headers["Range"] = f"bytes={existing}-"

    with httpx.stream("GET", url, headers=headers, follow_redirects=True, timeout=60.0) as r:
        # Server không hỗ trợ resume -> tải lại từ đầu.
        if existing and r.status_code == 200:
            existing = 0
            part.unlink(missing_ok=True)
        elif existing and r.status_code == 416:  # Range not satisfiable -> đã tải xong
            part.rename(dest)
            return dest
        r.raise_for_status()

        total = int(r.headers.get("content-length", 0)) + existing
        mode = "ab" if existing else "wb"
        with open(part, mode) as f, tqdm(
            total=total or None, initial=existing, unit="B", unit_scale=True,
            desc=dest.name, leave=False,
        ) as bar:
            for block in r.iter_bytes(chunk):
                f.write(block)
                bar.update(len(block))

    part.rename(dest)
    return dest
