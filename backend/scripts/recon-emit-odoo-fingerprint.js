/**
 * ============================================================================
 *  recon-emit-odoo-fingerprint.js  —  Auto-Ingest wave A2 (emitter)
 * ============================================================================
 *  Reads STAGED Odoo hr.attendance records (odoo_staging, model='hr.attendance'
 *  — captured live by the chrome-extension-odoo bridge riding the supervisor's
 *  Odoo web session) and EMITS the exact XLSX shape recon reads for biometric
 *  punches, so the Director no longer uploads "Odoo Fingerprint June.xlsx".
 *
 *  OUTPUT = <RECON_SRCDIR>/Odoo Fingerprint June.xlsx with the columns
 *  recon-new-roster.js:155-163 reads BY POSITION:
 *      [0]Code [1]Date [2]Day [3]In [4]Out [5]Total [6]Late In [7]Early Out [8]OT [9]Status
 *  recon uses  col0=Code(numeric employee_no) · col1=Date(serial) · col3=In(day
 *  fraction) · col4=Out(day fraction) · col9=Status.  Person key = employee_no.
 *
 *  hr.attendance field mapping (confirmed generic Odoo shape):
 *      employee_id = [id, "[ 13311 ] NAME"]  → employee_no via the "[ nnnn ]" tag
 *      check_in / check_out = "YYYY-MM-DD HH:mm:ss" (Odoo stores these in UTC)
 *  ⚠ CONFIRM-WITH-DIRECTOR: Odoo persists attendance in UTC; the manual
 *  fingerprint file carried LOCAL (Kuwait, UTC+3) wall-clock times. We add
 *  ODOO_TZ_OFFSET_MIN (default 180) so emitted times match the local file.
 *  Confirm the biometric model is hr.attendance (vs a Studio x_ model) and the
 *  stored TZ on the Director's live session, then adjust the offset if needed.
 *
 *  IDEMPOTENT (overwrite). EMPTY-SAFE (header-only + "0 rows awaiting capture").
 * ============================================================================
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const SRCDIR = process.env.RECON_SRCDIR || 'C:/Users/t.bassam/Desktop/new roster/';
const TENANT = process.env.RECON_TENANT || 'a0000000-0000-0000-0000-000000000001';
const OUT_NAME = 'Odoo Fingerprint June.xlsx';
const TZ_OFFSET_MIN = Number(process.env.ODOO_TZ_OFFSET_MIN != null ? process.env.ODOO_TZ_OFFSET_MIN : 180);
const HEADER = ['Code', 'Date', 'Day', 'In', 'Out', 'Total', 'Late In', 'Early Out', 'OT', 'Status'];

const EXCEL_EPOCH_OFFSET = 25569;
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function isoToSerial(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso + 'T00:00:00Z');
  if (isNaN(ms)) return null;
  return Math.round(ms / 86400000) + EXCEL_EPOCH_OFFSET;
}
const dayName = (iso) => DOW[new Date(iso + 'T00:00:00Z').getUTCDay()];
const minToFrac = (min) => (min == null ? null : min / 1440);

// Odoo many2one = [id, "label"]; employee display label carries employee_no as "[ 13311 ] NAME"
const m2oLabel = (v) => (Array.isArray(v) ? v[1] : (typeof v === 'string' ? v : null));
function personNoFrom(label) { const m = String(label || '').match(/\[\s*(\d{3,7})\s*\]/); return m ? m[1] : null; }

/** Parse an Odoo UTC datetime string → {date, min} shifted to local by tzOffsetMin. */
function odooDatetimeToLocal(v, tzOffsetMin) {
  if (v == null) return null;
  const s = String(v).trim().replace(' ', 'T');
  const ms = Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z'); // treat naive as UTC
  if (isNaN(ms)) return null;
  const t = new Date(ms + (tzOffsetMin || 0) * 60000);
  return { date: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

/**
 * Pure builder: staged hr.attendance rows → AOA.
 * @param {Array<{data:any}>} stagingRows  each = one odoo_staging row (model='hr.attendance')
 * @param {number} [tzOffsetMin=180]
 * @returns {{ aoa:any[][], count:number, skipped:number }}
 */
function buildOdooFingerprint(stagingRows, tzOffsetMin) {
  const off = tzOffsetMin != null ? tzOffsetMin : TZ_OFFSET_MIN;
  const aoa = [HEADER.slice()];
  let count = 0, skipped = 0;
  for (const sr of stagingRows || []) {
    const d = sr && sr.data ? sr.data : sr;
    if (!d) { skipped++; continue; }
    const pno = personNoFrom(m2oLabel(d.employee_id || d.x_employee_id || d.employee));
    const cin = odooDatetimeToLocal(d.check_in, off);
    if (!pno || !cin) { skipped++; continue; }
    const cout = odooDatetimeToLocal(d.check_out, off);
    const total = typeof d.worked_hours === 'number' ? +d.worked_hours.toFixed(2) : null;
    aoa.push([
      Number(pno),                       // Code (numeric employee_no — recon requires typeof number)
      isoToSerial(cin.date),             // Date (serial)
      dayName(cin.date),                 // Day
      minToFrac(cin.min),                // In (day fraction)
      cout ? minToFrac(cout.min) : null, // Out (day fraction; may be < In for overnight)
      total,                             // Total (worked hours) — recon ignores, kept for parity
      null, null, null,                  // Late In / Early Out / OT — recon derives its own
      null,                              // Status (hr.attendance has none; WFH detection stays roster/location-driven)
    ]);
    count++;
  }
  return { aoa, count, skipped };
}

function writeAoa(outPath, aoa) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, 'Fingerprint');
  XLSX.writeFile(wb, outPath);
}

module.exports = { buildOdooFingerprint, odooDatetimeToLocal, personNoFrom, isoToSerial, HEADER, writeAoa };

if (require.main === module) {
  (async () => {
    const outPath = path.join(SRCDIR, OUT_NAME);
    const { getClient } = require('./recon-db');
    const c = getClient();
    await c.connect();
    try {
      const staged = await c.query(
        `SELECT data FROM odoo_staging WHERE tenant_id=$1 AND model='hr.attendance'`, [TENANT])
        .catch(() => ({ rows: [] }));
      const built = buildOdooFingerprint(staged.rows, TZ_OFFSET_MIN);
      if (built.count === 0) {
        // FIX 2(a): staging is empty (no live capture yet) — do NOT overwrite the Director's manual
        // "Odoo Fingerprint June.xlsx" with a header-only file. Leave the existing source untouched.
        console.log('[recon-emit-odoo-fingerprint] 0 rows awaiting capture — SKIPPING write; left existing ' +
          OUT_NAME + ' untouched');
      } else {
        // FIX 2(b): back up the current file before any overwrite, so a bad capture can be undone.
        try {
          if (fs.existsSync(outPath)) { fs.copyFileSync(outPath, outPath + '.bak'); }
        } catch (e) { console.warn('[recon-emit-odoo-fingerprint] pre-overwrite backup skipped: ' + e.message); }
        writeAoa(outPath, built.aoa);
        console.log('[recon-emit-odoo-fingerprint] wrote ' + built.count + ' punch row(s) (skipped ' +
          built.skipped + ') → ' + outPath + '  [tz+' + TZ_OFFSET_MIN + 'm]');
      }
    } finally {
      await c.end();
    }
  })().catch((e) => { console.error('[recon-emit-odoo-fingerprint] ERR ' + e.message); process.exit(1); });
}
