/* Broad practical smoke of EVERY schedule-related endpoint (all sections). Checks 200/no-5xx,
 * JSON parses, and basic sanity. Read-only (GETs + preview POSTs that don't persist). */
const { execSync } = require('child_process');
const http = require('http');
const path = require('path');
const TOKEN = execSync('node scripts/gen-test-token.js', { cwd: path.join(__dirname, '..') }).toString().trim().split(/\s+/).pop();
const BASE = 'http://localhost:3000/api/v1';
function call(method, url, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(BASE + '/' + url, { method, headers: { Authorization: 'Bearer ' + TOKEN, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let s = ''; res.on('data', d => s += d); res.on('end', () => { let j = null, ok = false; try { j = JSON.parse(s); ok = true; } catch {} resolve({ code: res.statusCode, j, ok, len: s.length }); });
    });
    req.on('error', e => resolve({ code: 0, err: e.message }));
    req.setTimeout(60000, () => { req.destroy(); resolve({ code: 0, err: 'timeout' }); });
    if (data) req.write(data); req.end();
  });
}
const GETS = [
  ['schedule/grid?weekStart=2026-06-27', 'Schedule grid'],
  ['schedule/functions', 'Schedule functions'],
  ['schedule/coverage?weekStart=2026-06-27', 'Schedule coverage'],
  ['schedule/available-weeks', 'Available weeks'],
  ['schedule-generator/functions', 'Generator functions (folded)'],
  ['schedule-generator/available-weeks', 'Generator weeks'],
  ['schedule-generator/versions', 'Schedule versions'],
  ['attendance-recon/roster-v2/hourly?function=CH%20-%20WA', 'Hourly HC'],
  ['attendance-recon/roster-v2/week-forecast?function=CH%20-%20WA', 'Week forecast'],
  ['attendance-recon/roster-v2/gap-remedies?function=CH%20-%20WA', 'Gap remedies'],
  ['attendance-recon/roster-v2/interval-headcount', 'Interval headcount'],
  ['attendance-recon/roster-v2/coverage-impact', 'Coverage impact'],
  ['attendance-recon/roster-v2/schedule-analysis', 'Schedule analysis'],
  ['attendance-recon/roster-v2/ot-exceptions', 'OT & exceptions'],
  ['attendance-recon/roster-v2/trends', 'Trends'],
  ['attendance-recon/roster-v2/insights', 'Insights'],
  ['attendance-recon/roster-v2/fairness', 'Fairness'],
  ['attendance-recon/roster-v2/ladder-generate?function=CH%20-%20WA&weeks=2', 'Ladder generate'],
  ['attendance-recon/roster-v2/generate?function=CH%20-%20WA', 'Demand-mix generate'],
  ['attendance-recon/roster-v2/generate-week?function=CH%20-%20WA', 'Generate week'],
  ['attendance-recon/roster-v2/gap-backfill', 'Gap backfill'],
  ['attendance-recon/roster-v2/on-seat?date=2026-06-25&function=CH%20-%20WA&hour=14', 'On-seat'],
  ['attendance-recon/roster-v2/permission-coverage-check?date=2026-06-25&function=CH%20-%20WA&startHour=14&endHour=16', 'Permission coverage'],
  ['attendance-recon/roster-dashboard', 'Roster dashboard'],
  ['schedule-changes/list', 'Schedule changes list'],
  ['campaigns', 'Campaigns'],
  ['coverage/hourly', 'Coverage hourly'],
  ['capacity/hc-overview?date=2026-06-25', 'Capacity HC overview'],
];
const POSTS = [
  ['schedule-generator/generate-demand', { weekStart: '2026-06-28' }, 'Generate (demand) preview'],
  ['schedule-generator/generate', { weekStart: '2026-06-28', options: { weeks: 2 } }, 'Generate (classic) preview'],
];
(async () => {
  let pass = 0, fail = 0; const fails = [];
  console.log('═══ SCHEDULE — all sections (GET) ═══');
  for (const [url, name] of GETS) {
    const r = await call('GET', url);
    const ok = r.code >= 200 && r.code < 400 && r.ok;
    console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(28)} HTTP ${r.code || r.err}${r.ok ? '' : ' (non-JSON)'}`);
    ok ? pass++ : (fail++, fails.push(name + ' → ' + (r.code || r.err)));
  }
  console.log('\n═══ GENERATORS (POST preview, no persist) ═══');
  for (const [url, body, name] of POSTS) {
    const r = await call('POST', url, body);
    const ok = r.code >= 200 && r.code < 400 && r.ok;
    console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(28)} HTTP ${r.code || r.err}`);
    ok ? pass++ : (fail++, fails.push(name));
  }
  console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
  if (fails.length) console.log('FAILURES:\n  ' + fails.join('\n  '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
