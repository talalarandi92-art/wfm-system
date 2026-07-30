#!/usr/bin/env node
/*
 * Dump human decisions from the database into the engine's scratch dir, so the next
 * rebuild applies them.
 *
 * The engine runs as a standalone script with no DB read of its own — it takes files in
 * and writes an ingest payload out. That separation is worth keeping (it makes the whole
 * reconciliation reproducible from a folder of spreadsheets), so decisions travel the same
 * way the WFH evidence does: exported to JSON just before the build.
 *
 * Runs as step 1.6 of recon-refresh, after the foundation and before the engine.
 */
const fs = require('fs'), path = require('path');
const { getClient } = require('./recon-db');
const SCRATCH = process.env.RECON_SCRATCH || path.join(__dirname, '..', '.recon-scratch');
const TENANT = process.env.RECON_TENANT || 'a0000000-0000-0000-0000-000000000001';

(async () => {
  const c = getClient();
  await c.connect();
  try {
    /* The table may not exist on a first run — the ingest creates it. An empty file is the
       correct answer then, not a crash: a rebuild must never depend on anyone having
       decided anything yet. */
    const rows = (await c.query(
      `SELECT person_no, work_date::text AS work_date, queue, decision, note, decided_by
         FROM roster_decisions WHERE tenant_id=$1`, [TENANT]).catch(() => ({ rows: [] }))).rows;
    fs.mkdirSync(SCRATCH, { recursive: true });
    fs.writeFileSync(path.join(SCRATCH, 'decisions.json'), JSON.stringify(rows));
    const byQueue = rows.reduce((a, r) => ((a[r.queue] = (a[r.queue] || 0) + 1), a), {});
    console.log(`decisions exported: ${rows.length}` +
      (rows.length ? ` (${Object.entries(byQueue).map(([k, v]) => `${k} ${v}`).join(', ')})` : ' — none recorded yet'));
  } finally { await c.end(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
