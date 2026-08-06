#!/usr/bin/env node
/**
 * audit-requests.js — does the permission HC-impact tell the approver the truth?
 *
 * The one job of Permission HC Impact is to answer "if I approve this, who is left
 * on seat?". It answers entirely out of roster_days, so the keys it uses to find the
 * requester there must be the ROSTER's keys. This harness re-derives, per pending
 * permission and per hour:
 *
 *   is the requester rostered that day?          (roster_days, canonical row)
 *   is the requester WORKING during that hour?   (shift window, cross-midnight aware)
 *   how many of their function are on seat?      (before and after approval)
 *
 * and compares against what the endpoint reports.
 *
 * Dates come from the DATABASE as ::text. The API serializes a `date` column as a
 * UTC instant — "2026-07-06T21:00:00.000Z" IS 2026-07-07 in Kuwait — and slicing
 * the first ten characters of that shifts every date back a day. That mistake
 * invented three defects the first time this was checked by hand.
 *
 * Read-only.  node scripts/audit-requests.js
 */
const fs = require('fs'), path = require('path'), { Client } = require('pg');
const envPath = path.join(__dirname, '..', '..', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const BASE = process.env.WFM_BASE || 'http://localhost:3000/api/v1';
const EMAIL = process.env.WFM_EMAIL || 'demo.admin@boutiqaat.wfm';
const PASS = process.env.WFM_PASS || 'Demo@2026';

const c = new Client({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

const findings = [];
const pad = (s, n) => String(s).padEnd(n);

(async () => {
  await c.connect();
  const q = async (s, p = []) => (await c.query(s, p)).rows;

  const tok = (await (await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  })).json()).accessToken;
  const H = { Authorization: 'Bearer ' + tok };

  const perms = await q(
    `SELECT r.id::text, (e.first_name_en||' '||e.last_name_en) nm, e.employee_no::text emp_no,
            rp.permission_date::text pd, rp.start_time::text st, rp.end_time::text et
     FROM requests r JOIN request_permissions rp ON rp.request_id = r.id
     JOIN employees e ON e.id = r.employee_id
     WHERE r.status = 'pending' ORDER BY rp.permission_date`);

  console.log(`\n  PERMISSION HC-IMPACT AUDIT — ${perms.length} pending\n  ${'─'.repeat(74)}`);

  let ok = 0;
  for (const p of perms) {
    // The roster's own view of this person on that day: canonical row preferred,
    // never filtered away by is_active (which marks the canonical duplicate, not
    // employment — filtering on it erases anyone whose single row is not flagged).
    const [ident] = await q(
      `SELECT person_no::text pn FROM employee_identity WHERE employee_no::text = $1 LIMIT 1`, [p.emp_no]);
    const personNo = ident?.pn ?? p.emp_no;
    const [row] = await q(
      `SELECT hr_code, shift_start_min ss, shift_end_min se, presence, role_function
       FROM roster_days WHERE person_no::text = $1 AND work_date = $2::date
       ORDER BY is_active DESC LIMIT 1`, [personNo, p.pd]);
    const [prev] = await q(
      `SELECT shift_start_min ss, shift_end_min se, presence
       FROM roster_days WHERE person_no::text = $1 AND work_date = $2::date - 1
       ORDER BY is_active DESC LIMIT 1`, [personNo, p.pd]);

    const rostered = !!(row && ['office', 'wfh'].includes(row.presence) && row.ss != null);
    const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
    const workingAt = (mod) => {
      if (rostered && mod >= row.ss && mod < Math.min(row.se, 1440)) return true;
      if (prev && ['office', 'wfh'].includes(prev.presence) && prev.se > 1440 && mod < prev.se - 1440) return true;
      return false;
    };

    const imp = await (await fetch(`${BASE}/requests/${p.id}/hc-impact`, { headers: H })).json();
    const hours = imp.hourly || [];
    const mismatches = [];
    if (!!imp.requesterScheduled !== rostered)
      mismatches.push(`rostered: endpoint ${imp.requesterScheduled} vs roster ${rostered}`);
    for (const h of hours) {
      const mine = workingAt(h.hour * 60 + 30);   // mid-hour probe
      if (!!h.requesterWorking !== mine)
        mismatches.push(`h${h.hour}: working ${h.requesterWorking} vs ${mine}`);
      if (h.afterApproval !== h.scheduled - (mine ? 1 : 0))
        mismatches.push(`h${h.hour}: after ${h.afterApproval} vs scheduled ${h.scheduled} − ${mine ? 1 : 0}`);
    }

    const shift = rostered ? `${row.hr_code} ${Math.floor(row.ss / 60)}:00-${Math.floor(row.se / 60) % 24}:00` : (row?.hr_code ?? '—');
    console.log(`  ${pad(p.nm, 24)} ${p.pd} ${p.st.slice(0, 5)}-${p.et.slice(0, 5)}  roster ${pad(shift, 14)}` +
      (mismatches.length ? `  ✗ ${mismatches[0]}` : '  ✓'));
    if (mismatches.length) findings.push({ who: p.nm, date: p.pd, mismatches });
    else ok++;
  }

  console.log(`\n  ${'─'.repeat(74)}`);
  if (!findings.length) console.log(`  CLEAN — ${ok}/${perms.length} permissions re-derive to the roster\n`);
  else {
    for (const f of findings) console.log(`  ${f.who} ${f.date}\n     ${f.mismatches.join('\n     ')}`);
    console.log(`\n  ${findings.length} of ${perms.length} disagree\n`);
  }
  await c.end();
  process.exit(findings.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
