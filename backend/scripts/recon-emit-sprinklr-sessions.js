/**
 * ============================================================================
 *  recon-emit-sprinklr-sessions.js  —  Auto-Ingest wave A1 (emitter)
 * ============================================================================
 *  Reads STAGED Sprinklr login/logout report rows (sprinklr_report_staging,
 *  report_type='login_logout' — captured live by the Sprinklr chrome extension,
 *  A0) and EMITS the exact XLSX shape the recon engine reads for Sprinklr
 *  sessions, so the Director no longer uploads "Login and Logout sprinklr.xlsx"
 *  by hand.
 *
 *  OUTPUT  =  <RECON_SRCDIR>/Login and Logout sprinklr.xlsx  with the columns
 *  recon-new-roster.js:223-242 reads BY HEADER NAME:
 *      ID | Login Date | Login Time | Logout Date | Logout Time
 *  (ID = agent email/username → recon matches via F.byUser then F.byEmail;
 *   Login/Logout Date = Excel date serial; Login/Logout Time = day fraction —
 *   recon converts them with serialToISO / serialTimeMin.)
 *
 *  IDEMPOTENT: overwrites the file each run.
 *  EMPTY-SAFE: staging empty (no live capture yet) → header-only file + a
 *  "0 sessions (awaiting live capture)" log, exit 0.
 *
 *  FALLBACK (--from-status): when staging is empty, derive APPROXIMATE sessions
 *  from agent_status_events (login = first non-offline of the local day,
 *  logout = last ended_at/started_at). Clearly labelled approximate.
 *
 *  This file is a SELF-CONTAINED emitter: the pure normalization is duplicated
 *  from sprinklr-report.parser.ts (kept here so the script has no TS/dist dep).
 *  When the Director confirms the real reportingQuery field mapping, tighten the
 *  duplicated detectors below to match the TS parser.
 *
 *  ENV:  RECON_SRCDIR (out folder, default the recon folder) ·
 *        RECON_TENANT · POSTGRES_* (via recon-db) · SPRINKLR_TZ_OFFSET_MIN.
 * ============================================================================
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const SRCDIR = process.env.RECON_SRCDIR || 'C:/Users/t.bassam/Desktop/new roster/';
const TENANT = process.env.RECON_TENANT || 'a0000000-0000-0000-0000-000000000001';
const OUT_NAME = 'Login and Logout sprinklr.xlsx';
const HEADER = ['ID', 'Login Date', 'Login Time', 'Logout Date', 'Logout Time'];

// ── date/serial helpers (inverse of recon serialToISO / serialTimeMin) ───────
const EXCEL_EPOCH_OFFSET = 25569; // days between 1899-12-30 and 1970-01-01
function isoToSerial(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso + 'T00:00:00Z');
  if (isNaN(ms)) return null;
  return Math.round(ms / 86400000) + EXCEL_EPOCH_OFFSET;
}
const minToFrac = (min) => (min == null ? null : min / 1440);
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// ── pure normalization (duplicated from sprinklr-report.parser.ts) ───────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;
const CLOCK_RE = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*$/i;
const isEmail = (v) => typeof v === 'string' && EMAIL_RE.test(v.trim());
const isDateOnly = (v) => typeof v === 'string' && DATE_ONLY_RE.test(v.trim());
function isTimestampish(v) {
  if (typeof v === 'number') return v > 1e11;
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return DATETIME_RE.test(s) || CLOCK_RE.test(s);
}
function toMinutesOfDay(v) {
  if (v == null) return null;
  if (typeof v === 'number' && v > 1e11) {
    const d = new Date(v);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
  const s = String(v).trim();
  const dt = s.match(DATETIME_RE) ? s.match(/[ T](\d{2}):(\d{2})/) : null;
  if (dt) return (+dt[1]) * 60 + (+dt[2]);
  const c = s.match(CLOCK_RE);
  if (c) {
    let h = +c[1]; const m = +c[2]; const ap = c[4] && c[4].toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }
  return null;
}
function rowValues(item) {
  const vals = [];
  if (Array.isArray(item.expandedKey)) vals.push(...item.expandedKey);
  for (const v of Object.values(item.dims || {})) {
    if (Array.isArray(v)) vals.push(...v); else vals.push(v);
  }
  return vals;
}
/** One staged RawReportItem → {agent_email, day, login_min, logout_min}. */
function parseLoginLogoutRow(it) {
  const vals = rowValues(it);
  const email = vals.find(isEmail) || null;
  let day = vals.find(isDateOnly) || null;
  if (!day) {
    const t = vals.find((v) => typeof v === 'string' && DATETIME_RE.test(v));
    const m = t && String(t).match(/\d{4}-\d{2}-\d{2}/);
    day = m ? m[0] : null;
  }
  const tsVals = vals.filter(isTimestampish);
  const loginRaw = tsVals[0] != null ? tsVals[0] : null;
  const logoutRaw = tsVals.length > 1 ? tsVals[tsVals.length - 1] : null;
  return {
    agent_email: email ? String(email).toLowerCase() : null,
    day: day || null,
    login_min: toMinutesOfDay(loginRaw),
    logout_min: toMinutesOfDay(logoutRaw),
  };
}

// ── pure builder: staging rows → AOA (header + data) ─────────────────────────
/**
 * @param {Array<{agent_email:string|null, day:string|null, payload:any}>} stagingRows
 *   Each = one sprinklr_report_staging row (report_type='login_logout').
 *   payload.rows = RawReportItem[] as captured by the extension.
 * @returns {{ aoa: any[][], count: number }}
 */
function buildSprinklrSessions(stagingRows) {
  const aoa = [HEADER.slice()];
  let count = 0;
  for (const sr of stagingRows || []) {
    const items = (sr.payload && Array.isArray(sr.payload.rows)) ? sr.payload.rows : [];
    for (const it of items) {
      const n = parseLoginLogoutRow(it);
      // fall back to the report-scoped scalars staged on the row itself
      const id = n.agent_email || (sr.agent_email ? String(sr.agent_email).toLowerCase() : null);
      const day = n.day || sr.day || null;
      if (!id || !day || n.login_min == null) continue;   // need who + when + a login
      const loginSerial = isoToSerial(day);
      let logoutDay = day, logoutMin = n.logout_min;
      if (logoutMin != null && logoutMin < n.login_min) logoutDay = addDays(day, 1); // crossed midnight
      aoa.push([
        id,
        loginSerial,
        minToFrac(n.login_min),
        logoutMin != null ? isoToSerial(logoutDay) : null,
        logoutMin != null ? minToFrac(logoutMin) : null,
      ]);
      count++;
    }
  }
  return { aoa, count };
}

/** agent_status_events rows → the SAME AOA shape (APPROXIMATE sessions). */
function buildFromStatusEvents(events, tzOffsetMin) {
  // group by email + local day, login=first non-offline, logout=last close
  const byKey = {};
  const localDayMin = (ts) => {
    const t = new Date(new Date(ts).getTime() + (tzOffsetMin || 0) * 60000);
    return { day: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
  };
  for (const e of events || []) {
    const email = e.email ? String(e.email).toLowerCase() : null;
    if (!email || !e.started_at) continue;
    const isOffline = String(e.status || '').toLowerCase() === 'offline';
    const s = localDayMin(e.started_at);
    const closeTs = e.ended_at || e.started_at;
    const c = localDayMin(closeTs);
    const k = email + '|' + s.day;
    const rec = byKey[k] || (byKey[k] = { email, day: s.day, loginMin: null, logoutMin: null });
    if (!isOffline && (rec.loginMin == null || s.min < rec.loginMin)) rec.loginMin = s.min;
    if (rec.logoutMin == null || c.min > rec.logoutMin) rec.logoutMin = c.min;
  }
  const aoa = [HEADER.slice()];
  let count = 0;
  for (const rec of Object.values(byKey)) {
    if (rec.loginMin == null) continue;
    aoa.push([rec.email, isoToSerial(rec.day), minToFrac(rec.loginMin),
      rec.logoutMin != null ? isoToSerial(rec.day) : null, minToFrac(rec.logoutMin)]);
    count++;
  }
  return { aoa, count };
}

function writeAoa(outPath, aoa) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, 'Sessions');
  XLSX.writeFile(wb, outPath);
}

module.exports = { buildSprinklrSessions, buildFromStatusEvents, parseLoginLogoutRow, isoToSerial, minToFrac, HEADER, writeAoa };

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    const fromStatus = process.argv.includes('--from-status');
    const outPath = path.join(SRCDIR, OUT_NAME);
    const { getClient } = require('./recon-db');
    const c = getClient();
    await c.connect();
    try {
      const staged = await c.query(
        `SELECT agent_email, day::text AS day, payload
           FROM sprinklr_report_staging
          WHERE tenant_id=$1 AND report_type='login_logout'`, [TENANT]).catch(() => ({ rows: [] }));
      let built = buildSprinklrSessions(staged.rows);

      if (built.count === 0 && fromStatus) {
        const tz = Number(process.env.SPRINKLR_TZ_OFFSET_MIN || 0);
        const ev = await c.query(
          `SELECT email, status, started_at, ended_at FROM agent_status_events
             WHERE tenant_id=$1 AND email IS NOT NULL ORDER BY started_at`, [TENANT]).catch(() => ({ rows: [] }));
        built = buildFromStatusEvents(ev.rows, tz);
        console.log('[recon-emit-sprinklr] staging empty → derived ' + built.count +
          ' APPROXIMATE session(s) from agent_status_events (--from-status).');
      }

      if (built.count === 0) {
        // FIX 2(a): staging (and the optional --from-status fallback) yielded nothing — do NOT overwrite
        // the Director's manual "Login and Logout sprinklr.xlsx" with a header-only file. Leave it untouched.
        console.log('[recon-emit-sprinklr] 0 sessions (awaiting live capture) — SKIPPING write; left existing ' +
          OUT_NAME + ' untouched');
      } else {
        // FIX 2(b): back up the current file before any overwrite, so a bad capture can be undone.
        try {
          if (fs.existsSync(outPath)) { fs.copyFileSync(outPath, outPath + '.bak'); }
        } catch (e) { console.warn('[recon-emit-sprinklr] pre-overwrite backup skipped: ' + e.message); }
        writeAoa(outPath, built.aoa);
        console.log('[recon-emit-sprinklr] wrote ' + built.count + ' session row(s) → ' + outPath);
      }
    } finally {
      await c.end();
    }
  })().catch((e) => { console.error('[recon-emit-sprinklr] ERR ' + e.message); process.exit(1); });
}
