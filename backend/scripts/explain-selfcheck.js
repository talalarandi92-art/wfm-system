#!/usr/bin/env node
/*
 * Runs the /explain re-derivation across EVERY scored day in a range and reports how many
 * disagree with the stored conformance.
 *
 * The drill-down's promise is that it re-derives rather than re-states, which is only worth
 * anything if someone actually checks whether the derivation holds at scale. A single row
 * looking right proves nothing: the cross-midnight bug this harness found passed on two
 * E-shift rows by luck and failed on MD, and no amount of spot-checking would have separated
 * those two outcomes reliably.
 *
 * Reads the DB directly and runs the same arithmetic as explain.controller.ts. Keep the two
 * in step: if the controller's formula changes, change it here in the same commit, or this
 * harness starts certifying a formula nobody uses.
 *
 *   node scripts/explain-selfcheck.js 2026-07-01 2026-07-28
 */
const { getClient } = require('./recon-db');
const MATERNITY = new Set(['12375', '12434']);
const MATERNITY_WINDOW = 420;

const from = process.argv[2] || '2026-07-01';
const to = process.argv[3] || '2026-07-28';

(async () => {
  const c = getClient();
  await c.connect();
  try {
    const { rows } = await c.query(
      `SELECT person_no, clean_name, work_date::text AS d, shift_code,
              shift_start_min ss, shift_end_min se, sys_login_min li, sys_logout_min lo,
              raw_sys_late_min rl, raw_sys_early_min re, sys_late_min sl, sys_early_min se2,
              permission, permission_status, comp_off, adherence_pct, crosses_midnight
         FROM roster_days
        WHERE is_active AND work_date BETWEEN $1 AND $2
          AND adherence_pct IS NOT NULL AND shift_start_min IS NOT NULL
          AND sys_login_min IS NOT NULL AND sys_logout_min IS NOT NULL`, [from, to]);

    let ok = 0; const bad = [];
    for (const r of rows) {
      const ss = Number(r.ss);
      let se = Number(r.se);
      const wrapped = se <= ss;
      if (wrapped) se += 1440;

      /* Same proximity rule as explain.controller.ts — of (t, t+1440) take whichever sits
         nearer its anchor. Anything threshold-based misclassifies early arrivals. */
      const nearest = (t, anchor) => (Math.abs(t - anchor) <= Math.abs(t + 1440 - anchor) ? t : t + 1440);
      let li = nearest(Number(r.li), ss), lo = nearest(Number(r.lo), se);
      if (lo < li) lo += 1440;

      const isMother = MATERNITY.has(String(r.person_no));
      const paidRaw = se - ss;
      const paid = isMother ? Math.min(paidRaw, MATERNITY_WINDOW) : paidRaw;
      const effEnd = isMother ? ss + paid : se;
      const overlap = Math.max(0, Math.min(lo, effEnd) - Math.max(li, ss));

      const rl = r.rl == null ? null : Number(r.rl), re = r.re == null ? null : Number(r.re);
      /* Read forgiveness from the permission, not from the zero — maternity also zeroes the
         early-out but earns no credit, and an approved permission earns credit even for a
         mother. See the note in explain.controller.ts. */
      const covered = /approved/i.test(String(r.permission_status || r.permission || '')) || !!r.comp_off;
      const lateForgiven = rl != null && rl > 0 && Number(r.sl) === 0 && covered;
      const earlyForgiven = re != null && re > 0 && Number(r.se2) === 0 && covered;
      const permitted = (lateForgiven ? rl : 0) + (earlyForgiven ? re : 0);

      const recomputed = paid > 0 ? Math.min(100, Math.round(100 * Math.min(overlap + permitted, paid) / paid)) : null;
      const stored = Math.round(Number(r.adherence_pct));
      if (recomputed != null && Math.abs(recomputed - stored) <= 1) ok++;
      else bad.push({ who: r.clean_name, date: r.d, code: r.shift_code, stored, recomputed, cm: r.crosses_midnight });
    }

    const pct = rows.length ? ((100 * ok) / rows.length).toFixed(2) : '—';
    console.log(`\nEXPLAIN SELF-CHECK  ${from} → ${to}`);
    console.log(`  ${ok}/${rows.length} scored days re-derive to their stored conformance  (${pct}%)`);
    if (bad.length) {
      console.log(`\n  ${bad.length} DISAGREE — the drill-down would tell a story the number does not support:`);
      console.table(bad.slice(0, 15));
      process.exitCode = 1;
    } else {
      console.log('  ✅ every scored day accounts for itself.');
    }
  } finally { await c.end(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
