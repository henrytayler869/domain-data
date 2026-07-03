"""Rút registered domain từ URL / host / MediaWiki domain-index.

- registered_domain(): dùng tldextract (Public Suffix List) → 'example.co.uk'.
- host_from_domain_index(): giải mã cột el_to_domain_index kiểu MediaWiki
  (host bị đảo nhãn + TLD đứng trước, có dấu chấm cuối), ví dụ
  'https://com.example.www.' -> 'www.example.com'.
- host_from_url(): rút host từ URL đầy đủ (cột el_to cũ).
"""
from __future__ import annotations

from urllib.parse import urlsplit

import tldextract

# Dùng snapshot PSL đóng gói sẵn (suffix_list_urls=() → KHÔNG gọi mạng mỗi lần chạy).
_extract = tldextract.TLDExtract(suffix_list_urls=())

_PROTOCOLS = ("https://", "http://", "ftps://", "ftp://", "//")


def registered_domain(host: str | None) -> str | None:
    """'www.example.co.uk' -> 'example.co.uk'. Trả None nếu không hợp lệ / IP."""
    if not host:
        return None
    host = host.strip().lower().rstrip(".")
    if not host:
        return None
    # Bỏ IPv4 (toàn số + chấm) và IPv6 (có ':').
    if ":" in host:
        return None
    if host.replace(".", "").isdigit():
        return None
    ext = _extract(host)
    if not ext.domain or not ext.suffix:
        return None
    return f"{ext.domain}.{ext.suffix}"


def host_from_url(url: str | None) -> str | None:
    """Rút host từ URL đầy đủ. Chấp nhận cả URL không có scheme."""
    if not url:
        return None
    url = url.strip()
    if not url:
        return None
    if "://" not in url and not url.startswith("//"):
        url = "http://" + url
    try:
        return urlsplit(url).hostname
    except ValueError:
        return None


def host_from_domain_index(idx: str | None) -> str | None:
    """Giải mã cột el_to_domain_index (schema externallinks mới, ~2024).

    Định dạng: '<proto>://<nhãn đảo ngược, TLD trước>.' — ví dụ
    'https://com.example.www.' cho www.example.com. Có thể có tiền tố '*.'
    (khớp mọi subdomain) và dấu chấm ở cuối.
    """
    if not idx:
        return None
    s = idx.strip()
    if not s:
        return None
    for proto in _PROTOCOLS:
        if s.startswith(proto):
            s = s[len(proto):]
            break
    if s.startswith("*."):
        s = s[2:]
    # domain-index chỉ chứa host; guard nếu lỡ dính path.
    s = s.split("/", 1)[0]
    s = s.strip().rstrip(".")
    if not s:
        return None
    parts = [p for p in s.split(".") if p]
    if not parts:
        return None
    parts.reverse()
    return ".".join(parts)
