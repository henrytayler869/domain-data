from pipeline.domains import (
    host_from_domain_index,
    host_from_url,
    registered_domain,
)


def test_registered_domain_basic():
    assert registered_domain("www.example.com") == "example.com"
    assert registered_domain("EN.Wikipedia.ORG") == "wikipedia.org"
    assert registered_domain("a.b.example.co.uk") == "example.co.uk"
    assert registered_domain("example.com.") == "example.com"


def test_registered_domain_invalid():
    assert registered_domain("") is None
    assert registered_domain(None) is None
    assert registered_domain("127.0.0.1") is None
    assert registered_domain("localhost") is None
    assert registered_domain("2001:db8::1") is None


def test_host_from_url():
    assert host_from_url("http://www.example.com/page?x=1") == "www.example.com"
    assert host_from_url("https://sub.test.co.uk/") == "sub.test.co.uk"
    # không scheme vẫn rút được
    assert host_from_url("www.example.org/abc") == "www.example.org"


def test_host_from_domain_index():
    # '<proto>://<nhãn đảo, TLD trước>.'
    assert host_from_domain_index("https://com.example.www.") == "www.example.com"
    assert host_from_domain_index("//org.wikipedia.en.") == "en.wikipedia.org"
    assert host_from_domain_index("https://uk.co.test.") == "test.co.uk"
    # wildcard prefix
    assert host_from_domain_index("*.com.example.") == "example.com"
    assert host_from_domain_index("") is None


def test_domain_index_roundtrip_to_registered():
    h = host_from_domain_index("https://uk.co.example.www.")
    assert h == "www.example.co.uk"
    assert registered_domain(h) == "example.co.uk"
