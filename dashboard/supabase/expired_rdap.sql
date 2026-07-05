-- Thêm cột RDAP (trạng thái vòng đời domain) cho Domain Drop.
-- Chạy 1 lần trong Supabase SQL Editor.
alter table expired_candidates
  add column if not exists rdap_status     text,          -- available|pendingDelete|redemptionPeriod|expiring|active|error
  add column if not exists rdap_checked_at timestamptz,
  add column if not exists drop_eta        date;          -- ngày mua được (dự kiến / thật khi pendingDelete)

-- Index để lọc nhanh domain khẩn cấp.
create index if not exists idx_expired_rdap_status on expired_candidates (rdap_status);
