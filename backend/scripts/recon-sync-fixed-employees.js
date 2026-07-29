#!/usr/bin/env node
/*
 * Make sure every `fixedEmployees` person in recon-config.json exists in `employees`.
 *
 * WHY. Standing-pattern people are not on the ops schedule sheet; the engine generates
 * their roster days from the config. But nothing ever created them as EMPLOYEES, and
 * roster_days joins employees for coverage, the scorecard, People 360 and the whole
 * legacy spine. Amthal Alrashid (13863) had 28 July roster days and appeared on none of
 * those screens — she was in the roster and nowhere else. Her twin in the same config
 * block, Athari Almulla, happened to exist already, so the gap looked like nothing.
 *
 * That is a CLASS of bug: it fires again the next time a name is added to the config.
 * So this reconciles the whole list, not the one person, and the accuracy audit's A2
 * check is what catches a regression.
 *
 * Dry-run by default. Only ever INSERTS a missing person — never edits an existing row,
 * because the HR record is the authority for anyone who already has one.
 *
 *   node scripts/recon-sync-fixed-employees.js [--apply]
 */
const fs = require('fs'), path = require('path');
const { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
const APPLY = process.argv.includes('--apply');
const TENANT = process.env.RECON_TENANT || 'a0000000-0000-0000-0000-000000000001';

(async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'recon-config.json'), 'utf8'));
  const people = cfg.fixedEmployees || [];
  if (!people.length) { console.log('no fixedEmployees configured.'); return; }

  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();

  const plan = [];
  for (const p of people) {
    const no = String(p.id);
    const [have] = (await c.query(`SELECT employee_no FROM employees WHERE tenant_id=$1 AND employee_no=$2`, [TENANT, no])).rows;
    if (have) { console.log(`  ${no} ${p.name} — already present`); continue; }
    const [fn] = (await c.query(`SELECT id, name FROM functions WHERE tenant_id=$1 AND lower(name)=lower($2) LIMIT 1`, [TENANT, p.function || ''])).rows;
    const parts = String(p.name || '').trim().split(/\s+/);
    plan.push({
      no, first: parts[0] || no, last: parts.slice(1).join(' ') || '',
      gender: /female/i.test(p.gender || '') ? 'female' : 'male',
      fnId: fn ? fn.id : null, fnName: fn ? fn.name : `(no function named "${p.function}")`,
      roster: (await c.query(`SELECT COUNT(*)::int n FROM roster_days WHERE tenant_id=$1 AND person_no=$2`, [TENANT, no])).rows[0].n,
    });
  }
  if (!plan.length) { console.log('\nnothing missing.'); await c.end(); return; }

  console.log(`\n${APPLY ? 'CREATING' : 'would create'} ${plan.length} employee record(s):`);
  for (const p of plan)
    console.log(`  ${p.no}  ${p.first} ${p.last}  ${p.gender}  function ${p.fnName}  — ${p.roster} roster day(s) currently invisible downstream`);
  if (!APPLY) { console.log('\n(dry run — pass --apply)'); await c.end(); return; }

  await c.query('BEGIN');
  try {
    for (const p of plan) {
      await c.query(
        `INSERT INTO employees (tenant_id, employee_no, first_name_en, last_name_en, gender, employment_type, status, function_id)
         VALUES ($1,$2,$3,$4,$5::gender_enum,'full_time','active',$6)
         ON CONFLICT DO NOTHING`,
        [TENANT, p.no, p.first, p.last, p.gender, p.fnId]);
      await c.query(
        `INSERT INTO audit_logs (tenant_id, action, module, entity_type, new_value, notes)
         VALUES ($1,'create','employees','employee',$2,$3)`,
        [TENANT, JSON.stringify({ employee_no: p.no, name: `${p.first} ${p.last}`, function: p.fnName, source: 'recon-config fixedEmployees' }),
         `Created from recon-config fixedEmployees — ${p.roster} roster days existed with no employee record, making the person invisible to every employee-joined surface.`]);
    }
    await c.query('COMMIT');
    console.log(`\n  created ${plan.length} · audit written`);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('ROLLED BACK —', e.message);
    process.exit(1);
  }
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
