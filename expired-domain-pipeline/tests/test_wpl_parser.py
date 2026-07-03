from pipeline.wpl import (
    count_domains_from_text,
    detect_url_column,
    find_columns_in_create,
    parse_row_tuples,
)

OLD_CREATE = """CREATE TABLE `externallinks` (
  `el_id` int unsigned NOT NULL AUTO_INCREMENT,
  `el_from` int unsigned NOT NULL DEFAULT 0,
  `el_from_namespace` int NOT NULL DEFAULT 0,
  `el_to` blob NOT NULL,
  `el_index` blob NOT NULL,
  PRIMARY KEY (`el_id`),
  KEY `el_from` (`el_from`)
) ENGINE=InnoDB DEFAULT CHARSET=binary;"""

NEW_CREATE = """CREATE TABLE `externallinks` (
  `el_id` int unsigned NOT NULL AUTO_INCREMENT,
  `el_from` int unsigned NOT NULL DEFAULT 0,
  `el_from_namespace` int NOT NULL DEFAULT 0,
  `el_to_domain_index` varbinary(255) NOT NULL DEFAULT '',
  `el_to_path` varbinary(2083) DEFAULT NULL,
  PRIMARY KEY (`el_id`)
) ENGINE=InnoDB DEFAULT CHARSET=binary;"""


def test_find_columns_old():
    cols = find_columns_in_create(OLD_CREATE)
    assert cols == ["el_id", "el_from", "el_from_namespace", "el_to", "el_index"]
    assert detect_url_column(cols) == ("url", 3)


def test_find_columns_new():
    cols = find_columns_in_create(NEW_CREATE)
    assert cols == ["el_id", "el_from", "el_from_namespace",
                    "el_to_domain_index", "el_to_path"]
    assert detect_url_column(cols) == ("domain_index", 3)


def test_parse_row_tuples_escapes_and_types():
    s = r"VALUES (1,'a','b\'c',NULL,0x414243),(2,'x''y',10,'',NULL);"
    after = s[s.index("VALUES") + 6:]
    rows = list(parse_row_tuples(after))
    assert rows[0] == ["1", "a", "b'c", None, "ABC"]
    assert rows[1] == ["2", "x'y", "10", "", None]


def test_count_old_schema():
    dump = OLD_CREATE + "\n" + (
        "INSERT INTO `externallinks` VALUES "
        "(1,10,0,'http://www.example.com/page','x'),"
        "(2,11,0,'https://sub.test.co.uk/','x'),"
        "(3,12,0,'http://www.example.com/other','x'),"
        "(4,13,0,'http://en.wikipedia.org/wiki/X','x');"
    )
    counts = count_domains_from_text(dump, skip={"wikipedia.org"})
    assert counts == {"example.com": 2, "test.co.uk": 1}


def test_count_new_schema():
    dump = NEW_CREATE + "\n" + (
        "INSERT INTO `externallinks` VALUES "
        "(1,10,0,'https://com.example.www.','/page'),"
        "(2,11,0,'https://uk.co.test.','/'),"
        "(3,12,0,'https://com.example.blog.','/x'),"
        "(4,13,0,'https://org.wikipedia.en.',NULL);"
    )
    counts = count_domains_from_text(dump, skip={"wikipedia.org"})
    # www.example.com + blog.example.com đều gộp về example.com
    assert counts == {"example.com": 2, "test.co.uk": 1}


def test_multiline_insert_and_create():
    # CREATE TABLE nhiều dòng + INSERT ở dòng riêng vẫn parse đúng
    dump = NEW_CREATE + "\nINSERT INTO `externallinks` VALUES (1,10,0,'https://net.foobar.','/a');\n"
    counts = count_domains_from_text(dump, skip=set())
    assert counts == {"foobar.net": 1}
