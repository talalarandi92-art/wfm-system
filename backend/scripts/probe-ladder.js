/* READ-ONLY: reproduce the NEW ladder assign() (weekly +wk step) against the FOLDED CH-WA pool.
 * Confirms: pool folds interns (38), Week-2 != Week-1 for everyone, coverage still meets demand. */
const fs = require('fs'), path = require('path'), { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
  if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST || 'localhost', port: +(process.env.POSTGRES_PORT || 5432), database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const q = async (s, p = []) => (await c.query(s, p)).rows;
  const [{ tenant_id: t }] = await q(`SELECT tenant_id FROM roster_days LIMIT 1`);
  const fn = 'CH - WA', ws = '2026-06-27', weeks = 2, nDays = weeks * 7;
  const dates = []; { const d = new Date(ws + 'T00:00:00Z'); for (let i = 0; i < nDays; i++) { dates.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } }

  const pool = await q(`SELECT e.employee_no, TRIM(CONCAT(e.first_name_en,' ',COALESCE(e.last_name_en,''))) name, COALESCE(e.gender,'male') gender
    FROM employees e JOIN functions f ON f.id=e.function_id WHERE e.tenant_id=$1 AND e.status='active' AND canon_fn(f.name)=$2 ORDER BY e.employee_no`, [t, fn]);
  const dRows = await q(`
    WITH r AS (SELECT shift_start_min ss FROM roster_days WHERE tenant_id=$1 AND is_active AND shift_start_min IS NOT NULL AND canon_fn(COALESCE(role_function,function_name))=$2 AND work_date >= ($3::date-28) AND work_date < $3::date),
    d AS (SELECT GREATEST(COUNT(DISTINCT work_date),1) n FROM roster_days WHERE tenant_id=$1 AND is_active AND shift_start_min IS NOT NULL AND work_date >= ($3::date-28) AND work_date < $3::date)
    SELECT ROUND(COUNT(*) FILTER (WHERE ss>=300 AND ss<720)::numeric/(SELECT n FROM d),1)::float morning,
           ROUND(COUNT(*) FILTER (WHERE ss>=720 AND ss<1020)::numeric/(SELECT n FROM d),1)::float evening,
           ROUND(COUNT(*) FILTER (WHERE ss>=1020 OR ss<300)::numeric/(SELECT n FROM d),1)::float night FROM r`, [t, fn, ws]);
  const demand = { morning: dRows[0].morning, evening: dRows[0].evening, night: dRows[0].night };
  const avg = (demand.morning + demand.evening + demand.night) / 3 || 1;
  const blk = (d) => d >= avg * 1.15 ? 3 : 2;
  const bandLen = { morning: blk(demand.morning), evening: blk(demand.evening), night: blk(demand.night) };
  const order = ['morning', 'evening', 'night'];
  const maleCycle = []; for (const b of order) for (let i = 0; i < bandLen[b]; i++) maleCycle.push(b); maleCycle.push('OFF', 'OFF');
  const fOrder = order.filter(b => b !== 'night');
  const femaleCycle = []; for (const b of fOrder) for (let i = 0; i < bandLen[b]; i++) femaleCycle.push(b); femaleCycle.push('OFF', 'OFF');
  const CODES = { morning: ['M', 'B', 'C'], evening: ['N', 'E'], night: ['MD', 'MN'] };
  const males = pool.filter(p => p.gender === 'male'), females = pool.filter(p => p.gender !== 'male');
  // NEW assign() with weekly +wk step
  const assign = (list, cycle) => list.map((p, i) => {
    const phase = cycle.length ? Math.floor(i * cycle.length / Math.max(1, list.length)) : 0;
    const days = dates.map((_, d) => {
      const wk = Math.floor(d / 7);
      const band = cycle[(phase + wk + d) % cycle.length];
      if (band === 'OFF') return 'OFF';
      const codes = CODES[band]; return codes[(i + wk) % codes.length];
    });
    return { employeeNo: p.employee_no, name: p.name, gender: p.gender, days };
  });
  const grid = [...assign(males, maleCycle), ...assign(females, femaleCycle)];

  console.log(`pool=${pool.length} (M ${males.length}/F ${females.length})  demand M${demand.morning}/E${demand.evening}/N${demand.night}  blocks ${bandLen.morning}/${bandLen.evening}/${bandLen.night}`);
  console.log(`maleCycle(${maleCycle.length}): ${maleCycle.join(',')}`);
  console.log(`femaleCycle(${femaleCycle.length}): ${femaleCycle.join(',')}`);
  // Week2==Week1 check
  const same = grid.filter(g => g.days.slice(0, 7).join() === g.days.slice(7, 14).join());
  console.log(`\nWeek2==Week1 (static) agents: ${same.length}/${grid.length}  ${same.length === 0 ? '✓ NONE static' : '✗ ' + same.map(g => g.employeeNo).join(',')}`);
  // distinct bands
  const bandOf = c => c === 'OFF' ? 'off' : ['M', 'B', 'C', 'AM'].includes(c) ? 'm' : ['N', 'E', 'EE'].includes(c) ? 'e' : 'n';
  const distinct = grid.map(g => new Set(g.days.filter(x => x !== 'OFF').map(bandOf)).size);
  console.log(`distinct working bands per agent: min=${Math.min(...distinct)} max=${Math.max(...distinct)} avg=${(distinct.reduce((a, b) => a + b, 0) / distinct.length).toFixed(1)}`);
  // coverage vs demand per day
  let short = 0;
  for (let d = 0; d < nDays; d++) {
    const cnt = { m: 0, e: 0, n: 0 };
    for (const g of grid) { const b = bandOf(g.days[d]); if (b !== 'off') cnt[b]++; }
    const gap = { m: demand.morning - cnt.m, e: demand.evening - cnt.e, n: demand.night - cnt.n };
    if (gap.m >= 1 || gap.e >= 1 || gap.n >= 1) short++;
  }
  console.log(`short days (any band gap>=1): ${short}/${nDays}  ${short === 0 ? '✓ covers demand' : '⚠'}`);
  console.log('\nSAMPLE rows (W1 | W2):');
  for (const g of [...males.slice(0, 3), ...females.slice(0, 3)].map(p => grid.find(x => x.employeeNo === p.employee_no))) {
    console.log(`  ${g.employeeNo} ${g.gender[0]}: ${g.days.slice(0, 7).join(' ').padEnd(24)} | ${g.days.slice(7, 14).join(' ')}`);
  }
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
