#!/usr/bin/env node
/*
 * backfill-identity.js — ENTERPRISE DATA-INTEGRITY BACKFILL (idempotent)
 *
 * Builds the canonical Employee_Master_Clean (employee_identity) from the
 * authoritative `employees` + `functions` master, collapsing the same human's
 * multiple employee_no (old intern 6xxx + new full-time 13xxx) into ONE person,
 * seeds the configurable Role_Working_Hours_Lookup, then stamps every roster_days
 * row with clean identity + role-hours dimensions so all KPI queries can:
 *   - dedupe by person_no (one human = one row in rankings)
 *   - default-exclude inactive/superseded ids
 *   - exclude 8h roles (RTA / Customer Care / Resolution Specialist / Team Leader)
 *     from default tardiness KPIs, keeping them as records.
 *
 * Re-runnable: truncates+rebuilds employee_identity & role_working_hours, re-stamps roster_days.
 */
const fs = require('fs'), path = require('path');
const { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
  if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const TENANT = 'a0000000-0000-0000-0000-000000000001';
const norm = s => (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

// Role category (identity) is SEPARATE from 8h-ness (the tardiness-exclusion flag).
// User-confirmed (2026-06-22): RTA / Resolution Specialist / Team Leader = 8h (excluded);
// Customer Care = 9h normal agent BUT keeps its own role label.
const NAMED_ROLES = { 'Team Leader': 1, 'RTA': 1, 'Customer Care': 1, 'Resolution Specialist': 1 };
const EIGHT_HOUR = { 'Team Leader': 1, 'RTA': 1, 'Resolution Specialist': 1 };
function roleOf(fn) {
  const f = (fn || '').trim();
  let cat = 'Agent';
  if (NAMED_ROLES[f]) cat = f;
  else if (/^Intern/i.test(f)) cat = 'Intern';
  else if (f === 'Offline') cat = 'Back Office';
  else if (f === 'OMT') cat = 'OMT';
  else if (f) cat = 'Agent';
  const eight = !!EIGHT_HOUR[f];   // 8h-ness is independent of the role label
  return { cat, hours: eight ? 8 : 9, tardy: !eight };
}

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST || 'localhost', port: +(process.env.POSTGRES_PORT || 5432), database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const q = async (s, p = []) => (await c.query(s, p)).rows;

  // 1) Load master identities
  const emps = await q(`SELECT e.employee_no, e.first_name_en, e.last_name_en, e.gender, e.status,
                               e.employment_type, e.is_supervisor, f.name AS function_name
                        FROM employees e LEFT JOIN functions f ON f.id = e.function_id
                        WHERE e.tenant_id = $1`, [TENANT]);

  // 2) Group by normalized name -> one human
  const groups = new Map();
  for (const e of emps) {
    const key = norm(`${e.first_name_en} ${e.last_name_en}`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  // 3) Resolve canonical + emit identity rows
  const identityRows = [];     // {employee_no, person_no, clean_name, status, is_active, is_canonical, alias_of, employment_type, function_name, role_category, expected_hours, include_*, is_supervisor, gender}
  const dupAudit = [];
  for (const [, rows] of groups) {
    // canonical = active first, then full_time, then highest numeric id
    const sorted = [...rows].sort((a, b) =>
      (Number(b.status === 'active') - Number(a.status === 'active')) ||
      (Number(b.employment_type === 'full_time') - Number(a.employment_type === 'full_time')) ||
      (parseInt(b.employee_no, 10) - parseInt(a.employee_no, 10)));
    const canon = sorted[0];
    const personActive = rows.some(r => r.status === 'active');
    const cleanName = `${canon.first_name_en} ${canon.last_name_en}`.replace(/\s+/g, ' ').trim();
    const role = roleOf(canon.function_name);
    if (rows.length > 1) dupAudit.push({ name: cleanName, ids: rows.map(r => `${r.employee_no}:${r.status}`).join(', '), canonical: canon.employee_no });
    for (const r of rows) {
      const isCanon = r.employee_no === canon.employee_no;
      identityRows.push({
        employee_no: r.employee_no, person_no: canon.employee_no, clean_name: cleanName,
        status: r.status, is_active: personActive, is_canonical: isCanon, alias_of: isCanon ? null : canon.employee_no,
        employment_type: r.employment_type, function_name: canon.function_name, role_category: role.cat,
        expected_hours: role.hours, include_tardiness: role.tardy, include_overtime: true,
        include_adherence: role.tardy, include_kpi: true, is_supervisor: !!canon.is_supervisor, gender: canon.gender,
      });
    }
  }

  // 4) Orphans: in roster_days but not in employees master -> self-canonical, active
  const orphans = await q(`SELECT DISTINCT r.employee_no, r.name, r.function_name, r.gender
                           FROM roster_days r LEFT JOIN employees e ON e.employee_no = r.employee_no AND e.tenant_id = r.tenant_id
                           WHERE r.tenant_id = $1 AND e.id IS NULL`, [TENANT]);
  // pick the most-common REAL function for an orphan from its roster rows
  for (const o of orphans) {
    const realFn = (await q(`SELECT function_name FROM roster_days WHERE tenant_id=$1 AND employee_no=$2
                             AND function_name IN ('Inbound','CH - WA','SM/Mail','Mail & NPS','Refund','OMT','Social Media & Email','Support','Customer Care','RTA','Resolution Specialist','Team Leader','Offline')
                             GROUP BY function_name ORDER BY COUNT(*) DESC LIMIT 1`, [TENANT, o.employee_no]))[0]?.function_name || 'Agent';
    const role = roleOf(realFn);
    identityRows.push({
      employee_no: o.employee_no, person_no: o.employee_no, clean_name: (o.name || o.employee_no).replace(/\s+/g, ' ').trim(),
      status: 'active', is_active: true, is_canonical: true, alias_of: null, employment_type: null,
      function_name: realFn === 'Agent' ? null : realFn, role_category: role.cat, expected_hours: role.hours,
      include_tardiness: role.tardy, include_overtime: true, include_adherence: role.tardy, include_kpi: true,
      is_supervisor: false, gender: o.gender,
    });
  }

  // 5) Write tables
  await c.query('BEGIN');
  await c.query(`DELETE FROM employee_identity WHERE tenant_id=$1`, [TENANT]);
  for (const r of identityRows) {
    await c.query(
      `INSERT INTO employee_identity(tenant_id,employee_no,person_no,clean_name,status,is_active,is_canonical,alias_of,employment_type,function_name,role_category,expected_hours,include_tardiness,include_overtime,include_adherence,include_kpi,is_supervisor,gender)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (tenant_id,employee_no) DO UPDATE SET person_no=EXCLUDED.person_no,clean_name=EXCLUDED.clean_name,status=EXCLUDED.status,is_active=EXCLUDED.is_active,is_canonical=EXCLUDED.is_canonical,alias_of=EXCLUDED.alias_of,function_name=EXCLUDED.function_name,role_category=EXCLUDED.role_category,expected_hours=EXCLUDED.expected_hours,include_tardiness=EXCLUDED.include_tardiness,include_adherence=EXCLUDED.include_adherence,is_supervisor=EXCLUDED.is_supervisor,gender=EXCLUDED.gender`,
      [TENANT, r.employee_no, r.person_no, r.clean_name, r.status, r.is_active, r.is_canonical, r.alias_of, r.employment_type, r.function_name, r.role_category, r.expected_hours, r.include_tardiness, r.include_overtime, r.include_adherence, r.include_kpi, r.is_supervisor, r.gender]);
  }

  // role_working_hours seed (configurable lookup)
  await c.query(`DELETE FROM role_working_hours WHERE tenant_id=$1`, [TENANT]);
  const ROLES = [
    ['Agent', 9, true, true, true, true, 'Standard 9h agent incl. 1h break'],
    ['Intern', 9, true, true, true, true, 'Intern agent, 9h, ~70% productivity factor'],
    ['Team Leader', 8, false, true, false, true, '8h supervisor — records only in tardiness KPI'],
    ['RTA', 8, false, true, false, true, '8h real-time analyst — excluded from agent tardiness KPI'],
    ['Customer Care', 9, true, true, true, true, '9h — normal agent (user-confirmed 2026-06-22, NOT 8h)'],
    ['Resolution Specialist', 8, false, true, false, true, '8h — excluded from agent tardiness KPI'],
    ['Back Office', 9, true, true, true, true, 'Offline/back-office; adjust hours here if 8h'],
    ['OMT', 9, true, true, true, true, 'Order management team'],
  ];
  for (const r of ROLES) await c.query(`INSERT INTO role_working_hours(tenant_id,role_category,default_hours,include_tardiness,include_overtime,include_adherence,include_kpi,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [TENANT, ...r]);

  // 6) Stamp roster_days. expected_hours: mother 7h shift overrides role default.
  const upd = await c.query(
    `UPDATE roster_days r SET
        person_no = i.person_no,
        clean_name = i.clean_name,
        -- role_function = the PER-MONTH function from the uploaded schedule (r.function_name); the
        -- static identity function is only a fallback. An agent's function changes month to month
        -- (e.g. Line Khaled: CH-WA in Jan → Social Media & Email Feb→Jun) so the report must reflect
        -- the schedule, not a single frozen value.
        role_function = COALESCE(NULLIF(r.function_name,''), i.function_name),
        role_category = i.role_category,
        expected_hours = CASE WHEN r.is_7h THEN 7 ELSE i.expected_hours END,
        include_tardiness = i.include_tardiness,
        -- is_active here is the CANONICAL-dedup flag (collapse old↔new intern IDs to ONE person),
        -- NOT an employment flag. Someone who left keeps their historical rows visible so reports
        -- don't break; forward-scheduling eligibility lives in employees.status instead.
        is_active = i.is_canonical,
        dup_alias = NOT i.is_canonical
     FROM employee_identity i
     WHERE i.tenant_id = r.tenant_id AND i.employee_no = r.employee_no AND r.tenant_id = $1`, [TENANT]);

  // 7) Second pass: enrich identity with team_leader / team_group / last_working_date from roster (mode)
  await c.query(
    `UPDATE employee_identity i SET
        team_leader = s.tl, team_group = s.tg, last_working_date = s.lwd
     FROM (
        SELECT person_no,
               mode() WITHIN GROUP (ORDER BY team_manager) tl,
               mode() WITHIN GROUP (ORDER BY team_group)   tg,
               MAX(work_date) lwd
        FROM roster_days WHERE tenant_id=$1 AND person_no IS NOT NULL GROUP BY person_no
     ) s
     WHERE i.tenant_id=$1 AND i.person_no = s.person_no`, [TENANT]);
  // 7b) Durability: scrub any hidden team-leader label from the roster (e.g. a TL who
  //     left and must not be mentioned anywhere). Driven by team_leader_status.hidden.
  try {
    const scrub = await c.query(
      `UPDATE roster_days SET team_manager=NULL WHERE tenant_id=$1 AND team_manager IN
         (SELECT name FROM team_leader_status WHERE tenant_id=$1 AND hidden)`, [TENANT]);
    if (scrub.rowCount) console.log(`scrubbed ${scrub.rowCount} hidden-TL roster rows`);
  } catch (e) { /* table may not exist on older DBs */ }
  await c.query('COMMIT');

  // 8) Report
  const unstamped = (await q(`SELECT COUNT(*)::int n FROM roster_days WHERE tenant_id=$1 AND person_no IS NULL`, [TENANT]))[0].n;
  const persons = (await q(`SELECT COUNT(DISTINCT person_no)::int n FROM employee_identity WHERE tenant_id=$1`, [TENANT]))[0].n;
  const rawIds = (await q(`SELECT COUNT(*)::int n FROM employee_identity WHERE tenant_id=$1`, [TENANT]))[0].n;
  const aliases = (await q(`SELECT COUNT(*)::int n FROM employee_identity WHERE tenant_id=$1 AND NOT is_canonical`, [TENANT]))[0].n;
  const inactive = (await q(`SELECT COUNT(DISTINCT person_no)::int n FROM employee_identity WHERE tenant_id=$1 AND NOT is_active`, [TENANT]))[0].n;
  console.log(`\n=== BACKFILL COMPLETE ===`);
  console.log(`raw employee ids: ${rawIds}  ->  canonical persons: ${persons}  (aliases collapsed: ${aliases})`);
  console.log(`persons inactive (no active id): ${inactive}`);
  console.log(`roster_days rows still un-stamped (orphan/no identity): ${unstamped}`);
  console.log(`duplicate-id humans merged: ${dupAudit.length}`);
  console.table(dupAudit.slice(0, 30));
  const roleDist = await q(`SELECT role_category, expected_hours, include_tardiness, COUNT(DISTINCT person_no)::int persons FROM employee_identity WHERE tenant_id=$1 AND is_canonical GROUP BY 1,2,3 ORDER BY persons DESC`, [TENANT]);
  console.log('\nRole distribution (canonical persons):'); console.table(roleDist);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
