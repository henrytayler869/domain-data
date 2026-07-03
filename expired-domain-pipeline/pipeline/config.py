"""Load config.yaml + .env. Không hardcode credential."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

# Project root = thư mục chứa config.yaml (đi lên từ file này).
ROOT = Path(__file__).resolve().parent.parent

DEFAULTS: dict[str, Any] = {
    "db_path": "data/pipeline.db",
    "wpl": {
        "wikis": {
            "enwiki": "https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-externallinks.sql.gz",
        },
        "flush_size": 1_000_000,
        "skip_domains": [
            "wikipedia.org", "wikimedia.org", "wikidata.org", "wiktionary.org",
            "wikibooks.org", "wikinews.org", "wikiquote.org", "wikisource.org",
            "wikiversity.org", "wikivoyage.org", "mediawiki.org",
            "wmcloud.org", "wmflabs.org", "wikimediafoundation.org", "toolforge.org",
        ],
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


@lru_cache(maxsize=1)
def load_config(path: str | None = None) -> dict[str, Any]:
    """Đọc config.yaml (nếu có) merge lên DEFAULTS; nạp .env vào os.environ."""
    load_dotenv(ROOT / ".env")
    cfg_path = Path(path) if path else ROOT / "config.yaml"
    data: dict[str, Any] = {}
    if cfg_path.exists():
        with open(cfg_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    return _deep_merge(DEFAULTS, data)


def resolve_path(p: str | os.PathLike) -> Path:
    """Đường dẫn tương đối tính từ ROOT (để chạy ở đâu cũng đúng)."""
    p = Path(p)
    return p if p.is_absolute() else (ROOT / p)


def db_path() -> Path:
    return resolve_path(load_config()["db_path"])
