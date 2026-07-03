"""Test các hàm parser/logic thuần của Phase 2–7."""
import gzip
import os
import tempfile

from pipeline.ccrank import parse_rank_line
from pipeline.dataforseo import parse_bulk_response, response_cost
from pipeline.drops import extract_registered_from_zone_line
from pipeline.filtering import name_features, pre_score
from pipeline.score import compute_final_score
from pipeline.util import diff_sorted, sort_unique_to_file
from pipeline.wayback import parse_cdx_json


# ── Phase 2: drops ────────────────────────────────────────────────────────────
def test_zone_line_ns_depth2():
    assert extract_registered_from_zone_line("example.com. 900 in ns ns1.example.com.", "com") == "example.com"
    assert extract_registered_from_zone_line("EXAMPLE.COM. 172800 IN NS a.gtld.net.", "com") == "example.com"


def test_zone_line_skips_glue_and_ds_and_comments():
    # glue A record của nameserver (depth 3) -> bỏ
    assert extract_registered_from_zone_line("ns1.example.com. 900 in a 1.2.3.4", "com") is None
    # DS record -> bỏ (không phải NS)
    assert extract_registered_from_zone_line("example.com. 900 in ds 12345 8 2 ABCD", "com") is None
    assert extract_registered_from_zone_line("; comment", "com") is None
    assert extract_registered_from_zone_line("", "com") is None
    # sai TLD
    assert extract_registered_from_zone_line("example.net. 900 in ns x.net.", "com") is None


def test_sort_unique_and_diff():
    d = tempfile.mkdtemp()
    prev = os.path.join(d, "prev.txt.gz")
    today = os.path.join(d, "today.txt.gz")
    sort_unique_to_file(["b.com", "a.com", "c.com", "a.com"], prev, chunk_size=2)
    sort_unique_to_file(["a.com", "c.com", "d.com"], today, chunk_size=2)
    # dropped = có ở prev, mất ở today = b.com
    assert list(diff_sorted(prev, today)) == ["b.com"]
    # verify prev đã sort+unique
    with gzip.open(prev, "rt") as f:
        assert [l.strip() for l in f] == ["a.com", "b.com", "c.com"]


# ── Phase 3: wayback ──────────────────────────────────────────────────────────
def test_parse_cdx():
    assert parse_cdx_json([["timestamp"]]) == (None, 0)
    assert parse_cdx_json([]) == (None, 0)
    data = [["timestamp"], ["20031015000000"], ["20080101000000"], ["20250101000000"]]
    assert parse_cdx_json(data) == (2003, 3)


# ── Phase 4: ccrank ───────────────────────────────────────────────────────────
def test_parse_rank_line():
    assert parse_rank_line("#harmonicc_pos\tharmonicc_val\tpr_pos\tpr_val\thost_rev") is None
    row = parse_rank_line("42\t9.87\t100\t0.5\tcom.example")
    assert row == ("example.com", 42, 9.87)
    # pagerank mode dùng cột pr_pos làm cc_rank
    assert parse_rank_line("42\t9.87\t100\t0.5\tcom.example", rank="pagerank")[1] == 100
    assert parse_rank_line("bad line") is None


# ── Phase 5: filter ───────────────────────────────────────────────────────────
def test_name_features():
    assert name_features("my-shop123.com", set()) == (10, True, True, False, "com")
    # pipeline chỉ xử lý TLD 1 nhãn (com/net/org) → tld = nhãn cuối
    assert name_features("garden.org", {"garden"}) == (6, False, False, True, "org")


def test_pre_score_prefers_authority_and_age():
    w = {"wp": 2.0, "cc": 1.5, "age": 0.15, "dict": 1.5, "hyphen": 1.0, "digit": 0.7}
    strong = pre_score(50, 1000, 2004, True, False, False, w, 2026)
    weak = pre_score(0, None, None, False, True, True, w, 2026)
    assert strong > weak


# ── Phase 6: dataforseo ───────────────────────────────────────────────────────
def test_parse_bulk_response_by_target():
    data = {
        "cost": 0.02,
        "tasks": [{"result": [{"items": [
            {"target": "A.com", "rank": 500},
            {"target": "b.com", "rank": 123},
        ]}]}],
    }
    assert parse_bulk_response(data, "rank") == {"a.com": 500, "b.com": 123}
    assert response_cost(data) == 0.02
    assert response_cost({"tasks": [{"cost": 0.01}, {"cost": 0.03}]}) == 0.04


# ── Phase 7: score ────────────────────────────────────────────────────────────
def test_final_score_penalizes_spam():
    w = {"wp": 1.5, "cc": 1.0, "dfs_rank": 1.0, "refdom": 1.5,
         "backlinks": 0.5, "age": 0.1, "spam": 2.0}
    clean = {"wp_links": 10, "cc_rank": 5000, "first_year": 2005, "dfs_rank": 300,
             "referring_domains": 200, "backlinks": 5000, "spam_score": 2}
    spammy = dict(clean, spam_score=95)
    assert compute_final_score(clean, w, 2026) > compute_final_score(spammy, w, 2026)
