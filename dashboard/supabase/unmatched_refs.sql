-- Unmatched Ref Domains: ref domain DataForSEO tìm thấy nhưng CHƯA có trong
-- backlink_db (chưa biết DR). Lưu để sau này check DR (Ahrefs) rồi bổ sung.
create table if not exists public.unmatched_refs (
  domain      text primary key,
  seen_count  integer     not null default 1,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create index if not exists unmatched_refs_seen_count_idx on public.unmatched_refs (seen_count desc);
create index if not exists unmatched_refs_last_seen_idx  on public.unmatched_refs (last_seen desc);
