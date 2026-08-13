-- DomainData schema — Postgres thuần trên VPS (thay Supabase cloud).
-- Sinh từ introspect OpenAPI PostgREST cloud (type/PK/NOT NULL chính xác) + code.
-- Chạy trên DB đích trước khi import dữ liệu. gen_random_uuid() có sẵn từ pg13+.

CREATE TABLE IF NOT EXISTS ahrefs_results (
  target_domain  text    NOT NULL,
  ref_domain     text    NOT NULL,
  domain_rating  integer NOT NULL,
  checked_at     timestamptz DEFAULT now(),
  PRIMARY KEY (target_domain, ref_domain)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key        text  PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backlink_db (
  domain  text    PRIMARY KEY,
  dr      integer NOT NULL,
  traffic bigint
);

CREATE TABLE IF NOT EXISTS domain_inventory (
  domain              text PRIMARY KEY,
  purchase_price      numeric,
  purchased_at        timestamptz DEFAULT now(),
  notes               text,
  source              text,
  rating              text,
  category            text,
  updated_at          timestamptz DEFAULT now(),
  sell_price          numeric,
  sold_at             timestamptz,
  expected_sell_price numeric,
  archived_at         timestamptz,
  is_backorder        boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS domain_watchlist (
  domain   text PRIMARY KEY,
  rating   text,
  category text,
  detail   text,
  note     text,
  added_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expired_candidates (
  domain            text PRIMARY KEY,
  tld               text,
  drop_date         text,
  final_score       real,
  wp_links          integer,
  cc_rank           integer,
  cc_harmonic       real,
  first_year        integer,
  crawl_count       integer,
  dfs_rank          integer,
  referring_domains integer,
  backlinks         integer,
  spam_score        integer,
  length            integer,
  has_hyphen        boolean,
  has_digit         boolean,
  is_dict_word      boolean,
  pre_score         real,
  status            text NOT NULL,
  imported_at       timestamptz NOT NULL DEFAULT now(),
  rdap_status       text,
  rdap_checked_at   timestamptz,
  drop_eta          date
);

CREATE TABLE IF NOT EXISTS gname_checks (
  domain     text PRIMARY KEY,
  status     text NOT NULL,
  drop_eta   date,
  code       integer,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gname_gate_jobs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status     text NOT NULL,
  total      integer NOT NULL DEFAULT 0,
  checked    integer NOT NULL DEFAULT 0,
  available  integer NOT NULL DEFAULT 0,
  backorder  integer NOT NULL DEFAULT 0,
  registered integer NOT NULL DEFAULT 0,
  errored    integer NOT NULL DEFAULT 0,
  cached     integer NOT NULL DEFAULT 0,
  result     jsonb NOT NULL,
  error_msg  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gname_pricing (
  tld        text PRIMARY KEY,
  register   numeric,
  renew      numeric,
  backorder  numeric,
  deposit    numeric,
  channel    text,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS os_partners (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  discount_percent numeric NOT NULL,
  quotation_link   text,
  notes            text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS os_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id     uuid,
  package_name   text NOT NULL,
  price          numeric NOT NULL,
  revenue        numeric NOT NULL,
  payment_count  integer NOT NULL,
  payment_splits jsonb NOT NULL,
  notes          text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  currency       text NOT NULL
);

CREATE TABLE IF NOT EXISTS os_withdrawals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawn_at timestamptz NOT NULL,
  amount       numeric NOT NULL,
  currency     text NOT NULL,
  notes        text,
  created_at   timestamptz DEFAULT now(),
  installment  integer,
  order_id     uuid
);

CREATE TABLE IF NOT EXISTS picker_domains (
  domain        text PRIMARY KEY,
  source        text,
  tf            integer,
  cf            integer,
  bl            integer,
  rd            integer,
  da            integer,
  pa            integer,
  age           integer,
  sz_score      integer,
  sz_drops      integer,
  sem_traffic   bigint,
  sem_keywords  integer,
  price         text,
  expires       text,
  score         double precision,
  added_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ref_blacklist (
  domain   text PRIMARY KEY,
  note     text,
  added_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS target_assessment (
  target_domain text PRIMARY KEY,
  rating        text,
  category      text,
  detail        text,
  updated_at    timestamptz DEFAULT now(),
  excluded_at   timestamptz
);

CREATE TABLE IF NOT EXISTS unmatched_refs (
  domain     text PRIMARY KEY,
  seen_count integer NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wayback_results (
  target_domain        text PRIMARY KEY,
  snapshot_count       integer,
  first_year           text,
  last_year            text,
  domain_age           integer,
  has_betting          boolean,
  has_adult            boolean,
  content_history      jsonb,
  problematic_snapshots jsonb,
  error_reason         text,
  checked_at           timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wayback_runs (
  run_id      text PRIMARY KEY,
  status      text NOT NULL,
  targets     text[] NOT NULL,
  dataset_id  text,
  started_at  timestamptz DEFAULT now(),
  finished_at timestamptz,
  ingested_at timestamptz,
  error       text
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawn_at timestamptz NOT NULL,
  amount       numeric NOT NULL,
  currency     text NOT NULL,
  status       text NOT NULL,
  notes        text,
  created_at   timestamptz DEFAULT now(),
  wallet       text
);

-- Index phụ trợ (query app hay lọc theo các cột này)
CREATE INDEX IF NOT EXISTS idx_inventory_purchased ON domain_inventory (purchased_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_archived  ON domain_inventory (archived_at);
CREATE INDEX IF NOT EXISTS idx_gname_status        ON gname_checks (status, checked_at);
CREATE INDEX IF NOT EXISTS idx_wbruns_status       ON wayback_runs (status, started_at);
CREATE INDEX IF NOT EXISTS idx_ta_rating           ON target_assessment (rating);
