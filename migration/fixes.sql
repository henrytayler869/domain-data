-- Fix schema sau cutover: cột NOT NULL mà app bỏ trống lúc insert → cần DEFAULT
-- (cloud có sẵn, OpenAPI không lộ default). Idempotent (SET DEFAULT chạy lại vô hại).
-- gname-gate.ts dòng 87 insert chỉ {status,total,result} → 6 counter còn lại cần default.
ALTER TABLE gname_gate_jobs ALTER COLUMN total      SET DEFAULT 0;
ALTER TABLE gname_gate_jobs ALTER COLUMN checked    SET DEFAULT 0;
ALTER TABLE gname_gate_jobs ALTER COLUMN available  SET DEFAULT 0;
ALTER TABLE gname_gate_jobs ALTER COLUMN backorder  SET DEFAULT 0;
ALTER TABLE gname_gate_jobs ALTER COLUMN registered SET DEFAULT 0;
ALTER TABLE gname_gate_jobs ALTER COLUMN errored    SET DEFAULT 0;
ALTER TABLE gname_gate_jobs ALTER COLUMN cached     SET DEFAULT 0;
