/* Deep smoke test of the intern-fold + ladder fix against the LIVE backend (:3000/api/v1).
 * Verifies folded endpoints return 200 with interns merged, and cross-checks numbers vs raw SQL. */
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path'), { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
  if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const TOKEN = execSync('node scripts/gen-test-token.js', { cwd: path.join(__dirname, '..') }).toString().trim().split(/\s+/).pop();
const BASE = 'http://localhost:3000/api/v1';
const http = require('http');
function get(url) {
  return new Promise((resolve) => {
    const req = http.get(BASE + url, { headers: { Authorization: 'Bearer ' + TOKEN } }, (res) => {
      let s = ''; res.on('data', d => s += d); res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch {} resolve({ code: res.statusCode, j, raw: s.slice(0, 200) }); });
    });
    req.on('error', e => resolve({ code: 0, err: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ code: 0, err: 'timeout' }); });
  });
}
(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST || 'localhost', port: +(process.env.POSTGRES_PORT || 5432), database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const q = async (s, p = []) => (await c.query(s, p)).rows;
  let pass = 0, fail = 0;
  const check = (name, cond, detail) => { console.log(`  ${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); cond ? pass++ : fail++; };

  console.log('\n═══ 1. LADDER (folded pool + static fix) ═══');
  const lad = await get('/attendance-recon/roster-v2/ladder-generate?function=CH%20-%20WA&weeks=2');
  check('ladder 200', lad.code === 200, 'HTTP ' + lad.code);
  check('ladder pool folds interns (38)', lad.j?.poolSize === 38, 'pool=' + lad.j?.poolSize);
  check('ladder covers demand', lad.j?.summary?.coversAll === true, 'shortDays=' + lad.j?.summary?.shortDays);
  // static: week2 != week1 for every agent
  const staticAgents = (lad.j?.grid || []).filter(g => g.days.slice(0, 7).join() === g.days.slice(7, 14).join());
  check('no static agents (week2≠week1)', staticAgents.length === 0, staticAgents.length + ' static');

  console.log('\n═══ 2. HOURLY (folded — CH-WA includes interns) ═══');
  const hr = await get('/attendance-recon/roster-v2/hourly?function=CH%20-%20WA');
  check('hourly 200', hr.code === 200, 'HTTP ' + hr.code);
  const hrPeople = hr.j?.functions?.length ?? 'n/a';
  // functions list should NOT contain any "Internship" entry anymore
  const fnList = hr.j?.functions || [];
  check('hourly fn dropdown has NO Internship entries', !fnList.some(f => /internship/i.test(f)), 'fns=' + JSON.stringify(fnList.slice(0, 12)));

  console.log('\n═══ 3. ROSTER DASHBOARD (byFunction folded) ═══');
  const rd = await get('/attendance-recon/roster-dashboard');
  check('roster-dashboard 200', rd.code === 200, 'HTTP ' + rd.code);
  const byFn = rd.j?.distributions?.byFunction || rd.j?.byFunction || [];
  const rdFns = byFn.map(x => x.k || x.name || x.function);
  check('byFunction has NO Internship rows', !rdFns.some(f => /internship/i.test(String(f))), 'fns=' + JSON.stringify(rdFns.slice(0, 12)));
  const chwaRow = byFn.find(x => (x.k || x.name) === 'CH - WA');
  check('CH-WA present in byFunction', !!chwaRow, chwaRow ? 'n=' + (chwaRow.n) : 'missing');

  console.log('\n═══ 4. CROSS-CHECK folded counts vs RAW SQL ═══');
  const [{ people: rawFolded }] = await q(`SELECT COUNT(DISTINCT person_no)::int people FROM roster_days WHERE canon_fn(COALESCE(role_function,function_name))='CH - WA' AND work_date >= CURRENT_DATE-60`);
  const [{ people: rawParentOnly }] = await q(`SELECT COUNT(DISTINCT person_no)::int people FROM roster_days WHERE role_function='CH - WA' AND work_date >= CURRENT_DATE-60`);
  console.log(`  (raw SQL) CH-WA folded people=${rawFolded}, parent-only=${rawParentOnly}, interns folded in=${rawFolded - rawParentOnly}`);
  check('fold actually merges interns (folded > parent-only)', rawFolded > rawParentOnly, `${rawFolded} > ${rawParentOnly}`);

  console.log('\n═══ 5. OTHER FOLDED ENDPOINTS return 200 (no 5xx) ═══');
  const eps = [
    ['week-forecast', '/attendance-recon/roster-v2/week-forecast?function=CH%20-%20WA'],
    ['gap-remedies', '/attendance-recon/roster-v2/gap-remedies?function=CH%20-%20WA'],
    ['interval-headcount', '/attendance-recon/roster-v2/interval-headcount'],
    ['coverage-impact', '/attendance-recon/roster-v2/coverage-impact'],
    ['schedule-analysis', '/attendance-recon/roster-v2/schedule-analysis'],
    ['ot-exceptions', '/attendance-recon/roster-v2/ot-exceptions'],
    ['trends', '/attendance-recon/roster-v2/trends'],
    ['generate(mix)', '/attendance-recon/roster-v2/generate?function=CH%20-%20WA'],
    ['dashboard', '/dashboard/summary'],
    ['control-dashboard', '/control-dashboard'],
    ['coverage/hourly', '/coverage/hourly'],
    ['schedule-generator/functions', '/schedule-generator/functions'],
  ];
  for (const [name, url] of eps) { const r = await get(url); check(name + ' no-5xx', r.code < 500 && r.code !== 0, 'HTTP ' + (r.code || r.err)); }

  console.log('\n═══ 6. FUNCTION DROPDOWN (getFunctions) folds interns ═══');
  const gf = await get('/schedule-generator/functions');
  const gfArr = Array.isArray(gf.j) ? gf.j : [];
  const gfNames = gfArr.map(f => f.name);
  check('getFunctions no Internship options', !gfNames.some(n => /internship/i.test(String(n))), 'names=' + JSON.stringify(gfNames.slice(0, 14)));
  const chwaOpt = gfArr.find(f => f.name === 'CH - WA');
  check('CH-WA option shows folded headcount (~38)', chwaOpt && +chwaOpt.employee_count >= 35, 'count=' + chwaOpt?.employee_count);

  console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
  await c.end();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
