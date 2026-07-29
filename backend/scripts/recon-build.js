/**
 * recon-build.js — builds per-employee/day records from the loaded sources,
 * applies the agreed conformance/HR/fairness logic, and writes the 16-sheet workbook.
 * Invoked by recon-new-roster.js.
 */
const XLSX = require('xlsx');
const fs = require('fs');

module.exports = function build() {
  const M = require('./recon-new-roster');
  const { classifyCode, isExcludedRole, F, odoo, perms, ameyoSessions, sprinkSessions, sheetEvidenceDates, pickWindow, sumDaySessions, dayOffset, absToDM, horizon, hhmm, minToHHMMSS, dayName, OUT_XLSX, SCRATCH } = M;

  const REQUIRED_STD_NET = 480, REQUIRED_MOM_NET = 360;
  // Official holidays — EDITABLE in scripts/recon-config.json (anyone who works a scheduled shift on one of
  // these dates gets the WHOLE shift as holiday OT + an "Official Holiday" label). Re-run recon-refresh after editing.
  const HOLIDAY_NAME = new Map([['2026-06-16', 'Hijri New Year']]);
  try {
    const cfg = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'recon-config.json'), 'utf8'));
    if (Array.isArray(cfg.holidays)) { HOLIDAY_NAME.clear(); for (const h of cfg.holidays) { if (typeof h === 'string') HOLIDAY_NAME.set(h, 'Official Holiday'); else if (h && h.date) HOLIDAY_NAME.set(h.date, h.name || 'Official Holiday'); } }
  } catch (e) { /* keep default */ }
  // Comprehensive holiday AUTO-DETECTION from the Odoo Status column (the authority — names EVERY public
  // occasion), date-level: if ANY employee's Odoo status on a date names an official holiday, the WHOLE date
  // is a holiday (so every worker that day is credited, not just whoever's own row happens to say it). Same
  // approach as import-roster-master so June and the rest of the year detect holidays identically.
  const HOLIDAY_RE = /new year|eid|arafat|national day|liberation|isra|mi'?raj|hijri|public holiday|ascension|prophet/i;
  const holidayDates = new Set(HOLIDAY_NAME.keys());
  try { for (const k in odoo) { const od = odoo[k]; if (od && HOLIDAY_RE.test(String(od.status || ''))) holidayDates.add(k.split('|')[1]); } } catch (e) { /* odoo not keyed id|date */ }
  const HR_MIN = 7;            // user rule 2026-06-30: tardiness > 6 min => HR/deduct; <= 6 min tolerated
  const CONFLICT_MIN = 60;     // ameyo vs sprinklr disagreement threshold
  const MAX_HR_DEV = 120;      // late/early-out > 2h => likely swap/incomplete capture => Manual Review (fairness)
  const MIN_PRESENCE = 120;    // captured WFH presence < 2h with no punch => incomplete evidence => Manual Review
  const fmtT = (min) => (min == null ? '' : (min >= 1440 ? hhmm(min - 1440) + ' (+1)' : (min < 0 ? hhmm(min + 1440) + ' (-1)' : hhmm(min))));
  // ── report-column helpers, EXACT copies of the proven import-roster-master ones (so the
  //    corrected ingest stops NULLing the columns the reports read: ot_before/after, week/month,
  //    attendance_status, late_category, missing flags, crosses_midnight, original code). ──
  const weekNum = (iso) => { const d = new Date(iso + 'T00:00:00Z'); const sinceSat = (d.getUTCDay() + 1) % 7; const ws = new Date(d); ws.setUTCDate(d.getUTCDate() - sinceSat); const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); const fws = new Date(jan1); fws.setUTCDate(jan1.getUTCDate() - ((jan1.getUTCDay() + 1) % 7)); return Math.floor((ws - fws) / (7 * 86400000)) + 1; };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const lateCat = (m) => { if (m == null || m <= 0) return 'On time'; if (m <= 5) return 'Late 1-5'; if (m <= 15) return 'Late 6-15'; if (m <= 20) return 'Late 16-20'; if (m <= 29) return 'Late 21-29'; if (m <= 59) return 'Late 30-59'; return 'Late 60+'; };
  const attStatus = (kind, presence, raw) => { const U = String(raw || '').toUpperCase();
    if (U === 'DL') return 'Death Leave'; if (U === 'UPL') return 'Unpaid Leave'; if (/transfer/i.test(U)) return 'Transfer';
    if (kind === 'sick') return 'Sick Leave'; if (kind === 'absence') return 'Absence';
    if (presence === 'holiday' || kind === 'holiday') return 'Holiday'; if (kind === 'leave') return 'Annual Leave';
    if (kind === 'comp' || U === 'COMP') return 'COMP'; if (kind === 'off') return 'OFF'; if (kind === 'sep') return 'Left';
    if (presence === 'office') return 'Present (Office)'; if (presence === 'wfh') return 'WFH';
    if (presence === 'absent') return 'Absence'; return 'Present'; };
  // 12-hour clock display (user preference 2026-06-28): clock times show h:mm AM/PM; DURATIONS stay HH:MM:SS.
  const clock12 = (min) => { if (min == null) return ''; const t = ((min % 1440) + 1440) % 1440; let h = Math.floor(t / 60); const m = t % 60; const ap = h < 12 ? 'AM' : 'PM'; h = h % 12; if (h === 0) h = 12; return h + ':' + String(m).padStart(2, '0') + ' ' + ap; };
  const fmtT12 = (min) => (min == null ? '' : (min >= 1440 ? clock12(min - 1440) + ' (+1)' : (min < 0 ? clock12(min + 1440) + ' (-1)' : clock12(min))));

  // optional period the USER defines (e.g. RECON_FROM=2026-06-01 RECON_TO=2026-06-15); defaults to whole horizon
  const FROM = process.env.RECON_FROM || '0000-00-00';
  const TO = process.env.RECON_TO || horizon;
  // system source mode — June stays 'ameyo-first' (calibrated to the manual). From July (D-076,
  // Director 2026-07-03) the roster is Sprinklr-sourced: set "sysMode" in recon-config.json (or
  // env RECON_SYS_MODE for a one-off run) to 'sprinklr-first' or 'sprinklr-only'. env wins over config.
  let cfgSysMode = null;
  try { cfgSysMode = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'recon-config.json'), 'utf8')).sysMode || null; } catch (e) { /* keep null */ }
  const SYS_MODE = (process.env.RECON_SYS_MODE || cfgSysMode || 'ameyo-first').toLowerCase();
  console.log('system source mode: ' + SYS_MODE + (process.env.RECON_SYS_MODE ? ' (env)' : cfgSysMode ? ' (recon-config.json)' : ' (default)'));

  const records = [];
  const dq = [];               // data quality issues
  const mapAudit = {};         // raw code -> audit row

  for (const e of F.employees) {
    const idn = F.identity[e.id] || { id: e.id, name: e.name, userId: e.username, email: null, manager: null, gender: null, location: e.location, team: e.teamCol };
    const fn = e.function || '';
    const excluded = isExcludedRole(fn, idn.team, e.id);
    const isMother = (e.id === 12375 || e.id === 12434);

    for (const date in e.days) {
      if (date > horizon || date < FROM || date > TO) continue;   // outside horizon or the user-defined period
      const raw = e.days[date];
      const c = classifyCode(raw, e.id);
      // FOUNDATION v2: prefer the user's EXACT scheduled times (from their final Shifts. sheet) over the
      // code-derived times — removes every shift-code/time mismatch (e.g. Shaima B7 09:00-16:00, not B 09:00-18:00).
      const sch = F.schedule && F.schedule[e.id + '|' + date];
      if (sch && (c.kind === 'work' || c.kind === 'wfh') && sch.start != null) {
        let st = sch.start, en = (sch.end2 != null ? sch.end2 : sch.end);
        if (en != null && en <= st) en += 1440;                 // cross-midnight
        if (en != null) { c.start = st; c.end = en; c.gross = en - st; c.net = (en - st) - 60; c.crossMidnight = en > 1440; c.note = (c.note || '') + ' · user-scheduled'; }
      }
      const dayExcluded = excluded || !!c.management; // CCNO = management fixed shift => record-only too
      // mapping audit (one row per distinct raw code)
      if (!mapAudit[raw]) mapAudit[raw] = { raw, normalized: c.norm, origin: c.origin || '', kind: c.kind, start: clock12(c.start), end: fmtT12(c.end), grossH: c.gross == null ? '' : (c.gross / 60).toFixed(2), netH: c.net == null ? '' : (c.net / 60).toFixed(2), mapped: c.mapped ? 'Yes' : 'NO', note: c.note, count: 0 };
      mapAudit[raw].count++;

      const key = e.id + '|' + date;
      const od = odoo[key] || null;
      const pm = perms[key] || [];
      const odStatus = od && od.status ? od.status : '';

      // shift-relative system window (cross-midnight safe). For codes without a schedule, use full-day window.
      const Dabs = dayOffset(date) * 1440;
      const winS = (c.start != null) ? c.start : 0;
      const winE = (c.end != null) ? c.end : 1440;
      const am = pickWindow(ameyoSessions[e.id], Dabs, winS, winE);
      const sp = pickWindow(sprinkSessions[e.id], Dabs, winS, winE);
      const hasPunch = od && od.punchIn != null;
      const amDur = am ? (am.logoutMin - am.loginMin) : 0;
      const spDur = sp ? (sp.logoutMin - sp.loginMin) : 0;
      const sysEvidenceMin = Math.max(amDur, spDur) || null;

      // ---- WFH detection (Option A: authoritative signals only) ----
      const codeWFH = (c.kind === 'wfh');
      const locWFH = /wfh/i.test(idn.location || e.location || '');
      const odooWFH = /wfh|work from home/i.test(odStatus);
      const isWorkingKind = (c.kind === 'work' || c.kind === 'wfh');
      // RESCUE (sign-off 2026-06-28): Odoo marked "Absence" but the system proves a full shift (>=6h) with no
      // biometric punch => the person worked from home; combine-sources corrects the false absence.
      const odooAbsenceWorked = isWorkingKind && !hasPunch && /absence/i.test(odStatus) && sysEvidenceMin != null && sysEvidenceMin >= 360;
      // BR-WFH-002 (Director 2026-07-08, "md mn = wfh"): midnight shifts are WFH BY DEFAULT —
      // Office only when BOTH a biometric punch AND a system session prove physical presence.
      // Covers MD/MN and the Ramadan variants MDR/MNR (same midnight family).
      const midnightCode = isWorkingKind && /^(MD|MN)R?$/i.test(String(c.norm || raw || '').trim());
      const midnightWFH = midnightCode && !(hasPunch && sysEvidenceMin != null);
      const wfhStatus = isWorkingKind ? ((codeWFH || locWFH || odooWFH || odooAbsenceWorked || midnightWFH) ? 'WFH' : 'Office') : '';
      const isWFH = wfhStatus === 'WFH';
      const reclassNote = odooAbsenceWorked
        ? ('System-verified WFH — Odoo had marked Absence; ' + (sysEvidenceMin / 60).toFixed(1) + 'h proven in system')
        : (midnightWFH && !codeWFH && !locWFH && !odooWFH ? 'Midnight shift — WFH by rule BR-WFH-002 (Office requires punch + system)' : '');

      // ---- scheduled window ----
      const schedStart = c.start, schedEnd = c.end;
      const grossMin = (schedStart != null && schedEnd != null) ? schedEnd - schedStart : null;
      const reqNet = isMother ? REQUIRED_MOM_NET : (c.net != null ? c.net : null);

      // ---- approved permission / comp coverage ----
      let coversLate = false, coversEarly = false, hasPending = false, permApprovedNote = [], compApproved = false;
      let permStatus = '', permFrom = '', permTo = '', permHours = '', compStatus = '', compHours = '';
      for (const p of pm) {
        if (p.kind === 'comp') { compStatus = p.status; compHours = p.hours != null ? p.hours : ''; if (p.approved) { compApproved = true; if (p.covers === 'late' || p.covers === 'full' || p.covers === 'both') coversLate = true; if (p.covers === 'early' || p.covers === 'full' || p.covers === 'both') coversEarly = true; } else hasPending = true; }
        else { permStatus = p.status; permFrom = clock12(p.fromMin); permTo = clock12(p.toMin); permHours = p.hours != null ? p.hours : ''; if (p.approved) { if (p.covers === 'late' || p.covers === 'both' || p.covers === 'full') coversLate = true; if (p.covers === 'early' || p.covers === 'both' || p.covers === 'full') coversEarly = true; } else hasPending = true; }
      }

      // ---- final system login — source mode is configurable (SYS_MODE). June = 'ameyo-first' (the user's manual
      //      method): PRIMARY source's own first-login→last-logout for the shift; SECONDARY only fills a genuine gap
      //      (primary missing or just a fragment). NOT a union (a union extends logouts and hides real early-outs).
      //      'sprinklr-only' = ignore Ameyo entirely (the planned future, one system). ----
      let sysLogin = null, sysLogout = null, sysSource = '', sysConf = '', sysReason = '';
      const shiftLen = (winE - winS) || 540;
      let prim, sec, primName, secName;
      if (SYS_MODE === 'sprinklr-only') { prim = sp; sec = null; primName = 'Sprinklr'; secName = null; }
      else if (SYS_MODE === 'sprinklr-first') { prim = sp; sec = am; primName = 'Sprinklr'; secName = 'Ameyo'; }
      else { prim = am; sec = sp; primName = 'Ameyo'; secName = 'Sprinklr'; }
      const primCov = prim ? (prim.logoutMin - prim.loginMin) : 0;
      const secCov = sec ? (sec.logoutMin - sec.loginMin) : 0;
      if (prim && primCov >= 0.5 * shiftLen) {              // primary is a real session → authoritative
        sysLogin = prim.loginMin; sysLogout = prim.logoutMin; sysSource = sec ? primName + ' (' + secName + ' avail)' : primName; sysConf = 'High'; sysReason = primName + ' (preferred)';
      } else if (prim && sec) {                              // primary only a fragment → take whichever covers more
        if (secCov > primCov) { sysLogin = sec.loginMin; sysLogout = sec.logoutMin; sysSource = secName + ' (' + primName + ' partial)'; sysConf = 'Medium'; sysReason = primName + ' fragment, ' + secName + ' fuller'; }
        else { sysLogin = prim.loginMin; sysLogout = prim.logoutMin; sysSource = primName + ' (partial)'; sysConf = 'Medium'; sysReason = primName + ' partial, fuller than ' + secName; }
      } else if (prim) { sysSource = primName; sysConf = 'Medium'; sysReason = primName + ' only'; sysLogin = prim.loginMin; sysLogout = prim.logoutMin; }
      else if (sec) { sysSource = secName; sysConf = 'Medium'; sysReason = secName + ' (no ' + primName + ')'; sysLogin = sec.loginMin; sysLogout = sec.logoutMin; }
      // transparency: if the chosen window had a never-closed (bleed) session capped, flag it — the user's manual
      // read may catch a real early-out here. We DON'T auto-decide it (stays as computed); the note prompts review.
      // honest provenance: this date's system evidence came from the user's sheet, not a live Ameyo export
      if (sysSource && sheetEvidenceDates && sheetEvidenceDates.has(date)) { sysSource = 'Workbook (recorded)'; sysConf = 'Medium'; sysReason = 'sheet-recorded system times (evidence files do not cover this date)'; }
      const selWin = /^Ameyo/.test(sysSource) ? am : /^Sprinklr/.test(sysSource) ? sp : null;
      if (selWin && selWin.capped) sysReason += ' · logout capped (open session — verify early-out)';
      // LOGIN refinement (matches the user's method): take the EARLIEST plausible login across BOTH sources —
      // kills false-lateness where Ameyo-first picked a late login while Sprinklr had the real on-time one.
      if (am && sp && sysLogin != null) { const earliest = Math.min(am.loginMin, sp.loginMin); if (earliest < sysLogin) { sysLogin = earliest; if (!/earliest/.test(sysReason)) sysReason += ' · earliest-login both'; } }

      // ---- governing presence — OFFICIAL late/early = SYSTEM for everyone (matches the user's manual Shift sheet,
      //      confirmed 2026-06-28); punch shown as a SEPARATE column. Falls back to punch only if no system. ----
      const hasSystem = sysLogin != null;
      let govLogin = null, govLogout = null, govBasis = '';
      if (hasSystem) { govLogin = sysLogin; govLogout = sysLogout; govBasis = 'system'; }
      else if (hasPunch) { govLogin = od.punchIn; govLogout = od.punchOut; govBasis = 'punch'; }
      // cross-midnight: if govLogout < govLogin, add a day
      if (govLogin != null && govLogout != null && govLogout < govLogin) govLogout += 1440;

      // separate PUNCH late/early (like the manual sheet's "Punch Late In" / "Punch Early Out")
      let punchLateMin = null, punchEarlyMin = null;
      if (hasPunch && schedStart != null && schedEnd != null) {
        let po = od.punchOut; if (po != null && po < od.punchIn) po += 1440;
        punchLateMin = Math.max(0, od.punchIn - schedStart);
        if (po != null) punchEarlyMin = Math.max(0, schedEnd - po);
      }

      // ---- lateness / early-out / shortage / conformance / OT ----
      let lateMin = null, earlyMin = null, effLate = null, effEarly = null, shortage = null, conf = '', presenceMin = null, completedReq = false;
      let otSystemMin = null, punchOtMin = null, otNote = '';
      const computable = isWorkingKind && c.mapped && schedStart != null && schedEnd != null && govLogin != null && govLogout != null && !/PROVISIONAL/.test(c.note);
      if (computable) {
        const gross = grossMin;
        lateMin = Math.min(gross, Math.max(0, govLogin - schedStart));   // capped at shift length (no impossible values)
        earlyMin = Math.min(gross, Math.max(0, schedEnd - govLogout));
        effLate = coversLate ? 0 : lateMin;
        effEarly = (coversEarly || isMother) ? 0 : earlyMin;            // mothers (Haya/Shaima) excluded from early-out per agreed rule
        presenceMin = govLogout - govLogin;
        // user rule 2026-06-30: the system-open span must cover the FULL shift (9h INCLUDING the break,
        // since the agent stays logged in during the break) — NOT just the net 8h. So compare to gross.
        completedReq = gross != null && presenceMin >= gross;
        shortage = completedReq ? 0 : (effLate + effEarly);
        /* BR-MAT-001 has to hold in the DENOMINATOR too, not only in the early-out count.
           The maternity-7h mothers work a legitimate 7-hour day. effEarly already zeroes
           their early-out — but conformance was still dividing their real 7h of presence
           by a 9h scheduled window on any day carrying a 9h code, which is 420/540 =
           78%. Measured: Shaima Saoud reads 100% on her B7 days and 78.2% / 75.3% on B
           and N. Same person, same behaviour, penalised only where the code happened to
           be written long. Honouring a rule in one metric and ignoring it in the next is
           how a protected employee ends up looking like the worst performer on a team.
           The WFH HR report already caps their window this way; conformance now agrees. */
        const MATERNITY_WINDOW = 420;
        const paidRaw = schedEnd - schedStart;
        const paid = isMother ? Math.min(paidRaw, MATERNITY_WINDOW) : paidRaw;
        const effSchedEnd = isMother ? schedStart + paid : schedEnd;
        const overlap = Math.max(0, Math.min(govLogout, effSchedEnd) - Math.max(govLogin, schedStart));
        const permitted = (coversLate ? lateMin : 0) + (coversEarly ? earlyMin : 0);
        conf = paid > 0 ? Math.min(100, Math.round(100 * Math.min(overlap + permitted, paid) / paid)) : '';
        // OT = system worked past shift end (credited up to the 5h plausible ceiling by pickWindow's cap).
        // Corroborate with the biometric punch-out when present; flag large/uncorroborated OT for the user's eye.
        otSystemMin = Math.max(0, govLogout - schedEnd);
        if (hasPunch) { let po = od.punchOut; if (po != null && po < od.punchIn) po += 1440; if (po != null) punchOtMin = Math.max(0, po - schedEnd); }
        if (otSystemMin >= 120) {
          const corrob = punchOtMin != null && Math.abs(punchOtMin - otSystemMin) <= 90;
          otNote = 'OT ' + hhmm(otSystemMin) + (corrob ? ' (matches punch ✓)' : (selWin && selWin.capped ? ' (capped 5h — verify)' : ' (uncorroborated — verify if logical)'));
        }
      }

      // #4: >240m credited late/early on a cross-midnight shift is logout bleed, not real tardiness (training:
      //     the logout signal is unreliable; the read-side already quarantines >240). Cap the STORED sys late/early
      //     at 240 + flag; the raw punch late/early columns are untouched.
      const TARDY_CEIL = 240;
      let sysLateStore = effLate || 0, sysEarlyStore = effEarly || 0, tardyBleedFlag = false;
      if (c.crossMidnight) {
        if (sysLateStore > TARDY_CEIL) { sysLateStore = TARDY_CEIL; tardyBleedFlag = true; }
        if (sysEarlyStore > TARDY_CEIL) { sysEarlyStore = TARDY_CEIL; tardyBleedFlag = true; }
      }

      // ---- disposition: HR / Manual Review / Excluded-valid / Valid / DQ ----
      let disposition = '', hrAction = 'No', exclusionReason = '', manualReview = '', dqFlag = '', notes = c.note || '';

      if (c.kind === 'off' || c.kind === 'leave' || c.kind === 'holiday' || c.kind === 'sep' || c.kind === 'comp') {
        disposition = 'Non-working (' + c.kind + ')';
      } else if (c.kind === 'sick') { disposition = 'Sick leave'; }
      else if (c.kind === 'absence') { disposition = 'Absence'; }
      else if (!c.mapped) { disposition = 'Data Quality'; dqFlag = c.note; }
      else if (dayExcluded) { disposition = 'Excluded role (record-only)'; exclusionReason = c.management ? 'Management (CCNO)' : ((fn || idn.team) + ' — supervisory/excluded'); }
      else if (isWFH) {
        // WFH HR logic
        if (!hasSystem) { disposition = (odStatus.match(/absence/i)) ? 'Absence (per Odoo)' : 'Manual Review'; manualReview = hasSystem ? '' : 'WFH with no system login/logout — cannot prove'; }
        else if (!computable) { disposition = 'Manual Review'; manualReview = 'WFH but schedule window unknown (' + c.raw + ')'; }
        else if (hasPending && (effLate >= HR_MIN || effEarly >= HR_MIN)) { disposition = 'Manual Review'; manualReview = 'Pending permission (' + permStatus + ') — not yet approved'; }
        else if (completedReq) { disposition = 'WFH valid (completed required hours)'; }
        else if (effLate < HR_MIN && effEarly < HR_MIN) { disposition = 'WFH valid (within tolerance/covered)'; }
        else if (sysConf === 'Low') { disposition = 'Manual Review'; manualReview = sysReason; }
        else if (presenceMin != null && presenceMin < MIN_PRESENCE) { disposition = 'Manual Review'; manualReview = 'Captured system presence only ' + hhmm(presenceMin) + ' on a ' + (grossMin / 60).toFixed(0) + 'h shift — incomplete evidence, not a proven early-out'; }
        else if (effLate > MAX_HR_DEV || effEarly > MAX_HR_DEV) { disposition = 'Manual Review'; manualReview = 'Large deviation (late ' + hhmm(effLate) + ' / early ' + hhmm(effEarly) + ') — possible unrecorded shift swap or partial capture; verify before HR'; }
        else { disposition = 'HR ACTION'; hrAction = 'Yes'; notes = 'WFH ' + (effLate >= HR_MIN ? 'late ' + hhmm(effLate) : '') + (effEarly >= HR_MIN ? ' early-out ' + hhmm(effEarly) : ''); }
      } else {
        // Office working day — official late/early from system (punch shown separately)
        if (computable) {
          if (hasPending && (effLate >= HR_MIN || effEarly >= HR_MIN)) { disposition = 'Manual Review'; manualReview = 'Pending permission'; }
          else if (completedReq || (effLate < HR_MIN && effEarly < HR_MIN)) { disposition = 'Office valid'; }
          else { disposition = 'Office tardiness (record)'; notes = 'office late ' + hhmm(effLate || 0) + ' early ' + hhmm(effEarly || 0) + ' — office tardiness, handled separately from the WFH HR report'; }
        } else if (!hasSystem && !hasPunch) { disposition = (odStatus.match(/absence/i)) ? 'Absence (per Odoo)' : 'Manual Review'; manualReview = (odStatus.match(/absence/i)) ? '' : 'No system and no punch on a scheduled office day'; }
        else { disposition = 'Manual Review'; manualReview = 'Schedule/time unknown — cannot compute'; }
      }
      if (dayExcluded && disposition === 'HR ACTION') { disposition = 'Excluded role (record-only)'; hrAction = 'No'; exclusionReason = c.management ? 'Management (CCNO)' : ((fn || idn.team) + ' — supervisory/excluded'); }

      // ── live-ingest payload (raw minutes → roster_days) ──
      const govDur = (govLogin != null && govLogout != null) ? Math.max(0, govLogout - govLogin) : null;
      const sysEv = sysEvidenceMin || 0;
      const isHolidayDate = holidayDates.has(date) || HOLIDAY_RE.test(odStatus);  // editable config + date-level Odoo auto-detect
      // RULE B (2026-06-30): a cross-midnight shift is OWNED BY ITS START DAY. A non-working day (H/OFF/leave) must NOT
      // re-grab the previous night's session (govLogin < 0 ⇒ logged in before this day began) — that double-counts it
      // on the next day. Only a session that STARTS on this day (login ≥ 00:00) belongs to it.
      const prevDayBleed = (!isWorkingKind && govLogin != null && govLogin < 0);
      // RULE A (2026-06-30): an official holiday falling on an ANNUAL-LEAVE (L) day counts as the HOLIDAY, NOT a consumed
      // leave day — it returns to the leave balance. Treated as holiday (presence/hr_code) below; original L kept raw.
      const leaveOnHoliday = isHolidayDate && c.kind === 'leave' && !['DL', 'UPL'].includes(String(raw || '').toUpperCase());
      let otMin = 0, offdayOt = 0, holidayOt = 0, offWorkedMin = 0, offWorkedHrReview = false;
      // ── OT crediting — Director's 4 CONFIRMED rules (2026-07-11), replacing the 2026-07-05 net-caps
      //    for the OFF-day/holiday buckets ONLY. Regular working-day OT keeps the BR-OT-004 5h ceiling.
      //    Rule 1: OFF-day/holiday OT = FULL net worked hours ("worked 8h + stayed 2h = 10h"), NO otNetCap.
      //            Net = worked span − 60min break when the day's worked total ≥ 6h; below 6h no deduction.
      //            Sanity kept: 16h per-session bleed guard + 16h/day total + evidence gate (≥ 1h in system).
      //    Rule 2: multi-session — sum ALL sessions STARTING on the off-day (overlap-merged, BR-TIM-003
      //            start-day ownership), via sumDaySessions, not the single pickWindow best-window.
      //    Rule 3: forgot-system guard (Barazi rule) on WORKING-day tails — see the computable branch.
      const OT_CEIL = 300;                    // BR-OT-004: regular working-day OT ceiling = 5h (unchanged)
      // #8: OT is NEVER credited on a non-working attendance state — absence / sick / separation / unmapped
      //    suppress every bucket (an absence-suffixed code landing on a holiday date must not earn holiday OT).
      const otEligible = c.mapped && c.kind !== 'absence' && c.kind !== 'sick' && c.kind !== 'sep' && c.kind !== 'unknown';
      // OFF-day/holiday worked evidence: merged multi-session total for the day (start-day-owned, so the
      // previous night's cross-midnight session can never double-count here — replaces the prevDayBleed gate).
      const dayAgg = (otEligible && !isWorkingKind) ? sumDaySessions([ameyoSessions[e.id], sprinkSessions[e.id]], Dabs) : null;
      const aggWorked = dayAgg ? dayAgg.totalMin : 0;
      const netWorked = (m) => Math.max(0, Math.min(m, 960) - (m >= 360 ? 60 : 0));  // rule 1: −1h break only when ≥ 6h
      const offdayEvidence = (aggWorked >= 60) ? netWorked(aggWorked) : 0;            // evidence gate: ≥ 1h real session
      let otCappedFlag = false;               // regular-day raw OT clamped to OT_CEIL → surfaced in data_quality
      let otSuspectForgot = false;            // rule 3: implausible logout tail — flagged, NOT credited
      if (!otEligible) { /* absence/sick/sep/unknown → no OT, all buckets stay 0 */ }
      else if (isHolidayDate && isWorkingKind && govDur != null && govDur >= 60)   // worked a scheduled shift on an official holiday → WHOLE day = holiday OT, FULL net hours (rule 1: no net-cap)
        holidayOt = netWorked(govDur);
      else if (c.kind === 'holiday') holidayOt = offdayEvidence;  // worked the holiday ITSELF = full net worked (rules 1+2)
      else if (computable) {
        const otRaw = otSystemMin || 0;
        // Rule 3 (Barazi rule): a working-day OT tail whose LOGOUT is implausible = employee forgot to close.
        // Suspect ONLY when ALL hold: tail ≥ 120min · punch does NOT corroborate the tail (no punch, or the
        // punch-out sits at shift end contradicting the system tail) · the logout crossed midnight past a
        // NON-cross-midnight shift end (an hour inconsistent with activity) · and no later session that day
        // shows activity resumed. When punch corroborates, credit always stands (conservative).
        const corrob = punchOtMin != null && Math.abs(punchOtMin - otRaw) <= 90;
        const crossedIntoNight = govLogout != null && govLogout > 1440 && schedEnd != null && schedEnd <= 1440;
        // "no other session after it that day": only sessions starting on the SAME calendar day count —
        // the next day's own shift login must not launder a forgotten logout into credited OT.
        const laterSession = [ameyoSessions[e.id], sprinkSessions[e.id]].some(ss => (ss || []).some(s => s.aLogin > Dabs + govLogout && s.aLogin < Dabs + 1440));
        if (otRaw >= 120 && !corrob && crossedIntoNight && !laterSession) { otSuspectForgot = true; otMin = 0; }
        else { otMin = Math.min(otRaw, OT_CEIL); otCappedFlag = otRaw > OT_CEIL; }  // #1: regular-day OT keeps the 5h ceiling on EVERY basis
      }
      else if (c.kind === 'off' || c.kind === 'leave' || c.kind === 'comp') {
        // Director decision 1 (2026-07-11): a scheduled OFF day worked (also COMP/LEAVE worked-same-day)
        // STAYS an OFF day. Do NOT auto-credit payable off-day OT — park the computed net hours in the
        // NON-payable off_worked_min column and flag the row for HR to clarify ("scheduled OFF but worked
        // this day"). Payable TRUE_OT excludes it until HR reviews. offdayOt stays 0.
        offWorkedMin = offdayEvidence; offWorkedHrReview = offdayEvidence > 0;
      }
      // BR-OT-006 (Director 2026-07-10): paid-OT rounding — a residual over 45 min rounds UP to the full
      // hour; 45 min or less stays EXACT ("15 دقيقة بتضل متل ما هي، اكتر من 45 بتصير ساعة"). Applied to
      // the 3 disjoint buckets AFTER every clamp (can never exceed OT_CEIL — 300 is a multiple of 60).
      const roundOt45 = (m) => { m = Math.max(0, Math.round(m || 0)); const r = m % 60; return r > 45 ? m - r + 60 : m; };
      otMin = roundOt45(otMin); offdayOt = roundOt45(offdayOt); holidayOt = roundOt45(holidayOt);
      // #9: OFF/holiday OT credited on login-only evidence (no biometric punch) → soft data-quality flag (never reverse).
      const otLoginOnly = (offdayOt > 0 || holidayOt > 0) && !hasPunch;
      // Rule 4 (Director 2026-07-11): excluded roles (TL/Senior/Resolution/RTA/WFM/Management) — OT is still
      // computed & stored but RECORD-ONLY (not payable, future-counted). Payroll reports must exclude it.
      const otRecordOnly = !!(dayExcluded && (otMin > 0 || offdayOt > 0 || holidayOt > 0));
      const presenceLive = leaveOnHoliday ? 'holiday'
        : isWorkingKind ? (isWFH ? 'wfh' : 'office')
        : c.kind === 'sick' ? 'sick' : c.kind === 'leave' ? 'leave' : c.kind === 'absence' ? 'absent'
        : c.kind === 'holiday' ? 'holiday' : 'off';
      /* ── EVIDENCE ARBITRATION (Director 2026-07-29) ────────────────────────────
         Two rules, both about refusing to score what was not measured.

         (1) ODOO IS THE ARBITER WHEN THERE IS NO EVIDENCE. A scheduled working day
         with no session and no punch used to be recorded as "worked, system missing"
         and scored. On July that was 238 days across 88 people — and Odoo already
         said what they were: Off Day 140, WFH 59, leave/absence/sick/unpaid 36, and
         only 3 genuinely unknown. The engine READ that column all along and never
         consulted it for this case. 140 rest days were sitting inside the scheduled-
         working denominator, which quietly deflated every coverage and conformance
         percentage that divides by it.
         The schedule stays the authority for the SHIFT (BR-SHF-004). This decides only
         whether the day was WORKED at all, which is the one thing the schedule cannot
         know in advance. Where the two disagree outright — sheet says work, Odoo says
         Off Day — neither wins: the day is flagged for review, because one of the two
         systems is wrong and guessing hides it.

         (2) A DAY IS ONLY SCORED IF ENOUGH OF IT WAS SEEN. Measured first: of the 37
         days whose lateness exceeded 240 minutes, 16 had worked a FULL shift hours
         away from the scheduled window — a schedule error, not a late person — and 9
         rested on under a quarter of the shift. A blanket ">240 is not real" rule
         would have erased those 16 real records and still missed 6 barely-seen days
         whose lateness happened to fall under the cut. So the gate is how much of the
         shift the evidence actually covers, not how large the number is. */
      /* Compare the session SPAN to the GROSS shift, not the net. The agent stays logged in
         through the break, so the span it produces is a gross-shaped number; dividing it by
         net overstated every reported share (a 45-minute session on a 9h shift read 9% of
         net when it is 8% of the shift the person was asked to be present for). Same basis
         completedReq already uses. */
      const seenShare = (isWorkingKind && grossMin > 0 && govDur != null) ? govDur / grossMin : null;
      const displacedMin = Math.max(sysLateStore || 0, sysEarlyStore || 0);

      let odooVerdict = null, evidenceClass = null;
      if (isWorkingKind && !hasSystem && !hasPunch) {
        const s = String(odStatus || '').trim();
        if (/^off\s*day/i.test(s)) odooVerdict = 'off-day-conflict';
        else if (/annual leave/i.test(s)) odooVerdict = 'leave';
        else if (/maternity/i.test(s)) odooVerdict = 'leave';
        else if (/unpaid/i.test(s)) odooVerdict = 'leave';
        else if (/sick/i.test(s)) odooVerdict = 'sick';
        else if (/absence/i.test(s)) odooVerdict = 'absent';
        else if (/wfh|work from home/i.test(s)) odooVerdict = 'wfh-no-evidence';
        else odooVerdict = 'unknown';
      } else if (isWorkingKind && seenShare != null) {
        if (seenShare < 0.25) evidenceClass = 'insufficient';
        else if (seenShare >= 0.75 && displacedMin > 240) evidenceClass = 'displaced';
      }

      /* Presence follows Odoo only where Odoo names a LEAVE state — those are HR facts
         and Odoo is the HR system of record. An Off-Day conflict does NOT flip presence,
         because the schedule may be the correct one; it is surfaced instead. */
      const presenceArbitrated =
        odooVerdict === 'leave' ? 'leave' :
        odooVerdict === 'sick' ? 'sick' :
        odooVerdict === 'absent' ? 'absent' : presenceLive;

      /* Never SCORE a day nobody measured, and never score one measured wrongly. The
         day stays in the record with its reason — excluded, not deleted. */
      const evidenceUnscoreable = !!odooVerdict || evidenceClass === 'insufficient' || evidenceClass === 'displaced';

      const holidayLabel = isHolidayDate ? ('Official Holiday — ' + (HOLIDAY_NAME.get(date) || (HOLIDAY_RE.test(odStatus) ? String(odStatus).replace(/[-–—].*$/, '').replace(/\d{4}/, '').trim() : 'Holiday'))) : null;
      const mismatchLive = (isWorkingKind && hasPunch && !hasSystem) ? 'no-system'
        : (isWorkingKind && !hasPunch && hasSystem && !isWFH) ? 'no-punch' : null;
      // ── MASTER HR CODE (hr_code) + attendance_code — the HR Matrix reads
      //    COALESCE(hr_code, attendance_code, shift_code,'OFF'), so these MUST live in the
      //    engine or every refresh wipes the SL/A/L/H/WFH semantics. EXACTLY the proven
      //    import-roster-master rule (the instructions we built before) — no new behaviour:
      //    WFH cell = 'WFH' (shift kept in attendance_code); office-coded with system-but-no-punch
      //    (forgot to punch) still shows its SHIFT CODE — never wrongly OFF/absent.
      const RAW = String(raw || '').toUpperCase();
      let hrCode, attCode = raw;
      /* The Odoo arbitration moved PRESENCE to leave/sick/absent for days the schedule had
         written as a working shift. hr_code has to move with it: the HR Matrix renders
         COALESCE(hr_code, attendance_code, shift_code,'OFF'), so leaving hr_code as 'B' on a
         day the roster calls leave made the matrix show 44 people working shifts they were
         on leave or absent for — the roster and the HR matrix contradicting each other about
         the same person on the same day. The raw schedule code is preserved in attendance_code,
         which is where the original cell has always been kept. */
      if (odooVerdict === 'leave')       { hrCode = 'L';  attCode = raw || 'L'; }
      else if (odooVerdict === 'sick')   { hrCode = 'SL'; attCode = raw || 'SL'; }
      else if (odooVerdict === 'absent') { hrCode = 'A';  attCode = raw || 'A'; }
      else if (c.kind === 'sick')        { hrCode = 'SL'; attCode = (raw && String(raw).length > 1) ? raw : 'SL'; }
      else if (c.kind === 'absence'){ hrCode = 'A';  attCode = (raw && String(raw).length > 1) ? raw : 'A'; }
      else if (c.kind === 'off')    { hrCode = /transfer/i.test(RAW) ? 'Transfer' : 'OFF'; attCode = 'OFF'; }
      else if (c.kind === 'leave')  { hrCode = leaveOnHoliday ? 'H' : (['DL', 'UPL'].includes(RAW) ? RAW : 'L'); attCode = hrCode; }
      else if (c.kind === 'holiday'){ hrCode = 'H'; attCode = 'H'; }
      else if (c.kind === 'comp')   { hrCode = 'COMP'; attCode = 'COMP'; }
      else if (c.kind === 'sep')    { hrCode = RAW || 'RES'; attCode = hrCode; }
      else if (isWorkingKind)       { hrCode = isWFH ? 'WFH' : (c.norm || raw); attCode = c.norm || raw; }
      else                          { hrCode = raw || 'OFF'; attCode = raw || 'OFF'; }
      const _ingest = {
        emp: String(e.id), person: String(e.id), name: idn.name || e.name, fn, username: idn.userId || e.username || null,
        totalSysMin: (prevDayBleed || govDur == null) ? null : Math.max(0, govDur),
        dailyNote: leaveOnHoliday ? 'Annual leave on an official holiday — counted as holiday, not deducted from leave balance' : null,
        // report columns (same semantics as import-roster-master, so reports never read NULL/0 after a refresh):
        // OT before/after = informational split around the shift window; a worked HOLIDAY day is all holiday-OT, not before/after.
        otBefore: (isWorkingKind && !isHolidayDate && schedStart != null && govLogin != null) ? Math.min(360, Math.max(0, schedStart - govLogin)) : 0,
        otAfter: (isWorkingKind && !isHolidayDate && schedEnd != null && govLogout != null) ? Math.min(OT_CEIL, Math.max(0, govLogout - schedEnd)) : 0,   // #13: cap aligned to ot_min ceiling so before+after reconcile
        weekNumber: weekNum(date), monthName: MONTHS[+date.slice(5, 7) - 1],
        attendanceStatus: attStatus(c.kind, presenceArbitrated, raw),
        lateCategory: isWorkingKind ? ((!hasSystem && !hasPunch) ? 'No show' : lateCat(effLate)) : null,
        missingPunch: !!(isWorkingKind && !hasPunch), missingSystem: !!(isWorkingKind && !hasSystem),
        crossesMidnight: !!c.crossMidnight, originalShiftCode: c.origin || null,
        date, day: dayName(date), status: holidayLabel ? (holidayLabel + (isWorkingKind ? ' (worked)' : '')) : raw, presence: presenceArbitrated, location: isWFH ? 'WFH' : 'Office',
        shiftCode: c.norm, shiftCat: c.norm, schedStart, schedEnd: (schedEnd != null && schedEnd > 1440 ? schedEnd - 1440 : schedEnd),
        punchIn: hasPunch ? od.punchIn : null, punchOut: (od && od.punchOut != null) ? od.punchOut : null,
        sysLogin: (prevDayBleed || sysLogin == null) ? null : ((sysLogin % 1440) + 1440) % 1440, sysLogout: (prevDayBleed || sysLogout == null) ? null : ((sysLogout % 1440) + 1440) % 1440, loginSrc: prevDayBleed ? null : (sysSource || null),
        lateMin: punchLateMin || 0, earlyMin: punchEarlyMin || 0, sysLate: sysLateStore, sysEarly: sysEarlyStore,
        otMin, offdayOt, holidayOt, otRecordOnly, offWorkedMin, offWorkedHrReview,
        // worked_min: a WORKED day = the gov session (capped at a sane 16h to kill never-logged-out bleed);
        // a non-working day (OFF/leave/holiday-off/absence/sick) has NO scheduled shift, so its raw system
        // bleed must NOT read as worked hours — credit only the validated OT session (else 0).
        // worked = PROVEN system/punch span (capped 16h). NO evidence (no system AND no punch) => 0, NOT the
        // scheduled net — we must never show "worked 8h" for a day we can't prove (it carries the no-evidence flag).
        worked: isWorkingKind ? (govDur != null ? Math.min(Math.max(0, govDur), 960) : 0) : (offWorkedMin || offdayOt || holidayOt || 0),
        adherence: conf === '' ? null : conf, conforming: conf !== '' && conf >= 90,
        permission: permStatus || null, permissionStatus: permStatus || null,   // #11: also populate the permission_status column (was unmapped → left blank)
        permType: (pm.find(p => p.kind === 'perm') || {}).type || null,
        permDur: (() => { const pr = pm.find(p => p.kind === 'perm'); return (pr && pr.fromMin != null) ? (clock12(pr.fromMin) + ' → ' + clock12(pr.toMin) + (pr.hours != null && pr.hours !== '' ? ' (' + pr.hours + 'h)' : '')) : null; })(),
        hrCode, attCode, comp: compStatus || null, sick: c.kind === 'sick' ? raw : null, mismatch: mismatchLive,
        // user rule 2026-06-30: a working day with NO punch AND NO system login must be FLAGGED with a clear
        // note (not silently treated as present/absent) so it surfaces on the page for verification. The 2026-07-05
        // audit adds the OT-ceiling / login-only-OT / cross-midnight tardiness-bleed flags (soft — verify, never reverse).
        dq: (() => {
          const base = (isWorkingKind && !hasSystem && !hasPunch) ? 'No punch & no system login — verify (not auto-absent)'
            : ((!c.mapped && c.kind === 'unknown') ? c.note : (dqFlag || null));
          const extra = [];
          if (odooVerdict === 'off-day-conflict') extra.push('SCHEDULE vs HR CONFLICT — sheet says a working shift, Odoo says Off Day; not scored, verify which is right');
          else if (odooVerdict === 'leave') extra.push('No system/punch — Odoo says ' + String(odStatus || '').trim() + '; recorded as leave, not scored');
          else if (odooVerdict === 'sick') extra.push('No system/punch — Odoo says ' + String(odStatus || '').trim() + '; recorded as sick, not scored');
          else if (odooVerdict === 'absent') extra.push('No system/punch — Odoo says ' + String(odStatus || '').trim() + '; recorded as absent, not scored');
          else if (odooVerdict === 'wfh-no-evidence') extra.push('WFH per Odoo with no system session — no biometric expected; not scored');
          else if (odooVerdict === 'unknown') extra.push('No system, no punch, and Odoo has no status — genuinely unknown, not scored');
          if (evidenceClass === 'insufficient') extra.push('Evidence covers only ' + Math.round((seenShare || 0) * 100) + '% of the shift — too little to judge punctuality; not scored');
          if (evidenceClass === 'displaced') extra.push('Full shift worked ' + Math.round(displacedMin / 60) + 'h from the scheduled window — SCHEDULE REVIEW, not lateness; not scored');
          if (otCappedFlag) extra.push('OT capped at 5h ceiling — raw system/punch span longer (verify; logout may be un-closed)');
          if (otSuspectForgot) extra.push('ot-suspect-forgot-logout — system tail ' + hhmm(otSystemMin || 0) + ' past shift end (raw span ' + hhmm(govDur || 0) + '), no punch corroboration, logout after midnight on a non-midnight shift; OT tail NOT credited');
          if (otRecordOnly) extra.push('OT record-only (excluded role — not payable, future-counted)');
          if (offWorkedHrReview) extra.push('Scheduled OFF but worked this day (' + hhmm(offWorkedMin) + ') — HR clarify, NOT auto-paid as off-day OT');
          if (otLoginOnly) extra.push('OFF/holiday OT on system-login only (no biometric punch) — verify');
          if (tardyBleedFlag) extra.push('Cross-midnight late/early >4h = logout bleed — credited tardiness capped at 240m');
          return [base, ...extra].filter(Boolean).join(' | ') || null;
        })(),
        teamMgr: idn.manager || null, teamGroup: idn.team || e.teamCol || null, gender: idn.gender || null,
        roleCat: dayExcluded ? (c.management ? 'Management' : 'Excluded') : 'Agent', expectedH: c.net != null ? +(c.net / 60).toFixed(2) : null,
        /* A day is scored only when someone was excluded for their ROLE, and the day was
           actually measured. evidenceUnscoreable covers both new arbitrations. */
        includeTardiness: !dayExcluded && !evidenceUnscoreable,
        active: true,
      };

      records.push({
        _ingest,
        Day: dayName(date), Date: date, Name: idn.name || e.name, EmployeeID: e.id, UserID: idn.userId || e.username || '', Email: idn.email || '',
        Function: fn, Role: dayExcluded ? (c.management ? 'Management' : 'Excluded/Supervisory') : 'Agent', TeamManager: idn.manager || '', Group: idn.team || e.teamCol || '', Gender: idn.gender || '',
        RawRosterCode: raw, NormalizedCode: c.norm, OriginalShift: c.origin || '', WorkLocation: isWorkingKind ? wfhStatus : (c.kind === 'off' ? 'OFF' : c.kind === 'holiday' ? 'Holiday' : c.kind === 'leave' ? 'Leave' : c.kind === 'sick' ? 'Sick' : c.kind === 'absence' ? 'Absence' : c.kind === 'comp' ? 'COMP' : c.kind === 'sep' ? 'Separation' : 'Unknown'),
        SchedStart: clock12(schedStart), SchedEnd: fmtT12(schedEnd),
        SchedGrossH: c.gross == null ? '' : (c.gross / 60).toFixed(2), BreakH: c.gross == null ? '' : '1.00', ReqNetH: reqNet == null ? '' : (reqNet / 60).toFixed(2),
        OdooPunchIn: hasPunch ? fmtT12(od.punchIn) : '', OdooPunchOut: (od && od.punchOut != null) ? fmtT12(od.punchOut) : '', OdooStatus: odStatus,
        AmeyoLogin: am ? fmtT12(am.loginMin) : '', AmeyoLogout: am ? fmtT12(am.logoutMin) : '', AmeyoSessions: am ? am.sessions : '',
        SprinklrLogin: sp ? fmtT12(sp.loginMin) : '', SprinklrLogout: sp ? fmtT12(sp.logoutMin) : '', SprinklrSessions: sp ? sp.sessions : '',
        FinalSysLogin: fmtT12(sysLogin), FinalSysLogout: fmtT12(sysLogout), FinalSysSource: sysSource, SysConfidence: sysConf, SysReason: sysReason,
        WFHStatus: wfhStatus,
        // Official late/early = SYSTEM-based (RAW always shown even when excused). Punch late/early shown separately.
        PunchLate: (punchLateMin != null && punchLateMin > 0) ? minToHHMMSS(punchLateMin) : '', PunchEarly: (punchEarlyMin != null && punchEarlyMin > 0) ? minToHHMMSS(punchEarlyMin) : '',
        OtSystem: (otSystemMin != null && otSystemMin > 0) ? minToHHMMSS(otSystemMin) : '', OtPunch: (punchOtMin != null && punchOtMin > 0) ? minToHHMMSS(punchOtMin) : '',
        RawLoginDelay: (lateMin != null && lateMin > 0) ? minToHHMMSS(lateMin) : '', RawEarlyOut: (earlyMin != null && earlyMin > 0) ? minToHHMMSS(earlyMin) : '',
        Covered: (lateMin || earlyMin) ? (coversLate || coversEarly ? 'Yes (permission/comp)' : (isMother && earlyMin ? 'Yes (maternity)' : (hasPending ? 'Pending approval' : 'No'))) : '',
        LoginDelay: (effLate != null) ? minToHHMMSS(effLate) : '', EarlyOut: (effEarly != null) ? minToHHMMSS(effEarly) : '', Shortage: (shortage != null) ? minToHHMMSS(shortage) : '', Conformance: conf === '' ? '' : conf + '%',
        PermStatus: permStatus, PermFrom: permFrom, PermTo: permTo, PermHours: permHours, PermApproved: permStatus ? (/approved/i.test(permStatus) ? 'Yes' : 'No') : '',
        CompStatus: compStatus, CompHours: compHours, CompApproved: compStatus ? (compApproved ? 'Yes' : 'No') : '',
        HRActionRequired: hrAction, Disposition: disposition, ExclusionReason: exclusionReason, ManualReview: manualReview, DataQuality: dqFlag, Notes: [notes, reclassNote, otNote].filter(Boolean).join(' | '),
        _excluded: dayExcluded, _isWFH: isWFH, _kind: c.kind, _mapped: c.mapped,
        _rawLate: (lateMin != null ? lateMin : 0), _rawEarly: (earlyMin != null ? earlyMin : 0), _effLate: (effLate != null ? effLate : 0), _effEarly: (effEarly != null ? effEarly : 0),
        _coveredLate: !!coversLate, _coveredEarly: !!(coversEarly || isMother),
      });

      if (!c.mapped && c.kind === 'unknown') dq.push({ Date: date, Day: dayName(date), Name: idn.name || e.name, EmployeeID: e.id, Issue: 'Unmapped code', RawCode: raw, Detail: c.note });
      if (am && sp && (Math.abs(am.loginMin - sp.loginMin) > CONFLICT_MIN || Math.abs(am.logoutMin - sp.logoutMin) > CONFLICT_MIN)) dq.push({ Date: date, Day: dayName(date), Name: idn.name || e.name, EmployeeID: e.id, Issue: 'System conflict', RawCode: raw, Detail: 'Ameyo ' + hhmm(am.loginMin) + '-' + hhmm(am.logoutMin) + ' vs Sprinklr ' + hhmm(sp.loginMin) + '-' + hhmm(sp.logoutMin) });
    }
  }

  // employees missing identity -> DQ
  for (const e of F.employees) if (!F.identity[e.id]) dq.push({ Date: '', Day: '', Name: e.name, EmployeeID: e.id, Issue: 'Missing identity', RawCode: '', Detail: 'In June matrix but not in Shift identity sheet (email/gender/manager unknown) — Sprinklr match falls back to Ameyo username' });

  // ===== derive output sheets =====
  const STRIP = (r) => { const o = {}; for (const k in r) if (!k.startsWith('_')) o[k] = r[k]; return o; };
  const full = records.map(STRIP);
  const wfhAll = records.filter(r => r._isWFH).map(STRIP);
  const hr = records.filter(r => r.HRActionRequired === 'Yes').map(STRIP);
  const excludedValid = records.filter(r => r._excluded && (r._kind === 'work' || r._kind === 'wfh')).map(STRIP);
  const manual = records.filter(r => r.Disposition === 'Manual Review').map(STRIP);
  const wfhValid = records.filter(r => r._isWFH && /valid/i.test(r.Disposition)).map(STRIP);

  const mapAuditRows = Object.values(mapAudit).sort((a, b) => b.count - a.count);

  // Role lookup
  const roleSet = {};
  for (const e of F.employees) { const idn = F.identity[e.id] || {}; const fn = e.function || ''; const ex = isExcludedRole(fn, idn.team, e.id); const k = fn || '(none)'; roleSet[k] = roleSet[k] || { Role: fn, IncludeHR: ex ? 'No' : 'Yes', IncludeTardiness: ex ? 'No' : 'Yes', DefaultGrossH: 9, BreakH: 1, ReqNetH: 8, Count: 0, Note: ex ? 'Supervisory/excluded — record-only' : 'Agent — included' }; roleSet[k].Count++; }
  const roleRows = Object.values(roleSet).sort((a, b) => b.Count - a.Count);

  // ---- Employee_Tardiness_Summary: count + total duration per employee over the period (RAW always; covered vs uncovered) ----
  const tardyByEmp = {};
  for (const r of records) {
    const k = r.EmployeeID;
    const e = tardyByEmp[k] || (tardyByEmp[k] = { EmployeeID: r.EmployeeID, Name: r.Name, UserID: r.UserID, Function: r.Function, Role: r.Role, TeamManager: r.TeamManager,
      lateCnt: 0, lateMin: 0, covLate: 0, uncLateCnt: 0, uncLateMin: 0, earlyCnt: 0, earlyMin: 0, covEarly: 0, uncEarlyCnt: 0, uncEarlyMin: 0,
      worked: 0, wfh: 0, office: 0, off: 0, leave: 0, sick: 0, absence: 0, hr: 0, manual: 0 });
    if (r._rawLate > 0) { e.lateCnt++; e.lateMin += r._rawLate; if (r._coveredLate) e.covLate++; }
    if (r._rawEarly > 0) { e.earlyCnt++; e.earlyMin += r._rawEarly; if (r._coveredEarly) e.covEarly++; }
    if (r._effLate > 0) { e.uncLateCnt++; e.uncLateMin += r._effLate; }
    if (r._effEarly > 0) { e.uncEarlyCnt++; e.uncEarlyMin += r._effEarly; }
    if (r._kind === 'work' || r._kind === 'wfh') e.worked++;
    if (r.WFHStatus === 'WFH') e.wfh++; else if (r.WFHStatus === 'Office') e.office++;
    if (r._kind === 'off') e.off++; if (r._kind === 'leave') e.leave++; if (r._kind === 'sick') e.sick++; if (r._kind === 'absence') e.absence++;
    if (r.HRActionRequired === 'Yes') e.hr++; if (r.Disposition === 'Manual Review') e.manual++;
  }
  const tardySummary = Object.values(tardyByEmp).sort((a, b) => (b.uncLateMin + b.uncEarlyMin) - (a.uncLateMin + a.uncEarlyMin) || (b.lateMin + b.earlyMin) - (a.lateMin + a.earlyMin)).map(e => ({
    EmployeeID: e.EmployeeID, Name: e.Name, UserID: e.UserID, Function: e.Function, Role: e.Role, TeamManager: e.TeamManager,
    'Late # (all)': e.lateCnt, 'Late total (all)': minToHHMMSS(e.lateMin), 'Late covered #': e.covLate, 'Late UNCOVERED #': e.uncLateCnt, 'Late UNCOVERED total': minToHHMMSS(e.uncLateMin),
    'EarlyOut # (all)': e.earlyCnt, 'EarlyOut total (all)': minToHHMMSS(e.earlyMin), 'EarlyOut covered #': e.covEarly, 'EarlyOut UNCOVERED #': e.uncEarlyCnt, 'EarlyOut UNCOVERED total': minToHHMMSS(e.uncEarlyMin),
    'Worked days': e.worked, 'WFH days': e.wfh, 'Office days': e.office, OFF: e.off, Leave: e.leave, Sick: e.sick, Absence: e.absence, 'HR-action days': e.hr, 'Manual-review days': e.manual,
  }));

  // clean source sheets
  const odooClean = Object.entries(odoo).map(([k, v]) => { const [id, date] = k.split('|'); return { EmployeeID: +id, Date: date, Day: dayName(date), PunchIn: clock12(v.punchIn), PunchOut: clock12(v.punchOut), Status: v.status || '' }; }).sort((a, b) => a.EmployeeID - b.EmployeeID || a.Date.localeCompare(b.Date));
  const permClean = []; for (const k in perms) { const [id, date] = k.split('|'); for (const p of perms[k]) permClean.push({ EmployeeID: +id, Date: date, Day: dayName(date), Kind: p.kind, Type: p.type, From: clock12(p.fromMin), To: clock12(p.toMin), Hours: p.hours, Status: p.status, Approved: p.approved ? 'Yes' : 'No', Covers: p.covers }); }
  permClean.sort((a, b) => a.EmployeeID - b.EmployeeID || a.Date.localeCompare(b.Date));
  // clean raw views: group each employee's sessions by login calendar date (min login / max logout)
  const groupSessions = (sessionsById) => {
    const byKey = {};
    for (const id in sessionsById) for (const s of sessionsById[id]) { const dm = absToDM(s.aLogin); const k = id + '|' + dm.date; const cur = byKey[k] || { loginAbs: s.aLogin, logoutAbs: s.aLogout, sessions: 0 }; cur.loginAbs = Math.min(cur.loginAbs, s.aLogin); cur.logoutAbs = Math.max(cur.logoutAbs, s.aLogout); cur.sessions++; byKey[k] = cur; }
    return Object.entries(byKey).map(([k, v]) => { const [id, date] = k.split('|'); const li = absToDM(v.loginAbs), lo = absToDM(v.logoutAbs); const cross = lo.date > date; return { EmployeeID: +id, Date: date, Day: dayName(date), Login: clock12(li.min), Logout: clock12(lo.min) + (cross ? ' (+1)' : ''), DurationH: ((v.logoutAbs - v.loginAbs) / 60).toFixed(2), Sessions: v.sessions }; }).sort((a, b) => a.EmployeeID - b.EmployeeID || a.Date.localeCompare(b.Date));
  };
  const ameyoClean = groupSessions(ameyoSessions);
  const sprinkClean = groupSessions(sprinkSessions);
  const sysFinal = records.filter(r => r.FinalSysLogin).map(r => ({ Date: r.Date, Day: r.Day, Name: r.Name, EmployeeID: r.EmployeeID, FinalLogin: r.FinalSysLogin, FinalLogout: r.FinalSysLogout, Source: r.FinalSysSource, Confidence: r.SysConfidence, Reason: r.SysReason }));

  const rosterBase = records.map(r => ({ Day: r.Day, Date: r.Date, Name: r.Name, EmployeeID: r.EmployeeID, UserID: r.UserID, Function: r.Function, Group: r.Group, Gender: r.Gender, Location: r.WorkLocation, RawCode: r.RawRosterCode, NormalizedCode: r.NormalizedCode, SchedStart: r.SchedStart, SchedEnd: r.SchedEnd, ReqNetH: r.ReqNetH }));

  // dashboard data (compact)
  const dash = records.map(r => ({ Date: r.Date, Day: r.Day, EmployeeID: r.EmployeeID, Name: r.Name, Function: r.Function, WFH: r.WFHStatus, Code: r.NormalizedCode, LoginDelay: r.LoginDelay, EarlyOut: r.EarlyOut, Shortage: r.Shortage, Conformance: r.Conformance, HR: r.HRActionRequired, Disposition: r.Disposition }));

  // methodology log
  const method = [
    ['Step', 'What was done', 'Why'],
    ['0 Foundation', 'Extracted CC Schedule>June matrix (' + F.employees.length + ' employees, ' + F.meta.dateRange.join('..') + ') as the base; identity (ID/UserID/Email/Manager/Gender/Location) from the Shift long sheet', 'Roster is the source of truth; every other file is matched into it'],
    ['TZ fix', 'All source dates read as RAW Excel serials and converted to local calendar date (no UTC shift); times from serial fractions', 'Previous output drifted a day because dates were stored as local-midnight => prev-day 21:00Z'],
    ['Identity crosswalk', 'Odoo & Permission matched by Employee ID; Ameyo by User ID (username); Sprinklr by Email; name only as fallback', 'Four different identifier spaces were the root cause of mismatches'],
    ['WFH (Option A)', 'WFH = roster WFH code OR Location=WFH OR Odoo Status=WFH. Office-coded + system-without-punch => Manual Review, NOT auto-WFH', 'Agreed correction (2026-06-24) — never punish a forgotten punch as WFH'],
    ['Permissions', 'Only "HR Approved" removes a violation; Pending/Waiting => Manual Review (never auto-HR)', 'Sign-off decision 2026-06-28 (fairness)'],
    ['Ameyo dedup', 'Collapsed 15,047 fragmented rows to earliest-login / latest-logout per employee/day', 'Ameyo emits many micro-sessions; raw rows overstate/garble duration'],
    ['Sprinklr guard', 'Dropped degenerate sessions (logout<=login or span>16h); used to validate/complete Ameyo', 'Sprinklr has same-second and never-closed (multi-day) sessions'],
    ['Excluded roles', 'Team Leader/Senior/RTA/Resolution Specialist/WFM = record-only (no HR/tardiness). Customer Care NOT excluded', 'Sign-off decision 2026-06-28'],
    ['HR gate', 'WFH + mapped code + reliable system + uncovered late/early >=5min + not completed required hours + not excluded + no pending permission', 'Fairness > aggressive; weak evidence => Manual Review'],
    ['Mothers 7h', 'Haya Al-Muhanna (12375) & Shaima Saud (12434): required net = 6h', 'Agreed maternity rule'],
    ['Holiday', 'June 16 Hijri New Year recognised via roster H code and Odoo "Hijri New Year" status', 'Public holiday'],
    ['Horizon', 'Processed up to ' + horizon + ' (last date with real attendance evidence); later roster days are future and skipped', 'No attendance to reconcile beyond horizon'],
  ];

  // ===== write workbook =====
  const wb = XLSX.utils.book_new();
  const add = (name, rows) => { const ws = (Array.isArray(rows[0]) ? XLSX.utils.aoa_to_sheet(rows) : XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: 'no rows' }])); XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31)); };
  add('Roster_Base', rosterBase);
  add('Shift_Code_Mapping_Audit', mapAuditRows);
  add('Odoo_Fingerprint_Clean', odooClean);
  add('Permission_COMP_Clean', permClean);
  add('Ameyo_Login_Clean', ameyoClean);
  add('Sprinklr_Login_Clean', sprinkClean);
  add('System_Login_Final', sysFinal);
  add('WFH_All_Records', wfhAll);
  add('WFH_HR_Action_Report', hr);
  add('WFH_Excluded_Valid_Cases', excludedValid);
  add('Manual_Review_Cases', manual);
  add('Data_Quality_Issues', dq);
  add('Role_Working_Hours_Lookup', roleRows);
  add('Employee_Tardiness_Summary', tardySummary);
  add('Dashboard_Data', dash);
  add('Export_Full_Filtered_Result', full);
  add('Methodology_Audit_Log', method);
  XLSX.writeFile(wb, OUT_XLSX);

  // ===== "READY-TO-MERGE" deliverable — Odoo fingerprints + Permissions + Comp, per employee/day,
  //       keyed ID|Date so the user can XLOOKUP straight into their manual SYSTEM (Shifts) sheet. =====
  const fingerRows = records
    .filter(r => r.OdooPunchIn || r.OdooPunchOut || (r.OdooStatus && r.OdooStatus !== ''))
    .map(r => ({
      Key: r.EmployeeID + '|' + r.Date, Date: r.Date, Day: r.Day, Name: r.Name, EmployeeID: r.EmployeeID, UserID: r.UserID, Function: r.Function,
      Shift: r.NormalizedCode, 'Shift Start': r.SchedStart, 'Shift End': r.SchedEnd,
      'Punch In': r.OdooPunchIn, 'Punch Out': r.OdooPunchOut, 'Punch Late In': r.PunchLate, 'Punch Early Out': r.PunchEarly,
      'Odoo Status': r.OdooStatus, 'Missing Punch': (r.WorkLocation === 'Office' && !r.OdooPunchIn) ? 'Yes' : '',
    }))
    .sort((a, b) => a.EmployeeID - b.EmployeeID || a.Date.localeCompare(b.Date));
  const nameById = {}; for (const e of F.employees) nameById[e.id] = (F.identity[e.id] && F.identity[e.id].name) || e.name;
  const permRows = [], compRows = [];
  for (const key in perms) { const [id, date] = key.split('|');
    for (const p of perms[key]) {
      const row = { Key: id + '|' + date, Date: date, Day: dayName(date), Name: nameById[+id] || '', EmployeeID: +id,
        Type: p.type, From: clock12(p.fromMin), To: clock12(p.toMin),
        Duration: p.hours != null ? p.hours : '', Status: p.status, Approved: p.approved ? 'Yes' : 'No', Covers: p.covers };
      (p.kind === 'comp' ? compRows : permRows).push(row);
    }
  }
  permRows.sort((a, b) => a.EmployeeID - b.EmployeeID || a.Date.localeCompare(b.Date));
  compRows.sort((a, b) => a.EmployeeID - b.EmployeeID || a.Date.localeCompare(b.Date));
  const rwb = XLSX.utils.book_new();
  const radd = (n, rows) => XLSX.utils.book_append_sheet(rwb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: 'no rows' }]), n);
  radd('Odoo_Fingerprints_Ready', fingerRows);
  radd('Permissions_Ready', permRows);
  radd('Comp_Ready', compRows);
  const READY_OUT = OUT_XLSX.replace(/[^/\\]+$/, 'Odoo_Permission_Comp_Ready.xlsx');
  XLSX.writeFile(rwb, READY_OUT);
  console.log('wrote READY deliverable: ' + READY_OUT + ' (fingerprints ' + fingerRows.length + ', permissions ' + permRows.length + ', comp ' + compRows.length + ')');

  // ===== summary =====
  const uniqEmp = new Set(records.map(r => r.EmployeeID)).size;
  const sum = {
    totalRecords: records.length, uniqueEmployees: uniqEmp,
    distinctRawCodes: Object.keys(mapAudit).length, unmappedCodes: mapAuditRows.filter(r => r.mapped === 'NO').length,
    wfhRecords: wfhAll.length, hrActionCases: hr.length, excludedValidCases: excludedValid.length, manualReviewCases: manual.length,
    permissionApprovedCovered: records.filter(r => r.PermApproved === 'Yes').length, pendingPermissionCases: records.filter(r => /Pending permission/.test(r.ManualReview)).length,
    completedHoursValid: records.filter(r => /completed required/i.test(r.Disposition)).length, dataQualityIssues: dq.length, horizon,
  };
  fs.writeFileSync(SCRATCH + '/summary.json', JSON.stringify(sum, null, 2));
  // slim per-day dump keyed by id|date, for diffing against the user's manual Shift-sheet answer key
  fs.writeFileSync(SCRATCH + '/records.json', JSON.stringify(records.map(r => ({
    id: r.EmployeeID, date: r.Date, code: r.NormalizedCode, wfh: r.WFHStatus, disp: r.Disposition,
    sysLogin: r.FinalSysLogin, sysLogout: r.FinalSysLogout, src: r.FinalSysSource,
    rawLate: r._rawLate, rawEarly: r._rawEarly, effLate: r._effLate, effEarly: r._effEarly, hr: r.HRActionRequired,
  }))));
  // live-ingest payload (raw minutes → roster_days) for recon-ingest.js
  fs.writeFileSync(SCRATCH + '/ingest.json', JSON.stringify(records.map(r => r._ingest)));
  console.log('\n=== BUILD SUMMARY ===');
  for (const k in sum) console.log('  ' + k + ': ' + sum[k]);
  console.log('\nWFH HR ACTION cases (' + hr.length + '):');
  for (const r of hr.slice(0, 40)) console.log('  ' + r.Date + ' ' + r.Day + ' | ' + r.Name + ' (' + r.EmployeeID + ') ' + r.Function + ' | ' + r.NormalizedCode + ' sched ' + r.SchedStart + '-' + r.SchedEnd + ' | login ' + r.FinalSysLogin + ' out ' + r.FinalSysLogout + ' | late ' + r.LoginDelay + ' early ' + r.EarlyOut + ' | ' + r.SysConfidence);
  console.log('\nwrote ' + OUT_XLSX + ' (' + (fs.statSync(OUT_XLSX).size / 1024).toFixed(0) + ' KB, 16 sheets)');
};
