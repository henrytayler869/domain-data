// Copy toàn bộ dữ liệu cloud Supabase → Postgres đích (VPS). Đọc qua REST API
// (supabase-js), ghi qua pg. Idempotent (ON CONFLICT DO NOTHING) → chạy lại an toàn.
// Env: SB_URL, SB_KEY (cloud, đọc từ .env.local VPS), PG_URL (Postgres đích, superuser).
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const sb = createClient(process.env.SB_URL, process.env.SB_KEY, { auth: { persistSession: false } });
const pool = new pg.Pool({ connectionString: process.env.PG_URL });

// pk = cột ON CONFLICT; j = cột jsonb (phải JSON.stringify). text[] (targets) để native.
const T = {
  ahrefs_results:     { pk: ["target_domain", "ref_domain"], j: [] },
  app_settings:       { pk: ["key"], j: ["value"] },
  backlink_db:        { pk: ["domain"], j: [] },
  domain_inventory:   { pk: ["domain"], j: [] },
  domain_watchlist:   { pk: ["domain"], j: [] },
  expired_candidates: { pk: ["domain"], j: [] },
  gname_checks:       { pk: ["domain"], j: [] },
  gname_gate_jobs:    { pk: ["id"], j: ["result"] },
  gname_pricing:      { pk: ["tld"], j: [] },
  os_partners:        { pk: ["id"], j: [] },
  os_orders:          { pk: ["id"], j: ["payment_splits"] },
  os_withdrawals:     { pk: ["id"], j: [] },
  picker_domains:     { pk: ["domain"], j: [] },
  ref_blacklist:      { pk: ["domain"], j: [] },
  target_assessment:  { pk: ["target_domain"], j: [] },
  unmatched_refs:     { pk: ["domain"], j: [] },
  wayback_results:    { pk: ["target_domain"], j: ["content_history", "problematic_snapshots"] },
  wayback_runs:       { pk: ["run_id"], j: [] },
  withdrawals:        { pk: ["id"], j: [] },
};

async function insertBatch(client, t, cfg, batch) {
  if (!batch.length) return 0;
  const cols = Object.keys(batch[0]);
  const jset = new Set(cfg.j);
  const vals = [], ph = [];
  let n = 1;
  for (const r of batch) {
    const rp = [];
    for (const c of cols) {
      let v = r[c];
      if (v !== null && v !== undefined && jset.has(c)) v = JSON.stringify(v);
      vals.push(v === undefined ? null : v);
      rp.push(`$${n++}`);
    }
    ph.push(`(${rp.join(",")})`);
  }
  const sql = `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(",")}) VALUES ${ph.join(",")} ` +
              `ON CONFLICT (${cfg.pk.map((c) => `"${c}"`).join(",")}) DO NOTHING`;
  const res = await client.query(sql, vals);
  return res.rowCount;
}

let failed = 0;
for (const [t, cfg] of Object.entries(T)) {
  let off = 0, total = 0, ins = 0;
  const client = await pool.connect();
  try {
    for (;;) {
      const { data, error } = await sb.from(t).select("*").range(off, off + 499);
      if (error) throw new Error(`${t} read @${off}: ${error.message}`);
      if (!data || !data.length) break;
      total += data.length;
      for (let i = 0; i < data.length; i += 100) ins += await insertBatch(client, t, cfg, data.slice(i, i + 100));
      if (data.length < 500) break;
      off += 500;
    }
    console.log(`${t}: cloud ${total} → chèn ${ins}`);
  } catch (e) {
    failed++;
    console.log(`${t}: LỖI — ${e.message}`);
  } finally {
    client.release();
  }
}
await pool.end();
console.log(failed ? `MIGRATE XONG (có ${failed} bảng lỗi)` : "MIGRATE DONE (0 lỗi)");
process.exit(failed ? 1 : 0);
