/**
 * ============================================================================
 *  recon-emit-odoo-permissions.js  —  Auto-Ingest wave A2 (emitter)
 * ============================================================================
 *  Reads STAGED Odoo permission / comp-off records (odoo_staging — captured by
 *  the chrome-extension-odoo bridge) and EMITS the exact XLSX shape recon reads
 *  for permissions + comp, so the Director no longer uploads
 *  "Permission & Compo June.xlsx".
 *
 *  OUTPUT = <RECON_SRCDIR>/Permission & Compo June.xlsx with the columns
 *  recon-new-roster.js:169-181 reads BY POSITION:
 *      [0]Employee [1]ID [2]Date [3]Permission Type [4]Time From [5]Time To
 *      [6]Total Hours [7]Status
 *  recon uses  col1=ID(NUMERIC employee_no) · col2=Date(serial) · col3=Type ·
 *  col4=From(clock) · col5=To(clock) · col6=TotalHrs(number) · col7=Status.
 *
 *  recon semantics we must feed correctly:
 *    • col1 ID must be numeric (recon: `if (typeof r[1] !== 'number') continue`).
 *    • Type drives  isComp = /comp off/i  and  covers = /late in|early out|full
 *      day|out\/in/  → we expand Odoo's late/early/full into "Late In Permission"
 *      / "Early Out Permission" / "Full Day" / "Comp Off".
 *    • Status drives  approved = /approved/i  → we write "HR Approved" / "Pending"
 *      / "Refused".
 *    • From/To are read via parseClock ("HH:MM" or "HH:MM AM/PM") → we emit 24h
 *      "HH:MM" strings.
 *
 *  ⚠ CONFIRM-WITH-DIRECTOR: the Odoo permission/comp models + their time fields
 *  (x_from/x_to vs float-hours) are heuristic until a real capture confirms them.
 *  IDEMPOTENT (overwrite). EMPTY-SAFE (header-only + "0 rows awaiting capture").
 * ============================================================================
 */
const XLSX = require('xlsx');
const path = require('path');

const SRCDIR = process.env.RECON_SRCDIR || 'C:/Users/t.bassam/Desktop/new roster/';
const TENANT = process.env.RECON_TENANT || 'a0000000-0000-0000-0000-000000000001';
const OUT_NAME = 'Permission & Compo June.xlsx';
const HEADER = ['Employee', 'ID', 'Date', 'Permission Type', 'Time From', 'Time To', 'Total Hours', 'Status'];

// which staged Odoo models carry permission / comp-off REQUESTS (the "Permission & Compo"
// file is permissions + comp-off ONLY — NOT overtime/extra-hours, NOT balance snapshots).
// Observed staged models: attendance.permissions · comp.off (keep) ·
//   comp.off.total.balance (drop — a balance snapshot) · attendance.extra.hours (drop — OT).
const PERM_MODEL = /permission|comp[._]?off/i;
const PERM_EXCLUDE = /balance|total|extra|overtime/i;
const NON_REQUEST = /^(res\.|ir\.|bus\.|mail\.|web|base|website|crm)/i;

const EXCEL_EPOCH_OFFSET = 25569;
function isoToSerial(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso + 'T00:00:00Z');
  if (isNaN(ms)) return null;
  return Math.round(ms / 86400000) + EXCEL_EPOCH_OFFSET;
}
const m2oLabel = (v) => (Array.isArray(v) ? v[1] : (typeof v === 'string' ? v : null));
function personNoFrom(label) { const m = String(label || '').match(/\[\s*(\d{3,7})\s*\]/); return m ? m[1] : null; }
const num = (v) => (typeof v === 'number' ? v : (v != null && v !== '' && !isNaN(+v) ? +v : null));
const pickF = (d, keys) => { for (const k of keys) if (d && d[k] != null && d[k] !== '') return d[k]; return null; };

/** Odoo time field → "HH:MM" 24h. Accepts float-hours (15.5), "15:00", "03:00 PM". */
function toClock(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { // float hours
    let h = Math.floor(v); const m = Math.round((v - h) * 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  const s = String(v).trim();
  // datetime → take the clock part
  const dt = s.match(/[ T](\d{1,2}):(\d{2})/);
  if (dt) return String(+dt[1]).padStart(2, '0') + ':' + dt[2];
  const c = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (c) {
    let h = +c[1]; const m = +c[2]; const ap = c[3] && c[3].toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  return null;
}
function normStatus(raw, state) {
  const s = String(raw != null ? raw : state || '').toLowerCase();
  if (/refuse|reject|cancel|decline/.test(s)) return 'Refused';
  if (/draft|confirm|submit|waiting|pending|to.?approv|first|second|resumption/.test(s)) return 'Pending';
  if (/approv|validate|valid|done|accept/.test(s)) return 'HR Approved';
  return raw ? String(raw) : 'Pending';
}
/** Expand Odoo permission_type/model into recon-recognizable Type text. */
function typeText(model, permType) {
  const m = String(model || '').toLowerCase();
  const p = String(permType || '').toLowerCase();
  if (/comp/.test(m) || /comp/.test(p)) return 'Comp Off';
  if (/late/.test(p)) return 'Late In Permission';
  if (/early/.test(p)) return 'Early Out Permission';
  if (/full/.test(p)) return 'Full Day';
  if (/both|out.?in/.test(p)) return 'Out/In Permission';
  return permType ? String(permType) : 'Permission';
}

/**
 * Pure builder: staged permission/comp rows → AOA.
 * @param {Array<{model:string, data:any}>} stagingRows
 * @returns {{ aoa:any[][], count:number, skipped:number }}
 */
function buildOdooPermissions(stagingRows) {
  const aoa = [HEADER.slice()];
  let count = 0, skipped = 0;
  for (const sr of stagingRows || []) {
    const model = String(sr.model || '');
    const d = sr.data || {};
    if (NON_REQUEST.test(model) || !PERM_MODEL.test(model) || PERM_EXCLUDE.test(model)) { skipped++; continue; }
    const empLabel = m2oLabel(d.employee_id || d.x_employee_id || d.employee);
    const pno = personNoFrom(empLabel) || personNoFrom(pickF(d, ['x_employee', 'employee_name']));
    const name = (empLabel ? String(empLabel).replace(/^\[\s*\d+\s*\]\s*/, '').trim() : pickF(d, ['x_employee', 'employee_name'])) || null;
    let date = pickF(d, ['date_from', 'request_date_from', 'x_date_from', 'x_date', 'date', 'start_date', 'request_date']);
    if (date) date = String(date).slice(0, 10);
    if (!pno || !date) { skipped++; continue; }
    const permType = pickF(d, ['permission_type', 'type']);
    const from = toClock(pickF(d, ['x_from', 'time_from', 'x_time_from', 'from']));
    const to = toClock(pickF(d, ['x_to', 'time_to', 'x_time_to', 'to']));
    const hours = num(pickF(d, ['hours', 'x_hours', 'duration_hours', 'number_of_hours', 'x_total_hours', 'total_hours']));
    const status = normStatus(pickF(d, ['x_status', 'status', 'state_label']), d.state);
    aoa.push([
      name,                        // [0] Employee (recon ignores)
      Number(pno),                 // [1] ID (numeric employee_no — recon requires typeof number)
      isoToSerial(date),           // [2] Date (serial)
      typeText(model, permType),   // [3] Permission Type
      from,                        // [4] Time From ("HH:MM")
      to,                          // [5] Time To
      hours,                       // [6] Total Hours (number)
      status,                      // [7] Status ("HR Approved" / "Pending" / "Refused")
    ]);
    count++;
  }
  return { aoa, count, skipped };
}

function writeAoa(outPath, aoa) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, 'Permissions');
  XLSX.writeFile(wb, outPath);
}

module.exports = { buildOdooPermissions, toClock, normStatus, typeText, personNoFrom, isoToSerial, HEADER, writeAoa };

if (require.main === module) {
  (async () => {
    const outPath = path.join(SRCDIR, OUT_NAME);
    const { getClient } = require('./recon-db');
    const c = getClient();
    await c.connect();
    try {
      const staged = await c.query(`SELECT model, data FROM odoo_staging WHERE tenant_id=$1`, [TENANT])
        .catch(() => ({ rows: [] }));
      const built = buildOdooPermissions(staged.rows);
      writeAoa(outPath, built.aoa);
      if (built.count === 0) {
        console.log('[recon-emit-odoo-permissions] 0 rows awaiting capture — wrote header-only ' + OUT_NAME);
      } else {
        console.log('[recon-emit-odoo-permissions] wrote ' + built.count + ' permission/comp row(s) (skipped ' +
          built.skipped + ') → ' + outPath);
      }
    } finally {
      await c.end();
    }
  })().catch((e) => { console.error('[recon-emit-odoo-permissions] ERR ' + e.message); process.exit(1); });
}
