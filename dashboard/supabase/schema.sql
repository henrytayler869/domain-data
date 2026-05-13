-- ─── Domain Picker DB ────────────────────────────────────────────────────────
create table if not exists picker_domains (
  domain        text primary key,
  source        text,
  tf            int  default 0,
  cf            int  default 0,
  bl            int  default 0,
  rd            int  default 0,
  da            int  default 0,
  pa            int  default 0,
  age           int  default 0,
  sz_score      int  default 0,
  sz_drops      int  default 0,
  sem_traffic   bigint default 0,
  sem_keywords  int  default 0,
  price         text,
  expires       text,
  score         double precision default 0,
  added_at      timestamptz default now()
);

create index if not exists picker_domains_score_idx
  on picker_domains (score desc);

-- ─── Backlink DB (cho Aged Domain) ───────────────────────────────────────────
create table if not exists backlink_db (
  domain text primary key,
  dr     int  not null default 0
);

create index if not exists backlink_db_dr_idx
  on backlink_db (dr desc);

-- ─── Ahrefs Result DB (kết quả check Ahrefs từ Aged Domain) ─────────────────
create table if not exists ahrefs_results (
  target_domain text not null,
  ref_domain    text not null,
  domain_rating int  not null default 0,
  checked_at    timestamptz default now(),
  primary key (target_domain, ref_domain)
);

create index if not exists ahrefs_results_target_idx
  on ahrefs_results (target_domain);

create index if not exists ahrefs_results_dr_idx
  on ahrefs_results (domain_rating desc);

-- ─── Ref Domain Blacklist (user-added entries) ──────────────────────────────
-- Default blacklist is hardcoded in src/lib/picker-csv.ts (REF_BLACKLIST).
-- This table only stores domains the user adds at runtime via the dashboard UI.
create table if not exists ref_blacklist (
  domain   text primary key,
  note     text,
  added_at timestamptz default now()
);

create index if not exists ref_blacklist_added_idx
  on ref_blacklist (added_at desc);

-- ─── Target Assessment (rating + category + detail per target) ──────────────
create table if not exists target_assessment (
  target_domain text primary key,
  rating        text,
  category      text,
  detail        text,
  updated_at    timestamptz default now()
);

create index if not exists target_assessment_rating_idx
  on target_assessment (rating);

-- ─── Domain Inventory (kho domain đã mua) ────────────────────────────────────
create table if not exists domain_inventory (
  domain          text primary key,
  purchase_price  numeric(10, 2),
  purchased_at    timestamptz default now(),
  notes           text,
  source          text,
  rating          text,
  category        text,
  updated_at      timestamptz default now()
);

create index if not exists domain_inventory_purchased_idx
  on domain_inventory (purchased_at desc);

-- Sell tracking (idempotent)
alter table domain_inventory add column if not exists sell_price numeric(10, 2);
alter table domain_inventory add column if not exists sold_at    timestamptz;
alter table domain_inventory add column if not exists expected_sell_price numeric(10, 2);
create index if not exists domain_inventory_sold_idx on domain_inventory (sold_at desc);

-- ─── Withdrawals (rút tiền từ doanh thu domain) ─────────────────────────────
create table if not exists withdrawals (
  id            uuid primary key default gen_random_uuid(),
  withdrawn_at  timestamptz not null,
  amount        numeric(12, 2) not null,
  currency      text not null default 'USD',
  status        text not null check (status in ('paid', 'progressing', 'under_review')),
  notes         text,
  wallet        text,
  created_at    timestamptz default now()
);

alter table withdrawals add column if not exists wallet text;

create index if not exists withdrawals_date_idx on withdrawals (withdrawn_at desc);

-- ─── OS Service: Partners (đối tác) ──────────────────────────────────────────
create table if not exists os_partners (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  discount_percent  numeric(5, 2) not null default 0,
  quotation_link    text,
  notes             text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists os_partners_name_idx on os_partners (name);

-- ─── OS Service: Orders (đơn hàng) ───────────────────────────────────────────
-- payment_splits: jsonb array of percentages, e.g. [50, 30, 20] for 3-installment
-- 50/30/20 split. Must sum to 100. payment_count = length(payment_splits).
create table if not exists os_orders (
  id                uuid primary key default gen_random_uuid(),
  partner_id        uuid references os_partners(id) on delete restrict,
  package_name      text not null,
  price             numeric(12, 2) not null,
  revenue           numeric(12, 2) not null,
  payment_count     integer not null default 1,
  payment_splits    jsonb not null default '[100]'::jsonb,
  notes             text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists os_orders_partner_idx on os_orders (partner_id);
create index if not exists os_orders_created_idx on os_orders (created_at desc);

-- Currency (idempotent migration). Allowed: USD / VND / USDT (no DB constraint —
-- enforced at API level).
alter table os_orders add column if not exists currency text not null default 'USD';

-- ─── OS Service: Withdrawals (rút doanh thu từ orders) ──────────────────────
create table if not exists os_withdrawals (
  id            uuid primary key default gen_random_uuid(),
  withdrawn_at  timestamptz not null,
  amount        numeric(12, 2) not null,
  currency      text not null default 'USD',
  notes         text,
  created_at    timestamptz default now()
);

create index if not exists os_withdrawals_date_idx on os_withdrawals (withdrawn_at desc);

-- Link each withdrawal to a specific order (cascade delete) — currency
-- inherits from the order at insert time.
alter table os_withdrawals add column if not exists order_id uuid references os_orders(id) on delete cascade;
create index if not exists os_withdrawals_order_idx on os_withdrawals (order_id);

-- Track which installment (đợt thanh toán) of the order this withdrawal corresponds to.
-- 1-based index into os_orders.payment_splits[]. NULL means "ad-hoc / không gắn đợt".
alter table os_withdrawals add column if not exists installment integer;

-- Seed default blacklist (idempotent — re-run safe)
insert into ref_blacklist (domain, note) values
  ('za.com',             'marketplace/parking'),
  ('blogspot.com',       'platform hosting'),
  ('wordpress.com',      'platform hosting'),
  ('weebly.com',         'platform hosting'),
  ('pages.dev',          'subdomain hosting'),
  ('squarespace.com',    'platform hosting'),
  ('amazonaws.com',      'subdomain hosting'),
  ('cloudfront.net',     'subdomain hosting'),
  ('azurewebsites.net',  'subdomain hosting'),
  ('netlify.app',        'subdomain hosting'),
  ('vercel.app',         'subdomain hosting'),
  ('sa.com',             'CentralNic marketplace'),
  ('eu.com',             'CentralNic marketplace'),
  ('us.com',             'CentralNic marketplace'),
  ('uk.com',             'CentralNic marketplace'),
  ('in.net',             'CentralNic marketplace'),
  ('google.com',         'PBN footprint: sites/docs/translate'),
  ('wixsite.com',        'free subdomain hosting'),
  ('hatena.ne.jp',       'JP blog platform — parasite SEO'),
  ('typepad.com',        'legacy blog hosting — abandoned/spam'),
  ('heylink.me',         'link-in-bio — strong PBN/gambling footprint')
on conflict (domain) do nothing;
