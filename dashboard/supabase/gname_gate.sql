-- Gate Bước 3 (check Gname) chạy NỀN server-side + cache kết quả.
-- Chạy file này trong Supabase SQL Editor.

-- 1) Job hàng đợi: browser POST /api/picker/gate/start tạo 1 row, worker nền
--    cập nhật tiến độ; browser poll /api/picker/gate/status để hiện progress.
create table if not exists public.gname_gate_jobs (
  id          uuid primary key default gen_random_uuid(),
  status      text        not null default 'running',   -- running | done | error
  total       integer     not null default 0,
  checked     integer     not null default 0,
  available   integer     not null default 0,
  backorder   integer     not null default 0,
  registered  integer     not null default 0,
  errored     integer     not null default 0,
  cached      integer     not null default 0,           -- lấy từ cache, không gọi API
  -- { available: string[], premium: string[], backorder: [{domain,dropEta}], error: string[] }
  result      jsonb       not null default '{}'::jsonb,
  error_msg   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists gname_gate_jobs_created_idx on public.gname_gate_jobs (created_at desc);

-- 2) Cache kết quả check từng domain → lần chạy sau bỏ qua (TTL do caller lọc theo checked_at).
--    KHÔNG cache status 'error' (tạm thời) — để lần sau check lại.
create table if not exists public.gname_checks (
  domain      text        primary key,
  status      text        not null,                     -- available | premium | backorder | registered
  drop_eta    date,
  code        integer,
  checked_at  timestamptz not null default now()
);
create index if not exists gname_checks_checked_at_idx on public.gname_checks (checked_at desc);
