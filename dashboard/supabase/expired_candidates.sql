-- Chạy MỘT LẦN trong Supabase SQL Editor để tạo bảng cho lớp tích hợp
-- Expired Domain Pipeline (import final_<date>.csv → review → Wayback → Mua).

create table if not exists public.expired_candidates (
  domain            text primary key,
  tld               text,
  drop_date         text,
  final_score       real,
  wp_links          integer default 0,
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
  status            text not null default 'new',   -- new | bought | excluded
  imported_at       timestamptz not null default now()
);

create index if not exists expired_candidates_status_idx on public.expired_candidates (status);
create index if not exists expired_candidates_score_idx  on public.expired_candidates (final_score desc);
