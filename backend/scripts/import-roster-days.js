#!/usr/bin/env node
/*
 * Populate roster_days with the CORRECT combined roster (validated logic):
 *   FingerPrint punch + Ameyo & Sprinklr system login/logout (earliest/latest,
 *   Sprinklr = Kuwait LOCAL) + Odoo permission/comp-off/sick.
 * Full FingerPrint window. Idempotent (delete+insert). Run after migration 053.
 */
const ExcelJS = require('exceljs');
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }

const DIR = 'C:/Users/t.bassam/Desktop/ALL DATA';
const FROM = '2026-01-01', TO = '2026-06-20';
const KW = 0;   // Ameyo session login/logout is already Kuwait LOCAL (verified: voice agent punch 11:17 ≈ Ameyo login 11:24); same as Sprinklr
const cv = x => { if (x == null) return ''; if (x instanceof Date) return x; if (typeof x === 'object') return x.text != null ? x.text : (x.result != null ? x.result : ''); return x; };
const str = x => { const v = cv(x); return v instanceof Date ? v.toISOString() : String(v); };
const minOf = d => d instanceof Date ? d.getUTCHours()*60 + d.getUTCMinutes() : null;        // local clock → mins
const durMin = x => { const v = cv(x); return v instanceof Date ? v.getUTCHours()*60 + v.getUTCMinutes() : 0; };
const sprkLocal = x => (x instanceof Date) ? new Date(x.getTime()) : null;
const ameyoLocal = n => { if (typeof n !== 'number' || !(n > 20000 && n < 80000)) return null; return new Date(Date.UTC(1899,11,30) + n*86400000 + KW); };
const isoDate = d => d ? d.toISOString().slice(0,10) : null;
const bracketNo = s => { const m = String(s||'').match(/\[\s*(\d{3,6})\s*\]/); return m ? m[1] : null; };

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const tid = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows[0].id;
  await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', '053_roster_days.sql'), 'utf8'));
  const emps = (await c.query(`SELECT e.employee_no, TRIM(e.first_name_en||' '||COALESCE(e.last_name_en,'')) name, f.name fn FROM employees e LEFT JOIN functions f ON f.id=e.function_id`)).rows;
  const empByNo = new Map(emps.map(e => [String(e.employee_no), e]));
  const sm = (await c.query(`SELECT m.sprinklr_agent_id, lower(m.agent_email) email, e.employee_no FROM sprinklr_agent_map m JOIN employees e ON e.id=m.employee_id WHERE m.employee_id IS NOT NULL`)).rows;
  const loginToNo = new Map(), sprkIdToNo = new Map();
  for (const r of sm) { if (r.email) loginToNo.set(r.email.split('@')[0], String(r.employee_no)); if (r.sprinklr_agent_id) sprkIdToNo.set(String(r.sprinklr_agent_id), String(r.employee_no)); }

  // 1. FingerPrint spine
  const spine = new Map();
  let wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(DIR, 'Odoo FingerPrint in and out details.xlsx'));
  let ws = wb.worksheets[0];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r); const d = row.getCell(2).value;
    if (!(d instanceof Date)) continue; const iso = d.toISOString().slice(0,10); if (iso < FROM || iso > TO) continue;
    const no = String(cv(row.getCell(1).value)).replace(/\D/g,''); if (!no) continue;
    spine.set(`${no}|${iso}`, { no, iso, day: str(cv(row.getCell(3).value)),
      punchIn: minOf(row.getCell(4).value), punchOut: minOf(row.getCell(5).value),
      late: durMin(row.getCell(7).value), early: durMin(row.getCell(8).value), ot: durMin(row.getCell(9).value),
      status: str(cv(row.getCell(10).value)).trim() });
  }
  console.log(`FingerPrint spine: ${spine.size}`);

  // 2. system login/logout combine
  const sys = new Map();
  const addSys = (no, iso, li, lo, src) => { if (!no || !iso) return; const k = `${no}|${iso}`; let s = sys.get(k);
    if (!s) { s = { li, lo, src: new Set([src]) }; sys.set(k, s); return; }
    if (li && (!s.li || li < s.li)) s.li = li; if (lo && (!s.lo || lo > s.lo)) s.lo = lo; s.src.add(src); };
  wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(DIR, 'LoginandLogout Sprinkler SM AND CHAT.xlsx'));
  ws = wb.getWorksheet('Login and Logout');
  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r); const key = String(cv(row.getCell(1).value)).trim();
    const li = sprkLocal(row.getCell(2).value), lo = sprkLocal(row.getCell(3).value); if (!li) continue;
    const iso = isoDate(li); if (iso < FROM || iso > TO) continue;
    const no = sprkIdToNo.get(key) || loginToNo.get(key.split('@')[0]); if (!no) continue;
    addSys(no, iso, li, lo, 'Sprinklr');
  }
  let C = {};
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path.join(DIR, 'AGENT_Session_Details System login loout and Status AUX Ameyo.xlsx'), {});
  for await (const sh2 of reader) { let r = 0;
    for await (const row of sh2) { r++;
      if (r === 1) { const h = row.values.map(x => String(cv(x)).trim()); C = { user: h.indexOf('User ID'), login: h.indexOf('Login Time'), logout: h.indexOf('Logout Time') }; continue; }
      const li = ameyoLocal(typeof row.values[C.login]==='number'?row.values[C.login]:null); if (!li) continue;
      const iso = isoDate(li); if (iso < FROM || iso > TO) continue;
      const no = loginToNo.get(String(cv(row.values[C.user])).trim().toLowerCase()); if (!no) continue;
      addSys(no, iso, li, ameyoLocal(typeof row.values[C.logout]==='number'?row.values[C.logout]:null), 'Ameyo');
    }
    break;
  }
  console.log(`system combined keys: ${sys.size}`);

  // 3. Odoo annotations
  const annot = async (file, kind) => {
    const m = new Map(); const w = new ExcelJS.Workbook(); await w.xlsx.readFile(path.join(DIR, file));
    const s = w.worksheets[0]; const H = s.getRow(1).values.map(x => String(cv(x)).trim());
    const cEmp = H.indexOf('Employee'), cType = H.indexOf('Permission Type')>=0?H.indexOf('Permission Type'):H.indexOf('Type'),
      cDate = H.indexOf('Date'), cFrom = H.indexOf('Time From'), cTo = H.indexOf('Time To'),
      cDFrom = H.indexOf('Date From'), cDTo = H.indexOf('Date To');
    for (let r = 2; r <= s.rowCount; r++) { const row = s.getRow(r); const no = bracketNo(cv(row.getCell(cEmp).value)); if (!no) continue;
      if (kind === 'sick') { const df = cv(row.getCell(cDFrom).value), dt = cv(row.getCell(cDTo).value);
        if (df instanceof Date) { let d = new Date(df), end = (dt instanceof Date)?new Date(dt):new Date(df);
          for (; d<=end; d.setUTCDate(d.getUTCDate()+1)) { const iso=d.toISOString().slice(0,10); if(iso>=FROM&&iso<=TO) m.set(`${no}|${iso}`, 'Sick'); } }
      } else { const d = cv(row.getCell(cDate).value); if (!(d instanceof Date)) continue; const iso = d.toISOString().slice(0,10); if (iso<FROM||iso>TO) continue;
        const t = cType>=1?str(cv(row.getCell(cType).value)):kind; const tf = str(cv(row.getCell(cFrom).value)), tt = str(cv(row.getCell(cTo).value));
        const label = `${t}${tf?` ${tf}-${tt}`:''}`; m.set(`${no}|${iso}`, (m.get(`${no}|${iso}`)?m.get(`${no}|${iso}`)+'; ':'')+label); } }
    return m;
  };
  const perms = await annot('Attendance Permissions ODOO.xlsx', 'perm');
  const comps = await annot('Compensatory Off (comp.off) ODOO.xlsx', 'comp');
  const sicks = await annot('Sick Leaves ODOO.xlsx', 'sick');
  console.log(`annotations: perm ${perms.size}, comp ${comps.size}, sick ${sicks.size}`);

  // 4. presence + conforming
  const presenceOf = (sp, hasLogin) => {
    const s = (sp.status||'').toLowerCase();
    if (sp.punchIn != null) return 'office';
    if (hasLogin) return 'wfh';
    if (/wfh/.test(s)) return 'wfh';
    if (/off\s*day|^off/.test(s)) return 'off';
    if (/absence|absent/.test(s)) return 'absent';
    if (/annual|leave|sick|death|comp|holiday|hijri|eid|national|new year|prophet|isra|arafat|ramadan|day off/.test(s)) return 'leave';
    return 'absent';
  };

  // 5. build + write
  await c.query('BEGIN');
  await c.query(`DELETE FROM roster_days WHERE tenant_id=$1`, [tid]);
  const rows = [];
  for (const [k, sp] of spine) {
    const s = sys.get(k); const e = empByNo.get(sp.no) || {};
    const perm = perms.get(k) || null, comp = comps.get(k) || null, sick = sicks.get(k) || null;
    const presence = presenceOf(sp, !!s);
    const worked = presence === 'office' || presence === 'wfh';
    const authorized = !!perm || !!comp;
    const conforming = worked ? ((sp.late === 0 || authorized) && (sp.early === 0 || authorized)) : null;
    rows.push([tid, sp.no, e.name||null, e.fn||null, sp.iso, sp.day||null, sp.status||null, presence,
      sp.punchIn, sp.punchOut, s?.li!=null?minOf(s.li):null, s?.lo!=null?minOf(s.lo):null, s?[...s.src].join('+'):null,
      sp.late||0, sp.early||0, sp.ot||0, perm, comp, sick, conforming]);
  }
  const COLS = 20;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const ph = chunk.map((_, j) => `(${Array.from({length:COLS},(_,k)=>`$${j*COLS+k+1}`).join(',')})`).join(',');
    await c.query(`INSERT INTO roster_days (tenant_id,employee_no,name,function_name,work_date,day_name,status,presence,punch_in_min,punch_out_min,sys_login_min,sys_logout_min,login_src,late_min,early_min,ot_min,permission,comp_off,sick,conforming) VALUES ${ph}`, chunk.flat());
  }
  await c.query('COMMIT');

  // ── 6. adherence enrichment: scheduled shift + system late/early + conformance % ──
  await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', '054_roster_days_adherence.sql'), 'utf8'));
  // pull scheduled shift times (time-of-day → minutes; +1440 when crossing midnight)
  await c.query(`
    UPDATE roster_days r SET
      shift_code = sc.code,
      shift_start_min = (EXTRACT(HOUR FROM ar.scheduled_start)*60 + EXTRACT(MINUTE FROM ar.scheduled_start))::int,
      shift_end_min = CASE WHEN ar.scheduled_end <= ar.scheduled_start
                           THEN (EXTRACT(HOUR FROM ar.scheduled_end)*60 + EXTRACT(MINUTE FROM ar.scheduled_end))::int + 1440
                           ELSE (EXTRACT(HOUR FROM ar.scheduled_end)*60 + EXTRACT(MINUTE FROM ar.scheduled_end))::int END
    FROM attendance_records ar
    JOIN employees e ON e.id = ar.employee_id
    LEFT JOIN shift_codes sc ON sc.id = ar.scheduled_shift_code_id
    WHERE ar.tenant_id = r.tenant_id AND e.employee_no = r.employee_no
      AND ar.attendance_date = r.work_date AND ar.scheduled_start IS NOT NULL`, []);
  // system late / early-out vs shift + adherence % (prefer system times, fall back to punch)
  await c.query(`
    UPDATE roster_days SET
      sys_late_min = GREATEST(0, COALESCE(sys_login_min, punch_in_min) - shift_start_min),
      sys_early_min = GREATEST(0, shift_end_min - (
        COALESCE(sys_logout_min + CASE WHEN sys_logout_min < sys_login_min THEN 1440 ELSE 0 END,
                 punch_out_min  + CASE WHEN punch_out_min < punch_in_min THEN 1440 ELSE 0 END))),
      mismatch = CASE
        WHEN sys_login_min IS NULL AND punch_in_min IS NOT NULL THEN 'no-system'
        WHEN punch_in_min IS NULL AND sys_login_min IS NOT NULL THEN 'no-punch'
        WHEN sys_login_min IS NOT NULL AND punch_in_min IS NOT NULL AND ABS(sys_login_min - punch_in_min) > 30 THEN 'punch<>system'
        ELSE NULL END
    WHERE shift_start_min IS NOT NULL AND presence IN ('office','wfh','present')
      AND COALESCE(sys_login_min, punch_in_min) IS NOT NULL`, []);
  await c.query(`
    UPDATE roster_days SET
      adherence_pct = GREATEST(0, ROUND(100.0 * ((shift_end_min - shift_start_min) - LEAST(shift_end_min - shift_start_min, sys_late_min + sys_early_min)) / NULLIF(shift_end_min - shift_start_min, 0), 1))
    WHERE shift_start_min IS NOT NULL AND shift_end_min > shift_start_min AND presence IN ('office','wfh','present')`, []);
  const adh = (await c.query(`SELECT ROUND(AVG(adherence_pct),1) a, COUNT(*) FILTER (WHERE sys_late_min>0) lt, COUNT(*) FILTER (WHERE sys_early_min>0) er, COUNT(*) FILTER (WHERE mismatch IS NOT NULL) mm FROM roster_days WHERE tenant_id=$1 AND adherence_pct IS NOT NULL`, [tid])).rows[0];
  console.log(`adherence: avg ${adh.a}% | sys-late days ${adh.lt} | early-logout days ${adh.er} | mismatches ${adh.mm}`);

  const sum = (await c.query(`SELECT presence, COUNT(*) n FROM roster_days WHERE tenant_id=$1 GROUP BY presence ORDER BY n DESC`, [tid])).rows;
  const withLogin = (await c.query(`SELECT COUNT(*) n FROM roster_days WHERE tenant_id=$1 AND sys_login_min IS NOT NULL`, [tid])).rows[0].n;
  const withPunch = (await c.query(`SELECT COUNT(*) n FROM roster_days WHERE tenant_id=$1 AND punch_in_min IS NOT NULL`, [tid])).rows[0].n;
  console.log(`\nroster_days: ${rows.length} | with punch: ${withPunch} | with system login: ${withLogin}`);
  console.table(sum);
  await c.end();
})().catch(e => { console.error('ERR', e.message, e.stack); process.exit(1); });
