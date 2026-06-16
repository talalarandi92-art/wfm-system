import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { reconcileDay, roundOt, ReconResult } from './recon.engine';

/* ── pure parse helpers (ported from the verified pipeline) ───────────────── */
// Maternity / reduced-hours staff: leave 2h before shift end (effective 7h). Their
// early departure is APPROVED — it must not count as early-out or lower conformance.
// (Keyed by normalised name; extend as HR confirms more.)
const MATERNITY_EARLY_ALLOWANCE_MIN = 120;
const MATERNITY_7H = new Set(['haya mohanna', 'shaima saoud']);
const norm = (s: any) => String(s ?? '').trim().toLowerCase();
const pad = (n: number) => String(n).padStart(2, '0');
// Collapse internal double-spaces so one person isn't split into two identities
// ("Ali  Hamed" vs "Ali Hamed") — which would fragment search, grouping and dashboards.
const cleanName = (s: any, id: string) => (String(s ?? '').replace(/\s+/g, ' ').trim() || id);

/** time-of-day → minutes. Fractional-day number (0.9166=22:00), "HH:MM[:SS]", or null. */
export function tod(v: any): number | null {
  if (typeof v === 'number' && v >= 0 && v < 2) return Math.round((v % 1) * 1440);
  const m = String(v).match(/^(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}
const serialToYmd = (n: number) => {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const dmyToYmd = (s: any) => { const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${pad(+m[2])}-${pad(+m[1])}` : null; };
const dmyTime = (s: any) => {
  const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)?/i);
  if (!m) return null;
  let h = +m[4]; if (m[7]) { const pm = /pm/i.test(m[7]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return { ymd: `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`, min: h * 60 + (+m[5]) };
};
const serialDateTime = (n: number) => ({ ymd: serialToYmd(Math.floor(n)), min: Math.round((n - Math.floor(n)) * 1440) });

interface SysWin { start: number | null; end: number | null; }

export interface ReconRow extends ReconResult {
  employeeId: string; name: string; func: string; date: string;
  email?: string; gender?: string; teamManager?: string; teamGroup?: string;
  shiftStartMin: number | null; shiftEndMin: number | null;
  shiftCode?: string; attendanceCode?: string; shiftStart2Min?: number | null; shiftEnd2Min?: number | null;
  punchInMin: number | null; punchOutMin?: number | null;
  systemStartMin: number | null; systemEndMin?: number | null;
  systemStart2Min?: number | null; systemEnd2Min?: number | null;
  dayType?: string;
  permissionType?: string; permissionFrom?: string; permissionTo?: string; permissionStatus?: string;
  // the analyst's manual values (from Shifts), in minutes — null when not filled
  manualSysLate: number | null; manualSysEarly: number | null;
  manualPunchLate: number | null; manualOt: number | null;
}

/** fractional-day duration → minutes, or null for blank/non-numeric. */
function durMin(v: any): number | null {
  if (typeof v === 'number') return Math.round(v * 1440);
  return null;
}

/**
 * Attendance reconciliation pipeline. Merges Odoo punch + Ameyo + Sprinklr +
 * approved Permissions/Comp against the schedule (Shifts) and applies the rules
 * engine. Identity anchored on Employee ID via a Shifts-derived crosswalk;
 * external (non-Boutiqaat) Sprinklr agents are dropped.
 */
@Injectable()
export class ReconService {
  private readonly logger = new Logger(ReconService.name);
  // In-memory cache of the full reconciliation result. The source exports are static
  // within a session, but parsing them (Ameyo CSV alone is ~72MB) takes 30-60s — so
  // the first page load pays it once and every load after is instant. Keyed by the
  // source dir + schedule file; only the un-overridden (controller) path is cached.
  private cache = new Map<string, { at: number; val: { summary: any; rows: ReconRow[]; unmapped: string[] } }>();
  private static readonly CACHE_TTL_MS = 30 * 60 * 1000;
  /** Drop the cached reconciliation — call after new source files are uploaded so the
   *  next run re-parses the fresh data. */
  clearCache(): void { this.cache.clear(); }

  private rows(file: string, sheet?: string): any[] {
    const wb = XLSX.readFile(file);
    const ws = sheet ? wb.Sheets[sheet] : wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: '' });
  }
  private raw(file: string, sheet?: string): any[][] {
    const wb = XLSX.readFile(file);
    const ws = sheet ? wb.Sheets[sheet] : wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
  }
  private find(dir: string, re: RegExp): string | null {
    const f = fs.readdirSync(dir).find(x => re.test(x));
    return f ? path.join(dir, f) : null;
  }
  /** ALL files in dir matching the pattern (for multi-month uploads that accumulate). */
  private findAll(dir: string, re: RegExp): string[] {
    try { return fs.readdirSync(dir).filter(x => re.test(x) && !x.startsWith('~$')).map(x => path.join(dir, x)); } catch { return []; }
  }

  /**
   * Run reconciliation reading the source files from `dir` (+ schedule workbook).
   * `offOverride` (optional) is a set of `${id}|${ymd}` keys that must be treated
   * as OFF regardless of the planned shift — used to test pure OT-computation
   * accuracy against the analyst's own attendance (ATT) truth.
   */
  run(dir: string, scheduleFile: string, offOverride?: Set<string>): { summary: any; rows: ReconRow[]; unmapped: string[] } {
    const cacheKey = `${dir}|${scheduleFile}`;
    if (!offOverride) {
      const hit = this.cache.get(cacheKey);
      if (hit && Date.now() - hit.at < ReconService.CACHE_TTL_MS) return hit.val;
    }
    const t0 = Date.now();
    // 1. crosswalk + schedule from Shifts
    const shiftsRows = this.rows(scheduleFile, 'Shifts');
    const byUserId = new Map<string, string>(), byEmail = new Map<string, string>(), empInfo = new Map<string, { name: string; func: string; gender?: string; teamManager?: string; team?: string; email?: string }>();
    // sched is per (employee, day): besides the shift it now carries the
    // PERIOD-ACCURATE identity (function/team/manager/gender) read from THAT day's
    // Shifts row — because managers reassign over the year (e.g. Aya Ruiz → Talal
    // Arandi in April). A single global map would freeze each person to their
    // January manager and show a stale org for June.
    const sched = new Map<string, { start: number | null; end: number | null; code: string; start2: number | null; end2: number | null; mSysLate: number | null; mSysEarly: number | null; mPunchLate: number | null; mOt: number | null; name: string; func: string; gender: string; team: string; teamManager: string; email: string }>();

    // Merge duplicate employee IDs: an intern (number starting 6xxxx) who becomes
    // full-time gets a NEW number (1xxxx) on the new contract. Group by corporate
    // handle (User ID / email-local); canonical = newest full-time (1xxxx) else the
    // newest 6xxx. Old IDs alias to the canonical so every source merges into one
    // person. (Old↔new map is exported separately for historical search.)
    const idGroups = new Map<string, Set<string>>();
    for (const r of shiftsRows) {
      const id = String(r['ID'] ?? '').trim(); if (!/^\d+$/.test(id)) continue;
      const key = norm(r['User ID']) || norm(r['Email']).split('@')[0]; if (!key) continue;
      if (!idGroups.has(key)) idGroups.set(key, new Set());
      idGroups.get(key)!.add(id);
    }
    const alias = new Map<string, string>();
    for (const ids of idGroups.values()) {
      if (ids.size < 2) continue;
      const arr = [...ids]; const full = arr.filter(x => x.startsWith('1')).sort((a, b) => +b - +a);
      const canon = full[0] || arr.slice().sort((a, b) => +b - +a)[0];
      for (const x of arr) if (x !== canon) alias.set(x, canon);
    }
    const canonical = (id: string) => alias.get(id) || id;

    for (const r of shiftsRows) {
      const id = canonical(String(r['ID'] ?? '').trim()); if (!/^\d+$/.test(id)) continue;
      const uid = norm(r['User ID']), email = norm(r['Email']);
      if (uid) byUserId.set(uid, id);
      if (email) { byEmail.set(email, id); if (email.includes('@')) byUserId.set(email.split('@')[0], id); }
      if (!empInfo.has(id)) empInfo.set(id, { name: cleanName(r['Name'], id), func: String(r['Function'] ?? ''), gender: String(r['Gender'] ?? ''), teamManager: String(r['Team Manager'] ?? ''), team: String(r['Team'] ?? ''), email: String(r['Email'] ?? '') });
      const ymd = typeof r['Date'] === 'number' ? serialToYmd(r['Date']) : dmyToYmd(r['Date']);
      if (ymd) sched.set(`${id}|${ymd}`, {
        start: tod(r['Shift Start Time']), end: tod(r['Shift End Time']),
        code: String(r['Shift'] ?? '').trim(),
        start2: tod(r['Shift Start Time 2']), end2: tod(r['Shift End Time 2']),
        mSysLate: durMin(r['Late In System Duration']), mSysEarly: durMin(r['Early Out System Duration']),
        mPunchLate: durMin(r['Punch Late In']), mOt: durMin(r['OT']),
        // period-accurate identity from THIS day's row
        name: cleanName(r['Name'], id), func: String(r['Function'] ?? ''), gender: String(r['Gender'] ?? ''),
        team: String(r['Team'] ?? ''), teamManager: String(r['Team Manager'] ?? ''), email: String(r['Email'] ?? ''),
      });
    }
    const idFromUser = (u: any) => byUserId.get(norm(u)) ?? null;
    const idFromEmail = (e: any) => { const n = norm(e); if (byEmail.has(n)) return byEmail.get(n)!; if (n.endsWith('@boutiqaat.com')) return byUserId.get(n.split('@')[0]) ?? null; return null; };

    // 2. Odoo punch
    const odoo = new Map<string, { punchIn: number | null; punchOut: number | null; status: string }>();
    const odooFile = this.find(dir, /Att Summary/i);
    if (odooFile) for (const r of this.raw(odooFile)) {
      const code = canonical(String(r[0] ?? '').trim()); if (!/^\d+$/.test(code)) continue;
      const ymd = dmyToYmd(r[1]); if (!ymd) continue;
      // Odoo Att Summary puts the day STATUS ("OFF SHIFT", "WFH", "Permission",
      // holiday/leave names) in the last non-empty cell — NOT the punch column.
      // Office workers have punch times in r[3]/r[4]; status-only rows are blank there.
      const tail = r.slice(2).map((x: any) => String(x ?? '').trim()).filter(Boolean);
      const status = tail.length ? tail[tail.length - 1] : '';
      odoo.set(`${code}|${ymd}`, { punchIn: tod(r[3]), punchOut: tod(r[4]), status });
    }

    // 2b. Sprinklr AGENT-OCCUPANCY productivity (LoginLogout.xlsx export).
    // For social/email/chat agents the raw login→logout span bleeds (forgotten
    // sessions show 24h). The "Time spent in Available status" column is the
    // bleed-proof real working time, so OT for these agents is derived from
    // productive DURATION, not session timestamps.
    //   cols: 0 Date · 1 Email · 5 Available · 11 WorkingOnCase · 13 ManualOutbound
    const sprkProd = new Map<string, { workedMin: number; onCaseMin: number; breakMin: number; loginMin: number }>();
    const serialYmd = (n: number) => { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000); const p = (x: number) => String(x).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`; };
    // Read ALL Sprinklr occupancy exports (one per month) so uploads accumulate.
    for (const sprkFile of this.findAll(dir, /LoginLogout.*\.xlsx$/i)) {
      const srows = this.raw(sprkFile);
      for (let i = 3; i < srows.length; i++) {
        const r = srows[i]; if (typeof r[0] !== 'number') continue;
        const id = idFromEmail(r[1]); if (!id) continue;
        const ymd = serialYmd(r[0]);
        const avail = (Number(r[5]) || 0) * 1440;        // Available (= ready + handling)
        const manual = (Number(r[13]) || 0) * 1440;       // Manual Outbound (active outbound work)
        const onCase = (Number(r[11]) || 0) * 1440;       // Time working on Case = actual handling (bleed-proof)
        const brk = ((Number(r[12]) || 0) + (Number(r[14]) || 0) + (Number(r[15]) || 0) + (Number(r[16]) || 0)) * 1440;
        const loginMin = Math.round(((Number(r[2]) || 0) % 1) * 1440);   // first login time-of-day
        const key = `${id}|${ymd}`;
        const prev = sprkProd.get(key);
        sprkProd.set(key, { workedMin: (prev?.workedMin || 0) + avail + manual, onCaseMin: (prev?.onCaseMin || 0) + onCase, breakMin: (prev?.breakMin || 0) + brk, loginMin: prev ? Math.min(prev.loginMin, loginMin) : loginMin });
      }
    }
    const isSocialFunc = (f: string) => /sm|mail|social|chat|\bch\b|\bwa\b|whatsapp|nps/i.test(f || '');
    // Bleed-safe productive minutes for a social agent's day. "Available" usually
    // excludes break and is realistic, but for some agents an idle/forgotten session
    // inflates it past a human day — in that case fall back to actual case-handling
    // time (onCase), which never bleeds. Returns [minutes, bledFallback?].
    const SOC_MAX_MIN = 14 * 60;
    const sprkWorked = (s: { workedMin: number; onCaseMin: number }): [number, boolean] =>
      s.workedMin <= SOC_MAX_MIN ? [Math.round(s.workedMin), false] : [Math.round(s.onCaseMin), true];

    // 3+4. system = Ameyo ∪ Sprinklr, stored as activity SEGMENTS [{s,e}] per
    // (id, calendar-day). Forgotten sessions (huge open logouts, or a stray
    // pre-dawn session from the previous shift) are removed centrally by
    // clustering: the real work window is the densest cluster of activity, so a
    // bled segment far from the bulk is dropped — fixing OT/late/duration at once.
    const sysSeg = new Map<string, { s: number; e: number }[]>();
    const addSeg = (id: string, ymd: string, s: number, e: number) => {
      const k = `${id}|${ymd}`; let a = sysSeg.get(k); if (!a) { a = []; sysSeg.set(k, a); }
      if (e >= s) a.push({ s, e }); else { a.push({ s, e: 1439 }); const nk = `${id}|${nextDay(ymd)}`; let b = sysSeg.get(nk); if (!b) { b = []; sysSeg.set(nk, b); } b.push({ s: 0, e }); }
    };
    const nextDay = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d + 1)); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; };
    const unmapped = new Set<string>();
    const MAX_SESSION_MIN = 16 * 60;   // longer than this = a forgotten session → discard
    // Read ALL Ameyo session exports (one per month) so uploads accumulate.
    for (const ameyoFile of this.findAll(dir, /AGENT_Session_Details.*Ameyo|Ameyo.*Session/i)) for (const r of this.rows(ameyoFile)) {
      const id = idFromUser(r['User ID']); if (!id) { if (r['User ID']) unmapped.add(String(r['User ID'])); continue; }
      const rs = dmyTime(r['Ready Start Time']); const re = dmyTime(r['Ready End Time']);
      if (rs && re && re.ymd === rs.ymd && (re.min - rs.min) >= 0 && (re.min - rs.min) <= MAX_SESSION_MIN) addSeg(id, rs.ymd, rs.min, re.min);
      else if (rs) addSeg(id, rs.ymd, rs.min, rs.min);   // point activity
    }
    // Sprinklr work blocks from the agent-occupancy export (active time = Available
    // + Manual Outbound, bleed-safe). Positioned at the login time so they MERGE with
    // Ameyo segments in the cluster: an agent who finishes their voice shift on Ameyo
    // then continues on Sprinklr gets BOTH counted (the user's "9h Ameyo + 2h Sprinklr
    // = 11h" rule). Overlapping time with Ameyo is absorbed by the union — never
    // double-counted. The raw login→logout session is deliberately NOT used (it bleeds
    // when agents leave Sprinklr open overnight).
    for (const [key, sp] of sprkProd) {
      const [active] = sprkWorked(sp);
      if (active <= 0) continue;
      const [id, ymd] = key.split('|');
      const s = sp.loginMin; const e = s + active;
      if (e <= 1439) addSeg(id, ymd, s, e);
      else { addSeg(id, ymd, s, 1439); addSeg(id, nextDay(ymd), 0, Math.min(1439, e - 1440)); }
    }
    // Densest activity cluster (segments split by gaps > 4h) = the real work block.
    const CLUSTER_GAP = 240;
    const cluster = (segs: { s: number; e: number }[], filter?: (s: number) => boolean): { start: number; end: number } | null => {
      let a = (filter ? segs.filter(x => filter(x.s)) : segs).slice().sort((x, y) => x.s - y.s);
      if (!a.length) return null;
      const blocks: { s: number; e: number }[] = []; let cur = { s: a[0].s, e: a[0].e };
      for (let i = 1; i < a.length; i++) { if (a[i].s - cur.e <= CLUSTER_GAP) cur.e = Math.max(cur.e, a[i].e); else { blocks.push(cur); cur = { s: a[i].s, e: a[i].e }; } }
      blocks.push(cur);
      const best = blocks.reduce((b1, b2) => (b2.e - b2.s) > (b1.e - b1.s) ? b2 : b1);
      return { start: best.s, end: best.e };
    };
    // Total ACTIVE worked minutes for a day = duration of the UNION of all activity
    // segments (Ameyo ready ∪ Sprinklr active). Overlapping time counts once; separate
    // periods add up. This is "combine both systems" without double-counting.
    const mergedActiveMin = (id: string, date: string): number => {
      const segs = (sysSeg.get(`${id}|${date}`) || []).slice().sort((a, b) => a.s - b.s);
      if (!segs.length) return 0;
      let total = 0, cur = { ...segs[0] };
      for (let i = 1; i < segs.length; i++) {
        if (segs[i].s <= cur.e) cur.e = Math.max(cur.e, segs[i].e);
        else { total += cur.e - cur.s; cur = { ...segs[i] }; }
      }
      return total + (cur.e - cur.s);
    };
    // Split the day's system activity into distinct sessions (gap > 90 min = a new
    // session). Returns the first and second meaningful blocks — block 2 is the
    // separate "logged out then came back" / after-shift continuation (login2/logout2).
    const systemBlocks = (id: string, date: string): { b1: { s: number; e: number } | null; b2: { s: number; e: number } | null } => {
      const segs = (sysSeg.get(`${id}|${date}`) || []).slice().sort((a, b) => a.s - b.s);
      if (!segs.length) return { b1: null, b2: null };
      const GAP = 90; const blocks: { s: number; e: number }[] = []; let cur = { ...segs[0] };
      for (let i = 1; i < segs.length; i++) {
        if (segs[i].s - cur.e <= GAP) cur.e = Math.max(cur.e, segs[i].e);
        else { blocks.push(cur); cur = { ...segs[i] }; }
      }
      blocks.push(cur);
      const sig = blocks.filter(b => b.e - b.s >= 15).sort((a, b) => a.s - b.s);
      return { b1: sig[0] ?? null, b2: sig[1] ?? null };
    };
    const sysWindow = (id: string, date: string, start: number | null, end: number | null): SysWin => {
      const day = sysSeg.get(`${id}|${date}`) || [];
      const cross = start != null && end != null && end < start;
      if (cross) {
        const evening = cluster(day, s => s >= 720) || cluster(day);                 // evening block on D
        const nxt = sysSeg.get(`${id}|${nextDay(date)}`) || [];
        const morning = cluster(nxt, s => s <= (end as number) + 180) || cluster(nxt); // morning block on D+1
        return { start: evening ? evening.start : null, end: morning ? morning.end : (evening ? evening.end : null) };
      }
      const c = cluster(day);
      return { start: c ? c.start : null, end: c ? c.end : null };
    };

    // 5. approved permissions + comp (Total + Extra)
    const perm = new Map<string, { late: number; early: number; type?: string; from?: string; to?: string; status?: string }>();
    const permLabel = (t: string) => /late/i.test(t) ? 'Late-in' : /out\s*\/\s*in|in\s*\/\s*out/i.test(t) ? 'Out/In' : /early/i.test(t) ? 'Early-out' : t;
    // Only an APPROVED permission exempts late/early minutes. Refused/pending ones are
    // still recorded + shown (status visible) but grant no exemption.
    const addPerm = (id: string, ymd: string, type: string, hrs: number, status: string, from?: string, to?: string) => {
      const k = `${id}|${ymd}`; const c = perm.get(k) || { late: 0, early: 0 }; const min = Math.round(hrs * 60);
      const approved = /approved/i.test(status);
      if (approved) { if (/late/i.test(type)) c.late += min; if (/early|out/i.test(type)) c.early += min; }
      c.type = permLabel(type); c.status = approved ? 'Approved' : /reject|refus|declin/i.test(status) ? 'Refused' : (String(status).trim() || 'Pending');
      if (from) c.from = String(from).trim(); if (to) c.to = String(to).trim();
      perm.set(k, c);
    };
    for (const re of [/Attendance Permissions/i, /Compensatory/i]) {
      const f = this.find(dir, re); if (!f) continue;
      for (const r of this.rows(f, 'Sheet2')) {
        const m = String(r['Employee']).match(/\[\s*(\d+)\s*\]/); if (!m) continue;
        const ymd = typeof r['Date'] === 'number' ? serialToYmd(r['Date']) : dmyToYmd(r['Date']); if (!ymd) continue;
        addPerm(canonical(m[1]), ymd, String(r['Permission Type'] ?? r['Type'] ?? ''), (parseFloat(r['Total Hours']) || 0) + (parseFloat(r['Extra Hours']) || 0), String(r['Status'] ?? ''), r['Time From'], r['Time To']);
      }
    }

    // 6. merge + reconcile
    const rows: ReconRow[] = [];
    let office = 0, wfh = 0, absent = 0, anomaly = 0, lateDays = 0, deduction = 0, otDays = 0;
    for (const [k, sc] of sched) {
      const [id, date] = k.split('|');
      const od = odoo.get(k) || {} as any; const fallback = empInfo.get(id) || { name: id, func: '', gender: '', teamManager: '', team: '', email: '' };
      // Prefer the identity recorded on THIS day's row (period-accurate manager/func);
      // fall back to the global map only when that day's cell was blank.
      const info = {
        name: sc.name || fallback.name,
        func: sc.func || fallback.func,
        gender: sc.gender || fallback.gender,
        teamManager: sc.teamManager || fallback.teamManager,
        team: sc.team || fallback.team,
        email: sc.email || fallback.email || '',
      };
      // Odoo attendance is the authority for OFF/leave/holiday: if Odoo marks the
      // day off but the agent worked, the whole day is OT (even if Shifts shows a shift).
      // OFF authority = the SCHEDULE (Shifts: null/OFF/L/H) + the analyst's ATT
      // override. Odoo INDIVIDUAL leave ("annual leave"/"unpaid"/"off shift") is NOT
      // trusted — those records go stale (e.g. a cancelled leave HR never reverted),
      // which would turn real worked shifts into full-day OT.
      // Public HOLIDAYS (Eid/Arafat/New Year) ARE trusted from Odoo: they're
      // company-wide, and a shift worked on a holiday is fully overtime even though
      // the schedule still shows a normal shift code.
      const odooHoliday = typeof od.status === 'string' && /\barafat\b|\beid\b|new year|public holiday|national day/i.test(od.status);
      if (sc.start == null || offOverride?.has(k) || odooHoliday) {
        // Off-day / public holiday (e.g. Eid). If the agent still worked, ALL of
        // it is overtime — capture it for the OT audit rather than skipping.
        const sy = sysWindow(id, date, null, null);
        const isHoliday = odooHoliday || /^H\b|^H$|^H[0-9]/i.test(sc.code) || sc.code.toUpperCase() === 'H';
        const extraFlags: string[] = [isHoliday ? 'worked_holiday' : 'worked_off'];
        // OFF/holiday OT must be EVIDENCE-BACKED. On an off day there is no shift to
        // anchor the work, so a never-closed system session bleeds to 12-24h. Per the
        // confirmed rule: credit off-day OT only when a biometric PUNCH proves it (or,
        // in future, real contacts). System-only off-day "work" is unverifiable → flag
        // and don't pay it (the bleed entries that showed false 12h vanish).
        const MAX_OFF_WORK_MIN = 13 * 60;
        let worked = 0;
        if (od.punchIn != null && od.punchOut != null) {
          const pSpan = Math.max(0, (od.punchOut < od.punchIn ? od.punchOut + 1440 : od.punchOut) - od.punchIn);
          // A punch spanning >13h is a forgotten punch-out (bleed), not real work → reject.
          if (pSpan > MAX_OFF_WORK_MIN) { extraFlags.push('off_punch_bleed'); worked = 0; }
          else worked = pSpan;
        } else {
          // System-only off-day has no shift anchor → bleeds; unverifiable without a punch
          // (or, future, real contacts). Don't credit it.
          if (mergedActiveMin(id, date) > 0) extraFlags.push('off_work_unverified');
          worked = 0;
        }
        if (worked <= 0) continue;   // genuinely off, unverifiable, or bled → skip
        // Break rule: a full worked day on an OFF/holiday counts minus the 1h break
        // (9h worked → 8h OT). Deduct once the day is substantial.
        if (worked >= 5 * 60) worked = Math.max(0, worked - 60);
        const base = reconcileDay({ shiftStartMin: null, shiftEndMin: null, systemStartMin: sy.start ?? null, systemEndMin: sy.end ?? null, punchInMin: od.punchIn ?? null, punchOutMin: od.punchOut ?? null });
        if (worked > 0) otDays++;
        rows.push({ employeeId: id, name: info.name, email: info.email, func: info.func, gender: info.gender, teamManager: info.teamManager, teamGroup: info.team, date, shiftStartMin: null, shiftEndMin: null, shiftCode: sc.code, attendanceCode: sc.code, shiftStart2Min: sc.start2, shiftEnd2Min: sc.end2, punchInMin: od.punchIn ?? null, punchOutMin: od.punchOut ?? null, systemStartMin: sy.start ?? null, systemEndMin: sy.end ?? null, systemStart2Min: systemBlocks(id, date).b2?.s ?? null, systemEnd2Min: systemBlocks(id, date).b2?.e ?? null, dayType: odooHoliday ? 'Holiday (worked)' : 'OFF (worked)', manualSysLate: sc.mSysLate, manualSysEarly: sc.mSysEarly, manualPunchLate: sc.mPunchLate, manualOt: sc.mOt, ...base, otAfterMin: worked, otTotalMin: worked, otRoundedMin: roundOt(worked), flags: [...base.flags, ...extraFlags] });
        continue;
      }

      const sy = sysWindow(id, date, sc.start, sc.end); const pm = perm.get(k) || { late: 0, early: 0 };
      // Maternity / reduced-hours: a 2h-early departure is approved → exempt it.
      const matAllow = MATERNITY_7H.has(info.name.toLowerCase()) ? MATERNITY_EARLY_ALLOWANCE_MIN : 0;
      const res = reconcileDay({
        shiftStartMin: sc.start, shiftEndMin: sc.end,
        shiftStart2Min: sc.start2, shiftEnd2Min: sc.end2,  // split shift (Ramadan CR etc.)
        systemStartMin: sy.start ?? null, systemEndMin: sy.end ?? od.punchOut ?? null,  // punch-out fallback when system end missing
        punchInMin: od.punchIn ?? null, punchOutMin: od.punchOut ?? null,
        approvedLateMin: pm.late, approvedEarlyOutMin: pm.early + matAllow,
      });
      if (matAllow) res.flags = [...res.flags, 'maternity_7h'];
      // OT on a working day = time worked beyond shift end, measured on the COMBINED
      // system window (Ameyo ∪ Sprinklr): an agent who ends their Ameyo shift then
      // continues on Sprinklr has that tail captured by sysWindow → reconcileDay's
      // otAfter. No separate social path needed.
      // Floor-support agents work without a system (they badge in/out) — when there is
      // essentially no system activity but a biometric punch exists, measure OT on the
      // punch instead so they aren't under-counted (e.g. floor support).
      if (mergedActiveMin(id, date) < 60 && od.punchIn != null && od.punchOut != null && sc.end != null) {
        const lastEnd = sc.end2 != null ? sc.end2 : sc.end;   // split shift ends at period 2
        const cross = sc.start != null && lastEnd <= sc.start;
        const shiftEndAdj = cross ? lastEnd + 1440 : lastEnd;
        const pOut = cross && od.punchOut < (sc.start as number) ? od.punchOut + 1440 : od.punchOut;
        const punchSpan = Math.max(0, pOut - od.punchIn);
        const punchOt = Math.max(0, pOut - shiftEndAdj);
        // Guard against degenerate/bleed punches: a 1-min punch (in≈out) or a punch
        // whose cross-midnight bump yields an impossible OT (>6h) is not real work —
        // the punch device fired once or the timestamp bled. Don't credit it.
        const degenerate = punchSpan < 30 || punchOt > 6 * 60;
        if (!degenerate && punchOt > res.otAfterMin) { res.otAfterMin = punchOt; res.otTotalMin = punchOt; res.otRoundedMin = roundOt(punchOt); res.flags = [...res.flags, 'punch_based']; }
      }
      // Sick leave confirmed in Odoo → label the day "Sick Leave", not an unexplained
      // absence (the agent submitted it and HR/Odoo approved it).
      const sickConfirmed = typeof od.status === 'string' && /\bsick\b|sick leave/i.test(od.status);
      let workDayType = 'Normal';
      if (sickConfirmed) { workDayType = 'Sick Leave'; res.flags = [...res.flags, 'sick_leave']; }
      // The schedule already encodes sick/absent in the shift code itself (NS/MS/ES =
      // sick, NA/MA/EA = absent, plus SL/A). So use the schedule code AS-IS — never
      // append another suffix (that double-coded it: NS→NSS). Only when the source is
      // a plain working code AND the day went unworked do we add the suffix.
      const base = sc.code.toUpperCase();
      const alreadyCoded = /[SA]$/.test(base) || /^(OFF|WFH|H|L|SL|DL|RES|TER|COMP|A|0|TRANSFER)/.test(base) || !base;
      const attendanceCode = (res.presence === 'absent' && !alreadyCoded) ? `${sc.code}${sickConfirmed ? 'S' : 'A'}` : sc.code;
      if (res.presence === 'office') office++; else if (res.presence === 'wfh') wfh++; else if (res.presence === 'anomaly') anomaly++; else absent++;
      if (res.effectiveLateMin > 0) lateDays++;
      if (res.deductionApplies) deduction++;
      if (res.otTotalMin > 0) otDays++;
      rows.push({ employeeId: id, name: info.name, email: info.email, func: info.func, gender: info.gender, teamManager: info.teamManager, teamGroup: info.team, date, shiftStartMin: sc.start, shiftEndMin: sc.end, shiftCode: sc.code, attendanceCode, shiftStart2Min: sc.start2, shiftEnd2Min: sc.end2, punchInMin: od.punchIn ?? null, punchOutMin: od.punchOut ?? null, systemStartMin: sy.start ?? null, systemEndMin: sy.end ?? null, systemStart2Min: systemBlocks(id, date).b2?.s ?? null, systemEnd2Min: systemBlocks(id, date).b2?.e ?? null, dayType: workDayType, permissionType: pm.type, permissionFrom: pm.from, permissionTo: pm.to, permissionStatus: pm.status, manualSysLate: sc.mSysLate, manualSysEarly: sc.mSysEarly, manualPunchLate: sc.mPunchLate, manualOt: sc.mOt, ...res });
    }
    rows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name));

    // ── ABSENCE NEEDS EVIDENCE: don't assert absence we can't confirm ──
    // "absent" = no system AND no punch on a scheduled day. That is reliable ONLY for a
    // consistent puncher (office staff): when someone who punches almost every day misses
    // one, it's a real absence. But for RTA/supervisors/WFH who aren't reliably on the
    // punch device or contact systems (and during months with a missing system export,
    // e.g. June Sprinklr), "no punch + no system" does NOT prove absence. So: reclassify
    // an absent day to 'unconfirmed' (reviewable, NOT counted against the agent) unless
    // the employee is a reliable puncher (punches ≥ 70% of scheduled days).
    // Reliability = how often we OBSERVE the person at all (punch OR system). A normally-
    // observed agent (≥70% of scheduled days) who shows nothing on a day is a real absence.
    // Someone observed less than that is an uncaptured role (RTA), a WFH agent during a
    // missing-system month, or a data gap — their blank days are 'unconfirmed', not absent.
    const cap = new Map<string, { sched: number; obs: number }>();
    for (const r of rows) {
      if (r.shiftStartMin == null) continue;
      const e = cap.get(r.employeeId) || { sched: 0, obs: 0 };
      e.sched++;
      if (r.presence === 'office' || r.presence === 'wfh' || r.presence === 'anomaly') e.obs++;
      cap.set(r.employeeId, e);
    }
    let unconfirmed = 0;
    for (const r of rows) {
      if (r.presence !== 'absent') continue;
      const e = cap.get(r.employeeId);
      const obsRate = e && e.sched > 0 ? e.obs / e.sched : 0;
      if (obsRate < 0.7) {
        r.presence = 'unconfirmed';
        r.flags = [...(r.flags || []), 'uncaptured'];
        absent--; unconfirmed++;
      }
    }

    const result = {
      summary: { totalDays: rows.length, office, wfh, anomaly, absent, unconfirmed, lateDays, deductionDays: deduction, otDays, employees: empInfo.size, unmappedSources: unmapped.size },
      rows, unmapped: [...unmapped],
    };
    if (!offOverride) this.cache.set(cacheKey, { at: Date.now(), val: result });
    this.logger.log(`Reconciliation computed in ${Date.now() - t0}ms (${rows.length} rows) — cached`);
    return result;
  }

  /**
   * Compare the system's computed figures against the analyst's manual values
   * (from Shifts) to prove accuracy. Per metric: exact / close(±1m) / mismatch,
   * with mismatches split into "system found more" vs "system found less", plus
   * a sample of disagreements carrying the raw evidence so a human can judge.
   */
  compare(rows: ReconRow[], tolerance = 1) {
    const metrics: Record<string, { computed: keyof ReconRow; manual: keyof ReconRow }> = {
      systemLate: { computed: 'systemLateMin', manual: 'manualSysLate' },
      systemEarly: { computed: 'systemEarlyOutMin', manual: 'manualSysEarly' },
      punchLate: { computed: 'punchLateMin', manual: 'manualPunchLate' },
      ot: { computed: 'otTotalMin', manual: 'manualOt' },
    };
    const out: any = {}; const samples: any[] = [];
    // OT is submitted in HR 30-min blocks and counted on the after-shift system
    // time, so compare it at that level rather than raw minutes.
    const r30 = (x: number) => x > 0 ? Math.round(x / 30) * 30 : 0;
    for (const [name, m] of Object.entries(metrics)) {
      const isOt = name === 'ot';
      let n = 0, exact = 0, close = 0, more = 0, less = 0;
      for (const r of rows) {
        const manRaw = r[m.manual] as number | null; if (manRaw == null) continue;   // only where analyst filled it
        const man = isOt ? r30(manRaw) : manRaw;
        const comp = isOt ? r30(r.otAfterMin) : (r[m.computed] as number); n++;
        const diff = comp - man;
        if (diff === 0) exact++;
        else if (Math.abs(diff) <= tolerance) close++;
        else {
          if (diff > 0) more++; else less++;
          if (samples.length < 60) samples.push({
            metric: name, employeeId: r.employeeId, name: r.name, date: r.date,
            computed: comp, manual: man, diff,
            evidence: { shiftStart: r.shiftStartMin, systemStart: r.systemStartMin, punchIn: r.punchInMin, presence: r.presence },
          });
        }
      }
      out[name] = { compared: n, exact, close, matchPct: n ? Math.round(1000 * (exact + close) / n) / 10 : 0, systemFoundMore: more, systemFoundLess: less };
    }
    return { metrics: out, sampleMismatches: samples };
  }
}
