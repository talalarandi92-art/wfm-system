#!/usr/bin/env node
/*
 * Roster reconciliation for 1–20 June 2026 — combines every source per employee
 * per day, exactly how the manual roster is built:
 *   • Punch In/Out + Late/Early/OT/Status  ← Odoo FingerPrint (local Kuwait time)
 *   • System Login/Logout = COMBINE Ameyo + Sprinklr (earliest login, latest
 *     logout across BOTH systems; UTC→Kuwait +3)
 *   • Permission / Comp-Off / Sick          ← Odoo exports (by [employee_no])
 * Writes an Excel to the Desktop and prints a sample employee for validation.
 *
 * Usage: node scripts/roster-reconcile-june.js [employee_no_to_print]
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
const FROM = '2026-06-01', TO = '2026-06-20';
const KW = 3 * 3600 * 1000;            // Kuwait offset (UTC+3)
const cv = x => { if (x == null) return ''; if (x instanceof Date) return x; if (typeof x === 'object') return x.text != null ? x.text : (x.result != null ? x.result : ''); return x; };
const str = x => { const v = cv(x); return v instanceof Date ? v.toISOString() : String(v); };
const hm = (d) => d ? `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}` : '';
// FingerPrint time cell (local, anchored 1899) → HH:MM local
const fpTime = x => (x instanceof Date) ? hm(x) : '';
// Sprinklr Date — already Kuwait LOCAL (verified: punch-in 08:54 ≈ Sprinklr login 08:56)
const sprkLocal = x => (x instanceof Date) ? new Date(x.getTime()) : null;
// Ameyo serial → Kuwait local Date. Ameyo session export is already LOCAL
// (verified: voice agent punch 07:04 ≈ Ameyo login 07:06), same as Sprinklr.
const AMEYO_KW = 0;
const ameyoLocal = n => { if (typeof n !== 'number' || !(n > 20000 && n < 80000)) return null; return new Date(Date.UTC(1899,11,30) + n*86400000 + AMEYO_KW); };
const isoDate = d => d ? d.toISOString().slice(0,10) : null;
const bracketNo = s => { const m = String(s||'').match(/\[\s*(\d{3,6})\s*\]/); return m ? m[1] : null; };

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const tid = (await c.query(`SELECT id FROM tenants LIMIT 1`)).rows[0].id;
  const emps = (await c.query(`SELECT e.employee_no, TRIM(e.first_name_en||' '||COALESCE(e.last_name_en,'')) name, f.name fn FROM employees e LEFT JOIN functions f ON f.id=e.function_id`)).rows;
  const empByNo = new Map(emps.map(e => [String(e.employee_no), e]));
  // sprinklr_agent_map → login(email-local) & sprinklr id → employee_no
  const sm = (await c.query(`SELECT m.sprinklr_agent_id, lower(m.agent_email) email, e.employee_no FROM sprinklr_agent_map m JOIN employees e ON e.id=m.employee_id WHERE m.employee_id IS NOT NULL`)).rows;
  const loginToNo = new Map(), sprkIdToNo = new Map();
  for (const r of sm) { if (r.email) loginToNo.set(r.email.split('@')[0], String(r.employee_no)); if (r.sprinklr_agent_id) sprkIdToNo.set(String(r.sprinklr_agent_id), String(r.employee_no)); }
  await c.end();

  // ── 1. FingerPrint spine (employee_no|date → punch/status) ──
  const spine = new Map();
  let wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(DIR, 'Odoo FingerPrint in and out details.xlsx'));
  let ws = wb.worksheets[0];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r); const d = row.getCell(2).value;
    if (!(d instanceof Date)) continue; const iso = d.toISOString().slice(0,10);
    if (iso < FROM || iso > TO) continue;
    const no = String(cv(row.getCell(1).value)).replace(/\D/g,''); if (!no) continue;
    spine.set(`${no}|${iso}`, {
      no, iso, day: cv(row.getCell(3).value),
      punchIn: fpTime(row.getCell(4).value), punchOut: fpTime(row.getCell(5).value),
      lateIn: str(cv(row.getCell(7).value)), earlyOut: str(cv(row.getCell(8).value)),
      ot: str(cv(row.getCell(9).value)), status: str(cv(row.getCell(10).value)),
    });
  }
  console.log(`FingerPrint spine rows (Jun1-20): ${spine.size}`);

  // ── 2. System login/logout: combine Ameyo + Sprinklr ──
  const PICK = process.argv[2] || '';
  const dbg = [];        // raw sessions for the picked employee
  const sys = new Map(); // no|iso → {login:Date, logout:Date, src:Set}
  const addSys = (no, iso, login, logout, src) => {
    if (!no || !iso) return; const k = `${no}|${iso}`; let s = sys.get(k);
    if (!s) { s = { login, logout, src: new Set([src]) }; sys.set(k, s); return; }
    if (login && (!s.login || login < s.login)) s.login = login;
    if (logout && (!s.logout || logout > s.logout)) s.logout = logout;
    s.src.add(src);
  };
  // Sprinklr
  wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(DIR, 'LoginandLogout Sprinkler SM AND CHAT.xlsx'));
  ws = wb.getWorksheet('Login and Logout');
  let sprkRows = 0;
  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r); const key = String(cv(row.getCell(1).value)).trim();
    const li = sprkLocal(row.getCell(2).value), lo = sprkLocal(row.getCell(3).value);
    if (!li) continue; const iso = isoDate(li); if (iso < FROM || iso > TO) continue;
    const no = sprkIdToNo.get(key) || loginToNo.get(key.split('@')[0]); if (!no) continue;
    if (no === PICK) dbg.push({ sys:'Sprinklr', iso, rawIn: str(row.getCell(2).value).slice(11,16), rawOut: str(row.getCell(3).value).slice(11,16), locIn: hm(li), locOut: hm(lo) });
    addSys(no, iso, li, lo, 'Sprinklr'); sprkRows++;
  }
  // Ameyo session (stream — file capped ~1.05M rows)
  let amRows = 0, C = {};
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path.join(DIR, 'AGENT_Session_Details System login loout and Status AUX Ameyo.xlsx'), {});
  for await (const sh of reader) {
    let r = 0;
    for await (const row of sh) {
      r++; if (r === 1) { const h = row.values.map(x => String(cv(x)).trim()); C = { user: h.indexOf('User ID'), login: h.indexOf('Login Time'), logout: h.indexOf('Logout Time') }; continue; }
      const login = ameyoLocal(typeof row.values[C.login]==='number'?row.values[C.login]:null);
      if (!login) continue; const iso = isoDate(login); if (iso < FROM || iso > TO) continue;
      const no = loginToNo.get(String(cv(row.values[C.user])).trim().toLowerCase()); if (!no) continue;
      const logout = ameyoLocal(typeof row.values[C.logout]==='number'?row.values[C.logout]:null);
      if (no === PICK) { const rawL = ameyoLocal(typeof row.values[C.login]==='number'?row.values[C.login]:null); const rawU = new Date(rawL.getTime()-AMEYO_KW);
        dbg.push({ sys:'Ameyo', iso, rawIn: hm(rawU), rawOut: hm(logout?new Date(logout.getTime()-AMEYO_KW):null), locIn: hm(login), locOut: hm(logout) }); }
      addSys(no, iso, login, logout, 'Ameyo'); amRows++;
    }
    break;
  }
  console.log(`system sessions matched — Sprinklr: ${sprkRows}, Ameyo: ${amRows}, combined keys: ${sys.size}`);

  // ── 3. Odoo permissions / comp-off / sick (by [employee_no] + date) ──
  const annot = (file, sheet, kind) => {
    const m = new Map();
    const w = new ExcelJS.Workbook();
    return w.xlsx.readFile(path.join(DIR, file)).then(() => {
      const s = w.getWorksheet(sheet) || w.worksheets[0];
      const H = s.getRow(1).values.map(x => String(cv(x)).trim());
      const cEmp = H.indexOf('Employee'), cType = H.indexOf('Permission Type')>=0?H.indexOf('Permission Type'):H.indexOf('Type');
      const cDate = H.indexOf('Date'), cFrom = H.indexOf('Time From'), cTo = H.indexOf('Time To');
      const cDFrom = H.indexOf('Date From'), cDTo = H.indexOf('Date To');
      for (let r = 2; r <= s.rowCount; r++) {
        const row = s.getRow(r); const no = bracketNo(cv(row.getCell(cEmp).value)); if (!no) continue;
        const type = cType>=1 ? str(cv(row.getCell(cType).value)) : kind;
        if (kind === 'sick') {
          const df = cv(row.getCell(cDFrom).value), dt = cv(row.getCell(cDTo).value);
          if (df instanceof Date) { let d=new Date(df), end=(dt instanceof Date)?new Date(dt):new Date(df);
            for (; d<=end; d.setUTCDate(d.getUTCDate()+1)) { const iso=d.toISOString().slice(0,10); if(iso>=FROM&&iso<=TO) m.set(`${no}|${iso}`, 'Sick'); } }
        } else {
          const d = cv(row.getCell(cDate).value); if (!(d instanceof Date)) continue; const iso = d.toISOString().slice(0,10); if (iso<FROM||iso>TO) continue;
          const tf = str(cv(row.getCell(cFrom).value)), tt = str(cv(row.getCell(cTo).value));
          const label = `${type}${tf?` ${tf}-${tt}`:''}`;
          m.set(`${no}|${iso}`, (m.get(`${no}|${iso}`)? m.get(`${no}|${iso}`)+'; ':'')+label);
        }
      }
      return m;
    });
  };
  const perms = await annot('Attendance Permissions ODOO.xlsx', 'Sheet1', 'perm');
  const comps = await annot('Compensatory Off (comp.off) ODOO.xlsx', 'Sheet1', 'comp');
  const sicks = await annot('Sick Leaves ODOO.xlsx', 'Sheet1', 'sick');
  console.log(`annotations — permissions: ${perms.size}, comp-off: ${comps.size}, sick: ${sicks.size}`);

  // ── 4. Build roster rows ──
  const rows = [];
  for (const [k, sp] of spine) {
    const s = sys.get(k); const e = empByNo.get(sp.no) || {};
    rows.push({
      no: sp.no, name: e.name || '', fn: e.fn || '', date: sp.iso, day: sp.day, status: sp.status,
      punchIn: sp.punchIn, punchOut: sp.punchOut,
      sysLogin: s?.login ? hm(s.login) : '', sysLogout: s?.logout ? hm(s.logout) : '',
      src: s ? [...s.src].join('+') : '',
      permission: perms.get(k) || '', compOff: comps.get(k) || '', sick: sicks.get(k) || '',
      lateIn: sp.lateIn, earlyOut: sp.earlyOut, ot: sp.ot,
    });
  }
  rows.sort((a,b) => a.no.localeCompare(b.no) || a.date.localeCompare(b.date));

  // ── 5. Excel ──
  const out = new ExcelJS.Workbook(); const sh = out.addWorksheet('Roster 1-20 Jun 2026');
  sh.columns = [
    { header:'Emp No', key:'no', width:9 }, { header:'Name', key:'name', width:24 }, { header:'Function', key:'fn', width:18 },
    { header:'Date', key:'date', width:12 }, { header:'Day', key:'day', width:6 }, { header:'Status', key:'status', width:12 },
    { header:'Punch In', key:'punchIn', width:9 }, { header:'Punch Out', key:'punchOut', width:9 },
    { header:'Sys Login', key:'sysLogin', width:9 }, { header:'Sys Logout', key:'sysLogout', width:10 }, { header:'Login Src', key:'src', width:12 },
    { header:'Permission', key:'permission', width:26 }, { header:'Comp Off', key:'compOff', width:22 }, { header:'Sick', key:'sick', width:7 },
    { header:'Late In', key:'lateIn', width:8 }, { header:'Early Out', key:'earlyOut', width:9 }, { header:'OT', key:'ot', width:7 },
  ];
  sh.getRow(1).font = { bold:true, color:{argb:'FFFFFFFF'} };
  sh.getRow(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF4F46E5'} };
  sh.views = [{ state:'frozen', ySplit:1 }]; sh.autoFilter = { from:'A1', to:'Q1' };
  rows.forEach(r => sh.addRow(r));
  const outPath = 'C:/Users/t.bassam/Desktop/Roster_1-20_June_2026.xlsx';
  await out.xlsx.writeFile(outPath);
  console.log(`\n✓ Excel written: ${outPath}  (${rows.length} rows)`);

  // ── 6. Sample print for validation ──
  if (dbg.length) {
    console.log(`\n=== RAW sessions for [${PICK}] (validate TZ) ===`);
    dbg.sort((a,b)=>a.iso.localeCompare(b.iso)).forEach(s => console.log(`  ${s.iso} ${s.sys.padEnd(9)} raw ${(s.rawIn||'--')}-${(s.rawOut||'--')}  local ${s.locIn}-${s.locOut}`));
  }
  const pick = PICK || rows.find(r => r.punchIn && r.sysLogin)?.no;
  const sample = rows.filter(r => r.no === String(pick));
  if (sample.length) {
    console.log(`\n=== Sample roster — ${sample[0].name} [${pick}] · ${sample[0].fn} ===`);
    console.log('Date        Day  Status        PunchIn PunchOut  Login  Logout  Src        Permission/Comp/Sick');
    for (const r of sample) console.log(
      `${r.date}  ${(r.day||'').padEnd(4)} ${(r.status||'').padEnd(12)} ${(r.punchIn||'--').padEnd(7)} ${(r.punchOut||'--').padEnd(8)} ${(r.sysLogin||'--').padEnd(6)} ${(r.sysLogout||'--').padEnd(6)} ${(r.src||'--').padEnd(10)} ${[r.permission,r.compOff&&'COMP:'+r.compOff,r.sick].filter(Boolean).join(' | ')}`);
  }
})().catch(e => { console.error('ERR', e.message, e.stack); process.exit(1); });
