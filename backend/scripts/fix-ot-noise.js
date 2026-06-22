#!/usr/bin/env node
/*
 * fix-ot-noise.js — corrects OT inflation in roster_days (idempotent).
 *
 * Two noise sources:
 *  1. CROSS-MIDNIGHT DAY-WRAP (the big one): for a shift that starts late evening
 *     and ends next morning (crosses_midnight), an early-morning login (e.g. 02:39)
 *     is the SAME shift continuing past midnight — NOT a 19-hour-early arrival. The
 *     import computed ot_before = shift_start - login = huge. Fix: zero ot_before for
 *     these and remove it from ot_min.
 *  2. PERSISTENT-SESSION residue: any remaining ot_before > 360m (6h early) or
 *     ot_after > 480m (8h late) is a Sprinklr/Ameyo session that never logged out.
 *     Cap to the plausible max and flag.
 *
 * ot_min was stored as base_ot + ot_before + ot_after, so each reduction is mirrored
 * in ot_min. Lateness/adherence are left unchanged (night-shift login capture is
 * unreliable; we don't invent tardiness from it).
 */
const fs = require('fs'), path = require('path');
const { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const T = 'a0000000-0000-0000-0000-000000000001';
(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const before = (await c.query(`SELECT SUM(ot_before_min)::int b, SUM(ot_after_min)::int a, SUM(ot_min)::int t FROM roster_days WHERE tenant_id=$1`, [T])).rows[0];

  // 1) cross-midnight day-wrap → zero ot_before, mirror in ot_min
  const r1 = await c.query(
    `UPDATE roster_days
        SET ot_min = GREATEST(0, ot_min - ot_before_min),
            ot_before_min = 0,
            data_quality = COALESCE(data_quality, 'xmid-ot-before-zeroed')
      WHERE tenant_id=$1
        AND (crosses_midnight = true OR shift_end_min > 1440 OR shift_end_min < shift_start_min)
        AND sys_login_min IS NOT NULL AND shift_start_min IS NOT NULL
        AND sys_login_min < shift_start_min - 180
        AND ot_before_min > 0`, [T]);

  // 2a) residual OT-before cap (>6h early is implausible → persistent session)
  const r2 = await c.query(
    `UPDATE roster_days
        SET ot_min = GREATEST(0, ot_min - (ot_before_min - 360)),
            ot_before_min = 360,
            data_quality = COALESCE(data_quality, 'ot-before-capped')
      WHERE tenant_id=$1 AND ot_before_min > 360`, [T]);

  // 2b) residual OT-after cap (>8h late logout = never-closed session)
  const r3 = await c.query(
    `UPDATE roster_days
        SET ot_min = GREATEST(0, ot_min - (ot_after_min - 480)),
            ot_after_min = 480,
            data_quality = COALESCE(data_quality, 'ot-after-capped')
      WHERE tenant_id=$1 AND ot_after_min > 480`, [T]);

  const after = (await c.query(`SELECT SUM(ot_before_min)::int b, SUM(ot_after_min)::int a, SUM(ot_min)::int t FROM roster_days WHERE tenant_id=$1`, [T])).rows[0];
  console.log('rows fixed: day-wrap=%d  before-cap=%d  after-cap=%d', r1.rowCount, r2.rowCount, r3.rowCount);
  console.log('OT-before total: %d → %d min', before.b, after.b);
  console.log('OT-after  total: %d → %d min', before.a, after.a);
  console.log('OT total:        %d → %d min', before.t, after.t);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
