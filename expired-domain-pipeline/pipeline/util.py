"""Tiện ích chung: mở gz, external sort+unique (RAM giới hạn), merge-diff file đã sort."""
from __future__ import annotations

import gzip
import heapq
import os
import tempfile
from pathlib import Path
from typing import Iterable, Iterator


def open_text_read(path: str | Path):
    path = str(path)
    if path.endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return open(path, "rt", encoding="utf-8", errors="replace")


def open_text_write(path: str | Path):
    path = str(path)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    if path.endswith(".gz"):
        return gzip.open(path, "wt", encoding="utf-8")
    return open(path, "wt", encoding="utf-8")


def sort_unique_to_file(
    items: Iterable[str],
    out_path: str | Path,
    chunk_size: int = 2_000_000,
    tmpdir: str | None = None,
) -> int:
    """External sort + unique một iterable chuỗi → file (sorted, unique, 1 dòng/mục).

    RAM giới hạn: gom `chunk_size` mục vào set → sort → spill ra file tạm gz,
    rồi k-way merge (heapq) + bỏ trùng liên tiếp. Trả về số dòng output.
    """
    chunks: list[str] = []
    buf: set[str] = set()

    def flush() -> None:
        if not buf:
            return
        fd, tmp = tempfile.mkstemp(suffix=".txt.gz", dir=tmpdir)
        os.close(fd)
        with gzip.open(tmp, "wt", encoding="utf-8") as f:
            for x in sorted(buf):
                f.write(x + "\n")
        chunks.append(tmp)
        buf.clear()

    for it in items:
        buf.add(it)
        if len(buf) >= chunk_size:
            flush()
    flush()

    n = 0
    files = [gzip.open(c, "rt", encoding="utf-8") for c in chunks]
    try:
        with open_text_write(out_path) as out:
            prev = None
            for line in heapq.merge(*files):
                line = line.rstrip("\n")
                if line != prev:
                    out.write(line + "\n")
                    prev = line
                    n += 1
    finally:
        for f in files:
            f.close()
        for c in chunks:
            try:
                os.remove(c)
            except OSError:
                pass
    return n


def diff_sorted(prev_path: str | Path, today_path: str | Path) -> Iterator[str]:
    """Yield dòng CÓ trong prev nhưng KHÔNG trong today (cả 2 đã sort+unique).

    = domain "dropped" (hôm qua có, hôm nay biến mất). Streaming, không ngốn RAM.
    """
    with open_text_read(prev_path) as fp, open_text_read(today_path) as ft:
        a = fp.readline()
        b = ft.readline()
        while a:
            al = a.rstrip("\n")
            if not b:
                yield al
                a = fp.readline()
                continue
            bl = b.rstrip("\n")
            if al == bl:
                a = fp.readline()
                b = ft.readline()
            elif al < bl:
                yield al
                a = fp.readline()
            else:
                b = ft.readline()
