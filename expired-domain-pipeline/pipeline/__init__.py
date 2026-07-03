"""Expired Domain Pipeline — tự dựng nguồn domain drop + chỉ số rẻ từ dữ liệu công khai."""

# Ép stdout/stderr sang UTF-8 để in được ✓/tiếng Việt/emoji trên Windows console
# (mặc định cp1252 → UnicodeEncodeError). An toàn trên mọi OS.
import sys as _sys

for _s in (_sys.stdout, _sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")  # Python 3.7+
    except Exception:
        pass

# Nạp .env SỚM để mọi lệnh CLI đều có credential (get_token CZDS, DFS…) — không
# phụ thuộc lệnh có gọi load_config() hay không.
try:
    from pathlib import Path as _Path
    from dotenv import load_dotenv as _load_dotenv

    _load_dotenv(_Path(__file__).resolve().parent.parent / ".env")
except Exception:
    pass

__version__ = "0.1.0"
