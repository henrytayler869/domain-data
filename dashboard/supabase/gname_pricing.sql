-- Giá mua Gname theo TLD (register + backorder). Pipeline `gname price` upsert vào đây.
-- Chạy 1 lần trong Supabase SQL Editor.
create table if not exists gname_pricing (
  tld        text primary key,   -- 'org', 'com', ...
  register   numeric,            -- giá đăng ký (domain đã available)
  renew      numeric,
  backorder  numeric,            -- giá backorder (domain pending-delete/redemption)
  deposit    numeric,            -- deposit backorder
  channel    text,               -- tên kênh backorder
  updated_at timestamptz default now()
);
