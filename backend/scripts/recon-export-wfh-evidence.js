/**
 * EVIDENCE CARRY-FORWARD (Phase-0, 2026-07-06): dump the per-day WFH LOCATION evidence
 * from the live roster_days into scratch/wfh-evidence.json BEFORE a rebuild.
 *
 * Why: the original month file carried a per-day Location column (WFH/Office) — BR-WFH-001's
 * "explicit WFH location" leg. Later re-exports of the sheet lost that column (constant
 * "Office"), so a rebuild from them would misclassify every WFH day as Office. The live
 * table still holds the originally-ingested evidence; this preserves it across rebuilds.
 * It is EVIDENCE preservation, not a rule patch — the engine still applies BR-WFH-001 itself.
 *
 * Run BEFORE recon-new-roster.js (recon-refresh does this automatically).
 */
const fs = require('fs');
const { getClient } = require('./recon-db');
const SCRATCH = process.env.RECON_SCRATCH || require('path').join(__dirname, '..', '.recon-scratch');
const TENANT = process.env.RECON_TENANT || 'a0000000-0000-0000-0000-000000000001';
const FROM = process.env.RECON_FROM || '2026-06-01';
const TO = process.env.RECON_TO || '2026-06-30';

(async () => {
  const c = getClient();
  await c.connect();
  try {
    const { rows } = await c.query(
      `SELECT person_no, work_date::text AS d
       FROM roster_days
       WHERE tenant_id = $1 AND is_active AND location = 'WFH'
         AND work_date BETWEEN $2 AND $3`,
      [TENANT, FROM, TO],
    );
    const out = {};
    for (const r of rows) out[r.person_no + '|' + r.d] = true;
    fs.mkdirSync(SCRATCH, { recursive: true });
    fs.writeFileSync(SCRATCH + '/wfh-evidence.json', JSON.stringify(out));
    console.log('wfh-evidence: exported ' + rows.length + ' WFH day-keys (' + FROM + '..' + TO + ') → scratch/wfh-evidence.json');
  } finally { await c.end(); }
})().catch(e => { console.error('wfh-evidence export failed: ' + e.message); process.exit(1); });
