import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { shiftCategoryFromCode } from '../../common/shift-category';
import { normalizeShiftCode } from '../../common/shift-normalize';
import { functionAllowsFemaleLate } from '../schedule-generator/generator.types';

// ── Shift code → marker + times lookup ──────────────────────────────────────
// Used by editCell to resolve a typed shift code to DB values
const SHIFT_CODE_MAP: Record<string, { marker: string; start: string | null; end: string | null; wfh?: boolean }> = {
  // Morning family
  M:    { marker: 'present', start: '07:00:00', end: '16:00:00' },
  AM:   { marker: 'present', start: '07:00:00', end: '15:00:00' },
  M20:  { marker: 'present', start: '08:00:00', end: '16:00:00' },
  M7:   { marker: 'present', start: '07:00:00', end: '14:00:00' },
  // Between B family
  B:    { marker: 'present', start: '09:00:00', end: '18:00:00' },
  B20:  { marker: 'present', start: '10:00:00', end: '18:00:00' },
  B7:   { marker: 'present', start: '09:00:00', end: '16:00:00' },
  // Between C family
  C:    { marker: 'present', start: '11:00:00', end: '20:00:00' },
  C20:  { marker: 'present', start: '12:00:00', end: '20:00:00' },
  C7:   { marker: 'present', start: '11:00:00', end: '18:00:00' },
  // Night N family
  N:    { marker: 'present', start: '13:00:00', end: '22:00:00' },
  N20:  { marker: 'present', start: '14:00:00', end: '22:00:00' },
  N7:   { marker: 'present', start: '15:00:00', end: '22:00:00' },
  // Night E family (crosses midnight)
  E:    { marker: 'present', start: '16:00:00', end: '01:00:00' },
  E20:  { marker: 'present', start: '16:00:00', end: '00:00:00' },
  E7:   { marker: 'present', start: '16:00:00', end: '23:00:00' },
  // Night EE family (deep night)
  EE:   { marker: 'present', start: '18:00:00', end: '03:00:00' },
  EE20: { marker: 'present', start: '18:00:00', end: '02:00:00' },
  EE7:  { marker: 'present', start: '18:00:00', end: '01:00:00' },
  // Midnight MD family
  MD:   { marker: 'present', start: '22:00:00', end: '07:00:00' },
  MD20: { marker: 'present', start: '22:00:00', end: '06:00:00' },
  MD7:  { marker: 'present', start: '22:00:00', end: '05:00:00' },
  // Midnight MN family
  MN:   { marker: 'present', start: '23:00:00', end: '08:00:00' },
  MN20: { marker: 'present', start: '00:00:00', end: '08:00:00' },
  MN7:  { marker: 'present', start: '23:00:00', end: '06:00:00' },
  // WFH variants — same times/category as the base code, flagged is_wfh
  'WFH-M': { marker: 'present', start: '07:00:00', end: '16:00:00', wfh: true },
  'WFH-B': { marker: 'present', start: '09:00:00', end: '18:00:00', wfh: true },
  'WFH-C': { marker: 'present', start: '11:00:00', end: '20:00:00', wfh: true },
  'WFH-N': { marker: 'present', start: '13:00:00', end: '22:00:00', wfh: true },
  'WFH-E': { marker: 'present', start: '16:00:00', end: '01:00:00', wfh: true },
  // Non-working
  OFF:  { marker: 'off',     start: null, end: null },
  L:    { marker: 'leave',   start: null, end: null },
  DL:   { marker: 'leave',   start: null, end: null }, // death leave
  UPL:  { marker: 'leave',   start: null, end: null }, // unpaid leave
  SL:   { marker: 'sick',    start: null, end: null },
  A:    { marker: 'absent',  start: null, end: null }, // HR-normalized absence (no base shift recorded)
  ABS:  { marker: 'absent',  start: null, end: null }, // LEGACY input alias only — displays/exports as A
  H:    { marker: 'holiday', start: null, end: null },
};

// ── Shift category derived from scheduled_start ──────────────────────────────
// Source of truth: CC Schedule 26 Timing sheet
//
// REAL 4 categories (as defined in the workbook's own summary rows 7-21):
//   Morning  → M, AM, CCNO         → start 06:00–08:59
//   Between  → B, C                → start 09:00–12:59
//   Night    → N, E, EE            → start 13:00–21:59  (E/EE cross midnight — still "Night")
//   Midnight → MD, MN              → start 22:00–05:59
//
// Suffix rules from Timing sheet:
//   (none)/9 = 9h agent shift   |  20 = 8h supervisor shift (starts 1h later)
//   7        = 7h short shift   |  S  = sick marker on that shift
//   A        = absence marker   |  R  = Ramadan variant
//   WFH-X    = work from home
function deriveShiftLabel(
  start: string | null,
  end: string | null,
  marker: string,
  isWfh: boolean,
): { code: string; category: string; color: string; label: string } {
  // ── Non-working markers ───────────────────────────────────────────────────
  if (marker === 'off')     return { code: 'OFF', category: 'off',     color: '#475569', label: 'إجازة أسبوعية' };
  if (marker === 'leave')   return { code: 'L',   category: 'leave',   color: '#7c3aed', label: 'إجازة سنوية'   };
  if (marker === 'sick')    return { code: 'SL',  category: 'sick',    color: '#dc2626', label: 'إجازة مرضية'   };
  if (marker === 'absent')  return { code: 'A',   category: 'absent',  color: '#ef4444', label: 'غياب'           }; // HR code is A — 'ABS' was never an official code
  if (marker === 'holiday') return { code: 'H',   category: 'holiday', color: '#0891b2', label: 'عطلة رسمية'    };

  // ── No-data / unknown — empty cell, not "—" ─────────────────────────────
  if (marker === 'unknown' || marker === 'no_data' || marker === '')
    return { code: '', category: 'no_data', color: 'transparent', label: '' };

  if (!start) return { code: '', category: 'no_data', color: 'transparent', label: '' };

  const h   = parseInt(start.split(':')[0], 10);
  const wfh = isWfh ? '-WFH' : '';

  // ── MORNING: 06:00 – 08:59 (M, AM, CCNO family) ──────────────────────────
  // Real shifts: AM 07-15, M 07-16, M20 08-16, CCNO 09-17, M7 07-14, M7-3 07-15
  if (h >= 6 && h < 9)
    return { code: `M${wfh}`,  category: 'morning', color: '#0ea5e9', label: isWfh ? 'صباحي (بيت)' : 'صباحي'  };

  // ── BETWEEN-B: 09:00 – 10:59 (B family) ─────────────────────────────────
  // Real shifts: B 09-18, B9 09-18, B20 10-18, B7 09-16, CCNO 09-17
  if (h >= 9 && h < 11)
    return { code: `B${wfh}`,  category: 'between', color: '#f59e0b', label: isWfh ? 'بين (بيت)'   : 'بين'     };

  // ── BETWEEN-C: 11:00 – 12:59 (C family) ─────────────────────────────────
  // Real shifts: C 11-20, C9 11-20, C20 12-20, C7 11-18
  if (h >= 11 && h < 13)
    return { code: `C${wfh}`,  category: 'between', color: '#f97316', label: isWfh ? 'وسط (بيت)'   : 'وسط'     };

  // ── NIGHT-N: 13:00 – 15:59 (N family) ───────────────────────────────────
  // Real shifts: N 13-22, N9 13-22, N20 14-22, N7 15-22, WFH-N 14-22
  if (h >= 13 && h < 16)
    return { code: `N${wfh}`,  category: 'night',   color: '#8b5cf6', label: isWfh ? 'مسائي (بيت)' : 'مسائي'   };

  // ── NIGHT-E: 16:00 – 17:59 (E family — crosses midnight, still "Night") ──
  // Real shifts: E 16-01, E9 16-01, E20 16-00, E7 16-23, WFH-E 16-00
  if (h >= 16 && h < 18)
    return { code: `E${wfh}`,  category: 'night',   color: '#a78bfa', label: isWfh ? 'ليلي (بيت)'  : 'ليلي'    };

  // ── NIGHT-EE: 18:00 – 21:59 (EE family — deep night, still "Night") ─────
  // Real shifts: EE 18-02, EE9 18-03, EE20 18-03, EE7 18-01
  if (h >= 18 && h < 22)
    return { code: `EE${wfh}`, category: 'night',   color: '#7c3aed', label: isWfh ? 'عميق (بيت)'  : 'عميق'    };

  // ── MIDNIGHT-MD: 22:00 – 22:59 (MD family) ───────────────────────────────
  // Real shifts: MD 22-07, MD9 22-07, MD20 22-06, MD7 22-05, WFH-MD 22-06
  if (h === 22)
    return { code: `MD${wfh}`, category: 'midnight', color: '#6366f1', label: isWfh ? 'منتصف الليل (بيت)' : 'منتصف الليل' };

  // ── MIDNIGHT-MN: 23:00 – 05:59 (MN family + true overnight) ─────────────
  // Real shifts: MN 23-08, MN9 23-08, MN20 00-08, MN7 23-06, WFH-MN 00-08
  return { code: `MN${wfh}`, category: 'midnight', color: '#4f46e5', label: isWfh ? 'فجر (بيت)' : 'فجر' };
}

// minutes-of-day → "HH:MM" so a corrected roster_days.shift_start_min can feed deriveShiftLabel unchanged.
function minToHHMM(m: number): string {
  const t = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

// "HH:MM" / "HH:MM:SS" → minutes-of-day (used by rest math + roster_days dual-write).
function timeStrToMin(t: string): number {
  const [h, m] = t.split(':');
  return parseInt(h, 10) * 60 + parseInt(m ?? '0', 10);
}

@Injectable()
export class ScheduleService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // ── Week helpers ────────────────────────────────────────────────────────────
  private getWeekRange(weekStart: string, weeks = 1): { from: string; to: string } {
    const d = new Date(weekStart);
    const to = new Date(d);
    to.setDate(d.getDate() + weeks * 7 - 1);
    const fmt = (x: Date) =>
      `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    return { from: fmt(d), to: fmt(to) };
  }

  private fmtDate(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Compute the Saturday that starts the week containing `date` */
  static weekStartFor(dateStr: string): string {
    const d = new Date(dateStr);
    const day = d.getDay(); // 0=Sun…6=Sat
    const diffToSat = (day - 6 + 7) % 7;
    const sat = new Date(d);
    sat.setDate(d.getDate() - diffToSat);
    return `${sat.getFullYear()}-${String(sat.getMonth() + 1).padStart(2, '0')}-${String(sat.getDate()).padStart(2, '0')}`;
  }

  // ── Grid ────────────────────────────────────────────────────────────────────
  async getGrid(
    tenantId: string,
    weekStart: string,
    functionId?: string,
    teamId?: string,
    weeks = 1,
  ) {
    const safeWeeks = Math.min(Math.max(weeks, 1), 4); // clamp 1–4
    const { from, to } = this.getWeekRange(weekStart, safeWeeks);

    // Build N date columns (Sat → last day of period)
    const dates: string[] = [];
    const cur = new Date(from);
    const totalDays = safeWeeks * 7;
    for (let i = 0; i < totalDays; i++) {
      dates.push(this.fmtDate(new Date(cur)));
      cur.setDate(cur.getDate() + 1);
    }

    const params: any[] = [tenantId, from, to];
    const whereClauses: string[] = [
      `ar.tenant_id = $1`,
      `ar.attendance_date BETWEEN $2 AND $3`,
      // exclude resigned / terminated / inactive humans — a current schedule shows only active staff
      `e.status = 'active'`,
    ];
    if (functionId) { params.push(functionId); whereClauses.push(`e.function_id = $${params.length}`); }
    if (teamId)     { params.push(teamId);     whereClauses.push(`e.team_id = $${params.length}`); }

    const rows = await this.ds.query(`
      SELECT
        ar.employee_id,
        ar.attendance_date::date::text                         AS date,
        ar.attendance_marker,
        ar.scheduled_start,
        ar.scheduled_end,
        ar.is_wfh,
        ar.punch_in,
        ar.punch_out,
        ar.punch_late_minutes,
        ar.system_late_minutes,
        ar.ot_minutes,
        ar.notes,
        e.employee_no,
        e.first_name_en,
        e.last_name_en,
        e.gender,
        e.employment_type,
        f.id   AS function_id,
        f.name AS function_name,
        t.id   AS team_id,
        t.name AS team_name,
        -- corrected reconciliation overlay (today's canonical roster_days) — wins over attendance_records when present
        rd.shift_code      AS rd_code,
        rd.attendance_code AS rd_att,
        rd.hr_code         AS rd_hr,
        rd.presence        AS rd_presence,
        rd.shift_start_min AS rd_start_min,
        rd.shift_end_min   AS rd_end_min,
        rd.location        AS rd_location,
        rd.sys_late_min    AS rd_late,
        (COALESCE(rd.ot_min,0)+COALESCE(rd.offday_ot_min,0)+COALESCE(rd.holiday_ot_min,0)) AS rd_ot
      FROM attendance_records ar
      JOIN employees e ON ar.employee_id = e.id
      LEFT JOIN functions f ON e.function_id = f.id
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN roster_days rd
        ON rd.tenant_id = $1
        AND rd.person_no = e.employee_no
        AND rd.work_date = ar.attendance_date
        AND rd.is_active
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY f.name, e.first_name_en, ar.attendance_date
    `, params);

    // ── Group by employee ────────────────────────────────────────────────────
    const empMap = new Map<
      string,
      {
        employeeId: string;
        employeeNo: string;
        name: string;
        gender: string;
        employmentType: string;
        functionId: string;
        functionName: string;
        teamId: string;
        teamName: string;
        days: Record<string, any>;
      }
    >();

    for (const r of rows) {
      if (!empMap.has(r.employee_id)) {
        empMap.set(r.employee_id, {
          employeeId:     r.employee_id,
          employeeNo:     r.employee_no,
          name:           `${r.first_name_en} ${r.last_name_en ?? ''}`.trim(),
          gender:         r.gender,
          employmentType: r.employment_type,
          functionId:     r.function_id,
          functionName:   r.function_name ?? '—',
          teamId:         r.team_id,
          teamName:       r.team_name ?? '—',
          days:           {},
        });
      }
      const emp = empMap.get(r.employee_id)!;
      // OVERLAY: when the corrected roster (roster_days) covers this employee/day, the grid shows the
      // canonical reconciliation (real WFH / holiday / SL / A + true OT/late) instead of the raw
      // attendance_records marker. Future weeks (no roster_days row) fall back to the schedule plan unchanged.
      const hasRoster = r.rd_hr != null || r.rd_code != null;
      let cellMarker = r.attendance_marker, cellWfh = r.is_wfh, shift;
      if (hasRoster) {
        const hr = String(r.rd_hr || '').toUpperCase();
        cellMarker = (r.rd_presence === 'off' || hr === 'OFF' || hr === 'TRANSFER') ? 'off'
          : (r.rd_presence === 'leave' || ['L', 'DL', 'UPL'].includes(hr)) ? 'leave'
          : (r.rd_presence === 'sick' || hr === 'SL') ? 'sick'
          : (r.rd_presence === 'absent' || hr === 'A') ? 'absent'
          : (r.rd_presence === 'holiday' || hr === 'H') ? 'holiday'
          : 'present';
        cellWfh = r.rd_presence === 'wfh' || hr === 'WFH';
        shift = deriveShiftLabel(r.rd_start_min != null ? minToHHMM(r.rd_start_min) : null, null, cellMarker, cellWfh);
        // show the EXACT roster code (E / M / B / C / MD / C7 …) — keep deriveShiftLabel's colour/category
        if (cellMarker === 'present' && r.rd_code) shift = { ...shift, code: r.rd_code };
        // Suffix grammar on the grid (Director 2026-07-03): sick/absence ON a scheduled shift shows
        // base+S / base+A (MS, NA, EE20A…); plain SL / A stays ONLY for pre-scheduled days with no
        // base shift. The HR matrix keeps hr_code (SL/A) untouched — this is display-side only.
        if (cellMarker === 'sick' || cellMarker === 'absent') {
          const suffix = cellMarker === 'sick' ? 'S' : 'A';
          const att  = String(r.rd_att  || '').toUpperCase().trim();
          const base = String(r.rd_code || '').toUpperCase().trim();
          const NON_BASE = ['SL', 'A', 'ABS', 'OFF', 'H', 'L', 'DL', 'UPL', 'COMP', 'RES', 'TER', ''];
          if (/^[A-Z0-9-]+[SA]$/.test(att) && !NON_BASE.includes(att)) shift = { ...shift, code: att };
          else if (!NON_BASE.includes(base)) shift = { ...shift, code: base + suffix };
          // else: keep deriveShiftLabel's SL / A (pre-scheduled, no base shift)
        }
      } else {
        shift = deriveShiftLabel(r.scheduled_start, r.scheduled_end, r.attendance_marker, r.is_wfh);
      }
      // the shift code stays clean (E/M/B/C/MD…) — WFH is shown by the 🏠 icon + dotted texture, not a "-WFH" suffix
      if (shift && shift.code) shift = { ...shift, code: shift.code.replace(/-WFH$/, '') };
      // Parse audit edit count from notes JSON
      let editCount = 0;
      let lastEditBy: string | null = null;
      if (r.notes) {
        try {
          const n = JSON.parse(r.notes);
          editCount = n.edits?.length ?? 0;
          if (editCount > 0) lastEditBy = n.edits[editCount - 1].by ?? null;
        } catch {}
      }
      emp.days[r.date] = {
        marker:      cellMarker,
        // when corrected: show the canonical roster_days shift time so the time MATCHES the code
        // (attendance_records scheduled_start/end is stale and disagreed — caused MD shown as "7am–4pm")
        start:       hasRoster ? (r.rd_start_min != null ? minToHHMM(r.rd_start_min) : null) : r.scheduled_start,
        end:         hasRoster ? (r.rd_end_min   != null ? minToHHMM(r.rd_end_min)   : null) : r.scheduled_end,
        isWfh:       cellWfh,
        punchIn:     r.punch_in,
        punchOut:    r.punch_out,
        lateMinutes: hasRoster ? (r.rd_late ?? 0) : (r.punch_late_minutes ?? r.system_late_minutes ?? 0),
        otMinutes:   hasRoster ? (r.rd_ot ?? 0) : (r.ot_minutes ?? 0),
        editCount,
        lastEditBy,
        notes:       r.notes ?? null,
        source:      hasRoster ? 'roster' : 'schedule',
        ...shift,
      };
    }

    // ── Group by function ────────────────────────────────────────────────────
    const funcMap = new Map<string, { id: string; name: string; employees: any[] }>();
    for (const emp of empMap.values()) {
      if (!funcMap.has(emp.functionId)) {
        funcMap.set(emp.functionId, {
          id:        emp.functionId,
          name:      emp.functionName,
          employees: [],
        });
      }
      funcMap.get(emp.functionId)!.employees.push(emp);
    }

    // ── Coverage per date ────────────────────────────────────────────────────
    const coverage: Record<string, { working: number; off: number; leave: number; absent: number; total: number }> = {};
    for (const d of dates) {
      coverage[d] = { working: 0, off: 0, leave: 0, absent: 0, total: 0 };
    }
    for (const emp of empMap.values()) {
      for (const d of dates) {
        const day = emp.days[d];
        if (!day) continue;
        coverage[d].total++;
        if (day.marker === 'present')                             coverage[d].working++;
        else if (day.marker === 'off')                            coverage[d].off++;
        else if (day.marker === 'leave' || day.marker === 'sick') coverage[d].leave++;
        else if (day.marker === 'absent')                         coverage[d].absent++;
      }
    }

    return {
      weekStart: from,
      weekEnd:   to,
      dates,
      functions: Array.from(funcMap.values()),
      coverage,
      totalEmployees: empMap.size,
    };
  }

  // ── Functions list ──────────────────────────────────────────────────────────
  async getFunctions(tenantId: string) {
    return this.ds.query(
      `SELECT f.id, f.name, COUNT(DISTINCT e.id) AS employee_count
       FROM functions f
       LEFT JOIN employees e ON e.function_id = f.id AND e.tenant_id = $1 AND e.status = 'active'
       WHERE f.tenant_id = $1
       GROUP BY f.id, f.name
       ORDER BY f.name`,
      [tenantId],
    );
  }

  // ── Available weeks (from attendance data) ─────────────────────────────────
  // Week starts Saturday. EXTRACT(DOW): 0=Sun,1=Mon,...,6=Sat
  // Days-since-Saturday = (DOW + 1) % 7
  async getAvailableWeeks(tenantId: string) {
    const rows = await this.ds.query(
      `SELECT DISTINCT
         (attendance_date - (((EXTRACT(DOW FROM attendance_date)::int + 1) % 7) * INTERVAL '1 day'))::date AS week_sat
       FROM attendance_records
       WHERE tenant_id = $1
       ORDER BY week_sat DESC`,
      [tenantId],
    );
    return rows.map((r: any) => {
      const d = new Date(r.week_sat);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
  }

  // ── Employee day detail ─────────────────────────────────────────────────────
  async getDayDetail(tenantId: string, employeeId: string, date: string) {
    const rows = await this.ds.query(
      `SELECT ar.*,
              e.first_name_en, e.last_name_en, e.employee_no,
              f.name AS function_name
       FROM attendance_records ar
       JOIN employees e ON ar.employee_id = e.id
       LEFT JOIN functions f ON e.function_id = f.id
       WHERE ar.tenant_id = $1
         AND ar.employee_id = $2
         AND ar.attendance_date::date::text = $3`,
      [tenantId, employeeId, date],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      ...r,
      shift: deriveShiftLabel(r.scheduled_start, r.scheduled_end, r.attendance_marker, r.is_wfh),
    };
  }

  // ── Coverage summary (daily HC by function) ─────────────────────────────────
  async getCoverageSummary(tenantId: string, weekStart: string) {
    const { from, to } = this.getWeekRange(weekStart);
    return this.ds.query(
      `SELECT
         ar.attendance_date::date::text AS date,
         f.name AS function_name,
         COUNT(*) FILTER (WHERE ar.attendance_marker = 'present') AS working,
         COUNT(*) FILTER (WHERE ar.attendance_marker = 'off')     AS off_count,
         COUNT(*) FILTER (WHERE ar.attendance_marker IN ('leave','sick')) AS leave_count,
         COUNT(*) FILTER (WHERE ar.attendance_marker = 'absent')  AS absent_count,
         COUNT(*) AS total
       FROM attendance_records ar
       JOIN employees e ON ar.employee_id = e.id
       LEFT JOIN functions f ON e.function_id = f.id
       WHERE ar.tenant_id = $1
         AND ar.attendance_date BETWEEN $2 AND $3
       GROUP BY ar.attendance_date, f.name
       ORDER BY ar.attendance_date, f.name`,
      [tenantId, from, to],
    );
  }

  // ── Source-of-change classification ────────────────────────────────────────
  private classifySource(editType: string): string {
    const map: Record<string, string> = {
      business_need:     'business_need_override',
      wfm_adjustment:    'manual_edit',
      employee_request:  'manual_edit',
      correction:        'correction',
      sick_leave:        'sick_leave',
      absence:           'absence',
      swap_correction:   'shift_swap',
      emergency:         'emergency',
      import:            'import_excel',
      manual_adjustment: 'manual_edit',
    };
    return map[editType] ?? 'manual_edit';
  }

  // ── Validate a shift assignment for an employee ──────────────────────────────
  // Female rule: any shift ENDING after 20:00 is flagged (catches N ending 22:00 and
  // E ending 01:00 — not just late starts). Midnight (MD/MN family) is always blocked.
  // The N family downgrades to a warning when the function policy allows female late
  // (functionAllowsFemaleLate — the allowFemaleN exception from the generator).
  // Rest rule: BOTH directions vs the previous day's end and the next day's start,
  // cross-midnight aware (+1440 when a shift's end <= start ⇒ it ends the next day).
  private validateShiftAssignment(
    gender: string,
    functionName: string | null,
    code: string,
    newMarker: string,
    newStart: string | null,
    newEnd: string | null,
    prevDay: { start: string | null; end: string | null } | null,
    nextDay: { start: string | null } | null,
  ): { rule: string; severity: 'error' | 'warning'; messageAr: string; messageEn: string }[] {
    const violations: { rule: string; severity: 'error' | 'warning'; messageAr: string; messageEn: string }[] = [];

    if (!newStart || newMarker !== 'present') return violations;

    const startMin = timeStrToMin(newStart);
    const h = Math.floor(startMin / 60);
    // absolute end minutes on the edit day's axis (cross-midnight ⇒ ends next day)
    const endAbs = newEnd != null
      ? (timeStrToMin(newEnd) <= startMin ? timeStrToMin(newEnd) + 1440 : timeStrToMin(newEnd))
      : null;

    // Female rule — canonical category from the ONE classifier
    if (gender === 'female') {
      const cat = shiftCategoryFromCode(code);
      if (cat === 'midnight' || h >= 22 || h < 6) {
        violations.push({
          rule: 'female_midnight_blocked',
          severity: 'error',
          messageAr: 'منع تعيين وردية منتصف الليل للموظفات',
          messageEn: 'Female employees cannot be assigned midnight shifts',
        });
      } else if (endAbs != null && endAbs > 20 * 60) {
        if (cat === 'night' && functionAllowsFemaleLate(functionName ?? undefined)) {
          violations.push({
            rule: 'female_late_warning',
            severity: 'warning',
            messageAr: 'تحذير: وردية تنتهي بعد 20:00 لموظفة — مسموحة استثناءً لهذه الوظيفة',
            messageEn: 'Warning: female shift ends after 20:00 — allowed by this function\'s late exception',
          });
        } else {
          violations.push({
            rule: 'female_late_blocked',
            severity: 'error',
            messageAr: 'وردية تنتهي بعد 20:00 لموظفة — تحتاج تجاوز صريح (override)',
            messageEn: 'Female shift ends after 20:00 — explicit override required',
          });
        }
      }
    }

    // Minimum rest: previous day's shift end → this shift's start
    if (prevDay?.end) {
      const pEnd = timeStrToMin(prevDay.end);
      const pStart = prevDay.start != null ? timeStrToMin(prevDay.start) : null;
      const pEndAbs = pStart != null && pEnd <= pStart ? pEnd + 1440 : pEnd; // crosses midnight ⇒ ends on the edit day
      const restPrev = 1440 + startMin - pEndAbs; // minutes on the previous day's axis
      if (restPrev < 600) {
        const hrs = Math.round((restPrev / 60) * 10) / 10;
        violations.push({
          rule: 'insufficient_rest',
          severity: 'error',
          messageAr: `راحة أقل من 10 ساعات بعد وردية اليوم السابق (~${hrs}س). يحتاج موافقة`,
          messageEn: `Less than 10 hours rest after previous day's shift (~${hrs}h). Approval required`,
        });
      }
    }

    // Minimum rest: this shift's end → next day's shift start
    if (nextDay?.start && endAbs != null) {
      const restNext = 1440 + timeStrToMin(nextDay.start) - endAbs; // minutes on the edit day's axis
      if (restNext < 600) {
        const hrs = Math.round((restNext / 60) * 10) / 10;
        violations.push({
          rule: 'insufficient_rest_next',
          severity: 'error',
          messageAr: `راحة أقل من 10 ساعات قبل وردية اليوم التالي (~${hrs}س). يحتاج موافقة`,
          messageEn: `Less than 10 hours rest before next day's shift (~${hrs}h). Approval required`,
        });
      }
    }

    return violations;
  }

  // ── Count working employees in a function on a date ─────────────────────────
  private async countFunctionHc(
    tenantId: string,
    functionId: string,
    date: string,
  ): Promise<number> {
    const rows = await this.ds.query(
      `SELECT COUNT(*) AS cnt
       FROM attendance_records ar
       JOIN employees e ON ar.employee_id = e.id
       WHERE ar.tenant_id = $1 AND e.function_id = $2
         AND ar.attendance_date::date::text = $3
         AND ar.attendance_marker = 'present'`,
      [tenantId, functionId, date],
    );
    return parseInt(rows[0]?.cnt ?? '0', 10);
  }

  // ── Approved-schedule soft lock (mirrors recon.controller.assertScheduleEditable —
  //    replicated locally on purpose, do NOT import the controller) ─────────────
  private async getScheduleLock(
    tenantId: string,
  ): Promise<{ from: string; to: string; lockedAt?: string; lockedBy?: string } | null> {
    const [r] = await this.ds.query(
      `SELECT setting_value FROM tenant_settings WHERE tenant_id = $1 AND setting_key = 'schedule_lock'`,
      [tenantId],
    );
    const v = r?.setting_value;
    return v ? (typeof v === 'string' ? JSON.parse(v) : v) : null;
  }

  /** User's permission codes (user_roles → role_permissions → permissions). */
  private async getUserPermissionCodes(userId: string): Promise<string[]> {
    if (!userId) return [];
    const rows = await this.ds.query(
      `SELECT DISTINCT p.code
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = $1`,
      [userId],
    ).catch(() => []);
    return rows.map((r: any) => r.code);
  }

  /** Reject edits on locked weeks + inside the approved (soft-locked) roster range. */
  private async assertCellEditable(tenantId: string, userId: string, date: string) {
    // Hard lock: published/locked week status
    const weekStatus = await this.getWeekStatus(tenantId, ScheduleService.weekStartFor(date));
    if (weekStatus.status === 'locked') {
      throw new ForbiddenException(
        `Schedule week ${weekStatus.weekStart} is locked — unlock it before editing cells`,
      );
    }
    // Soft lock: the approved roster range (set on upload) — only schedule.publish may override
    const lock = await this.getScheduleLock(tenantId);
    const locked = !!lock && date >= lock.from && date <= lock.to;
    if (locked) {
      const canOverride = (await this.getUserPermissionCodes(userId)).includes('schedule.publish');
      if (!canOverride) {
        throw new ForbiddenException(
          `Schedule ${date} is inside the approved/locked range (${lock!.from} → ${lock!.to}). Manual edits are not allowed — re-upload the schedule to change it (a supervisor with schedule.publish may override, with audit).`,
        );
      }
    }
  }

  // ── Edit Cell — stores audit trail in notes JSON ────────────────────────────
  async editCell(
    tenantId: string,
    userId: string,
    userEmail: string,
    employeeId: string,
    date: string,
    newShiftCode: string,
    editType: string,
    reason: string,
    override = false,
  ) {
    if (!reason || reason.trim().length < 3)
      throw new BadRequestException('Reason must be at least 3 characters');

    // Lock enforcement: locked week + approved-range soft lock
    await this.assertCellEditable(tenantId, userId, date);

    const code = newShiftCode.trim().toUpperCase();
    let mapping = SHIFT_CODE_MAP[code];
    if (!mapping) {
      // Suffix grammar (MA/MS … EE20A/EE20S, WFH-*, plain A) resolves through the shared
      // normalizer — same base timing as the underlying shift, status from the suffix.
      const norm = normalizeShiftCode(code);
      if (norm.mapped) {
        const toTime = (min: number | null) => min == null ? null :
          `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`;
        const marker = norm.status === 'working' || norm.status === 'wfh' ? 'present'
          : norm.status === 'absence' ? 'absent'
          : norm.status === 'separation' || norm.status === 'unknown' ? null : norm.status; // sick/leave/holiday/off/comp match the enum
        if (marker) mapping = { marker, start: toTime(norm.startMin), end: toTime(norm.endMin), wfh: norm.isWfh };
      }
      if (!mapping)
        throw new BadRequestException(
          `Unknown shift code "${code}". Supported: ${Object.keys(SHIFT_CODE_MAP).join(', ')} + any base shift with A (absence) / S (sick) suffix, e.g. MA, NS, EE20A`,
        );
    }

    // Fetch current record + employee meta
    const rows = await this.ds.query(
      `SELECT ar.id, ar.attendance_marker, ar.scheduled_start, ar.scheduled_end,
              ar.is_wfh, ar.notes,
              e.gender, e.function_id,
              e.first_name_en, e.last_name_en, e.employee_no,
              f.name AS function_name
       FROM attendance_records ar
       JOIN employees e ON ar.employee_id = e.id
       LEFT JOIN functions f ON e.function_id = f.id
       WHERE ar.tenant_id = $1 AND ar.employee_id = $2 AND ar.attendance_date::date::text = $3`,
      [tenantId, employeeId, date],
    );

    if (!rows.length)
      throw new NotFoundException(`No attendance record for employee ${employeeId} on ${date}`);

    const rec = rows[0];
    const employeeName = `${rec.first_name_en} ${rec.last_name_en ?? ''}`.trim();

    // HC BEFORE (count working employees in same function, same date)
    const hcBefore = await this.countFunctionHc(tenantId, rec.function_id, date);

    // Neighbouring days for the REAL rest check (prev day's end → new start, new end → next day's start)
    const neighbourRows = await this.ds.query(
      `SELECT attendance_date::date::text AS d,
              scheduled_start::text AS s, scheduled_end::text AS e
       FROM attendance_records
       WHERE tenant_id = $1 AND employee_id = $2
         AND attendance_date IN ($3::date - INTERVAL '1 day', $3::date + INTERVAL '1 day')
         AND attendance_marker = 'present'
         AND scheduled_start IS NOT NULL`,
      [tenantId, employeeId, date],
    );
    const prevRow = neighbourRows.find((r: any) => r.d < date);
    const nextRow = neighbourRows.find((r: any) => r.d > date);

    // Run validation BEFORE applying the change
    const validations = this.validateShiftAssignment(
      rec.gender,
      rec.function_name ?? null,
      code,
      mapping.marker,
      mapping.start,
      mapping.end,
      prevRow ? { start: prevRow.s, end: prevRow.e } : null,
      nextRow ? { start: nextRow.s } : null,
    );
    const hasBlockingViolation = validations.some(v => v.severity === 'error');
    const requiresApproval = validations.length > 0;

    // Error-severity violations require an EXPLICIT override:true — never apply silently
    if (hasBlockingViolation && !override) {
      throw new BadRequestException({
        message: 'Edit blocked: rule violation(s) with error severity. Resubmit with override:true to force (the override is audited).',
        validations,
        requiresOverride: true,
      });
    }

    // Parse or initialise audit structure
    let audit: { original?: any; edits: any[]; source?: string } = { edits: [] };
    if (rec.notes) {
      try { audit = JSON.parse(rec.notes); } catch {}
      if (!audit.edits) audit.edits = [];
    }

    // Preserve original state on first edit
    if (audit.edits.length === 0) {
      audit.original = {
        marker: rec.attendance_marker,
        start:  rec.scheduled_start,
        end:    rec.scheduled_end,
      };
    }

    const sourceOfChange = this.classifySource(editType);

    audit.edits.push({
      seq:    audit.edits.length + 1,
      by:     userEmail,
      byId:   userId,
      at:     new Date().toISOString(),
      from: {
        marker: rec.attendance_marker,
        start:  rec.scheduled_start,
        end:    rec.scheduled_end,
      },
      to: {
        marker: mapping.marker,
        start:  mapping.start,
        end:    mapping.end,
        code,
      },
      type:            editType,
      sourceOfChange,
      reason:          reason.trim(),
      validations,
      requiresApproval,
      // explicit override of error-severity violations is part of the audit trail
      ...(override && hasBlockingViolation ? { override: true } : {}),
      hcBefore,
      employeeName,
      functionName:    rec.function_name,
    });

    // Apply the change — attendance_records + the ACTIVE roster_days overlay row
    // (same transaction, so the grid overlay never shows a ghost of the old shift)
    const isWfh = mapping.wfh === true;
    const startMinNum = mapping.start != null ? timeStrToMin(mapping.start) : null;
    const endMinNum   = mapping.end   != null ? timeStrToMin(mapping.end)   : null;
    const qr = this.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query(
        `UPDATE attendance_records
         SET attendance_marker = $1::attendance_marker_enum,
             scheduled_start   = CASE WHEN $2::text IS NULL THEN NULL ELSE $2::time END,
             scheduled_end     = CASE WHEN $3::text IS NULL THEN NULL ELSE $3::time END,
             is_wfh            = $4,
             notes             = $5
         WHERE tenant_id = $6 AND employee_id = $7 AND attendance_date::date::text = $8`,
        [
          mapping.marker,
          mapping.start,
          mapping.end,
          isWfh,
          JSON.stringify(audit),
          tenantId,
          employeeId,
          date,
        ],
      );
      // Dual-write: keep the canonical roster_days row (person_no keyed) in sync when one exists.
      // MUST carry presence + hr_code + attendance_code too — analysis/shrinkage/HR-Matrix read
      // those, so updating only the shift columns left every downstream number stale (bug 2026-07-03).
      const normCell = normalizeShiftCode(code);
      const presence = normCell.status === 'working' ? 'office'
        : normCell.status === 'wfh' ? 'wfh'
        : normCell.status === 'absence' ? 'absent'
        : normCell.status === 'separation' ? 'left'
        : normCell.status === 'unknown' ? null : normCell.status; // sick/leave/holiday/off/comp as-is
      await qr.query(
        `UPDATE roster_days
         SET shift_code = $4, shift_start_min = $5, shift_end_min = $6,
             presence = COALESCE($7, presence), hr_code = $8, attendance_code = $9,
             shift_category = $10, crosses_midnight = $11
         WHERE tenant_id = $1 AND person_no = $2 AND work_date = $3::date AND is_active`,
        [tenantId, rec.employee_no, date, code, startMinNum, endMinNum,
         presence, normCell.hrCode, code, normCell.base ?? code, normCell.crossesMidnight],
      );
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    // HC AFTER
    const hcAfter = await this.countFunctionHc(tenantId, rec.function_id, date);

    return {
      success:          true,
      editCount:        audit.edits.length,
      newMarker:        mapping.marker,
      newStart:         mapping.start,
      newEnd:           mapping.end,
      hcBefore,
      hcAfter,
      hcDelta:          hcAfter - hcBefore,
      validations,
      requiresApproval,
      hasBlockingViolation,
      employeeName,
      functionName:     rec.function_name,
      sourceOfChange,
    };
  }

  // ── Cell Timeline ─────────────────────────────────────────────────────────────
  // Returns the complete edit history for a specific employee + date
  async getCellTimeline(tenantId: string, employeeId: string, date: string) {
    const rows = await this.ds.query(
      `SELECT ar.notes,
              ar.attendance_marker, ar.scheduled_start, ar.scheduled_end,
              e.first_name_en, e.last_name_en, e.employee_no,
              f.name AS function_name
       FROM attendance_records ar
       JOIN employees e ON ar.employee_id = e.id
       LEFT JOIN functions f ON e.function_id = f.id
       WHERE ar.tenant_id = $1 AND ar.employee_id = $2 AND ar.attendance_date::date::text = $3`,
      [tenantId, employeeId, date],
    );

    if (!rows.length) return { date, timeline: [] };

    const r = rows[0];
    let audit: { original?: any; edits?: any[] } = {};
    try { audit = JSON.parse(r.notes ?? '{}'); } catch {}

    // Build chronological timeline including the initial state
    const timeline: any[] = [];

    if (audit.original) {
      timeline.push({
        seq:    0,
        action: 'created',
        labelAr: 'الحالة الأصلية / تم الإنشاء',
        labelEn: 'Original / Created',
        at:     null,
        from:   null,
        to: {
          marker: audit.original.marker,
          start:  audit.original.start,
          end:    audit.original.end,
        },
        by:     'System',
        reason: 'auto_generated',
        sourceOfChange: 'auto_generated',
        validations: [],
      });
    }

    for (const edit of (audit.edits ?? [])) {
      timeline.push({
        seq:            edit.seq,
        action:         'edited',
        labelAr:        'تعديل يدوي',
        labelEn:        'Manual Edit',
        at:             edit.at,
        from:           edit.from,
        to:             edit.to,
        by:             edit.by,
        byId:           edit.byId,
        type:           edit.type,
        reason:         edit.reason,
        sourceOfChange: edit.sourceOfChange ?? 'manual_edit',
        validations:    edit.validations ?? [],
        requiresApproval: edit.requiresApproval ?? false,
        hcBefore:       edit.hcBefore,
        employeeName:   edit.employeeName,
        functionName:   edit.functionName,
      });
    }

    return {
      date,
      employeeId,
      employeeName: `${r.first_name_en} ${r.last_name_en ?? ''}`.trim(),
      employeeNo:   r.employee_no,
      functionName: r.function_name,
      currentMarker: r.attendance_marker,
      currentStart:  r.scheduled_start,
      currentEnd:    r.scheduled_end,
      editCount:     (audit.edits ?? []).length,
      timeline,
    };
  }

  // ── Full Audit Report ─────────────────────────────────────────────────────────
  async getAuditReport(tenantId: string, filters: {
    dateFrom?: string;
    dateTo?:   string;
    employeeId?: string;
    functionId?: string;
    editedBy?: string;
    editType?: string;
    sourceOfChange?: string;
    hasViolation?: boolean;
    requiresApproval?: boolean;
    limit?: number;
    offset?: number;
  }) {
    const from = filters.dateFrom ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to   = filters.dateTo   ?? new Date().toISOString().slice(0, 10);

    const conditions: string[] = [
      `ar.tenant_id = $1`,
      `ar.attendance_date BETWEEN $2 AND $3`,
      `ar.notes IS NOT NULL AND ar.notes != ''`,
    ];
    const params: any[] = [tenantId, from, to];
    let pidx = 4;

    if (filters.employeeId) {
      conditions.push(`ar.employee_id = $${pidx++}`);
      params.push(filters.employeeId);
    }
    if (filters.functionId) {
      conditions.push(`e.function_id = $${pidx++}`);
      params.push(filters.functionId);
    }

    const where = conditions.join(' AND ');
    const sql = `
      SELECT
        ar.employee_id,
        ar.attendance_date::date::text AS date,
        ar.attendance_marker AS current_marker,
        ar.scheduled_start   AS current_start,
        ar.scheduled_end     AS current_end,
        ar.notes,
        e.first_name_en, e.last_name_en, e.employee_no,
        f.id   AS function_id,
        f.name AS function_name,
        t.name AS team_name
      FROM attendance_records ar
      JOIN employees e ON ar.employee_id = e.id
      LEFT JOIN functions f ON e.function_id = f.id
      LEFT JOIN teams t ON e.team_id = t.id
      WHERE ${where}
      ORDER BY ar.attendance_date DESC
    `;

    const rows = await this.ds.query(sql, params);

    // Flatten edits
    const allEdits: any[] = [];
    for (const r of rows) {
      let audit: { edits?: any[] } = {};
      try { audit = JSON.parse(r.notes); } catch { continue; }
      if (!audit.edits?.length) continue;

      for (const edit of audit.edits) {
        // Apply in-memory filters that require parsing JSON
        if (filters.editedBy && !(edit.by ?? '').toLowerCase().includes(filters.editedBy.toLowerCase())) continue;
        if (filters.editType && edit.type !== filters.editType) continue;
        if (filters.sourceOfChange && edit.sourceOfChange !== filters.sourceOfChange) continue;
        if (filters.hasViolation !== undefined) {
          const hasV = (edit.validations ?? []).length > 0;
          if (filters.hasViolation !== hasV) continue;
        }
        if (filters.requiresApproval !== undefined && edit.requiresApproval !== filters.requiresApproval) continue;

        allEdits.push({
          employeeId:    r.employee_id,
          employeeNo:    r.employee_no,
          employeeName:  `${r.first_name_en} ${r.last_name_en ?? ''}`.trim(),
          functionId:    r.function_id,
          functionName:  r.function_name,
          teamName:      r.team_name,
          scheduleDate:  r.date,
          editSeq:       edit.seq,
          editedBy:      edit.by,
          editedById:    edit.byId,
          editedAt:      edit.at,
          editType:      edit.type,
          sourceOfChange: edit.sourceOfChange ?? 'manual_edit',
          reason:        edit.reason,
          oldMarker:     edit.from?.marker,
          oldStart:      edit.from?.start ? edit.from.start.slice(0, 5) : null,
          oldEnd:        edit.from?.end   ? edit.from.end.slice(0, 5)   : null,
          newMarker:     edit.to?.marker,
          newStart:      edit.to?.start ? edit.to.start.slice(0, 5) : null,
          newEnd:        edit.to?.end   ? edit.to.end.slice(0, 5)   : null,
          newCode:       edit.to?.code,
          hcBefore:      edit.hcBefore ?? null,
          validations:   edit.validations ?? [],
          violationCount: (edit.validations ?? []).length,
          requiresApproval: edit.requiresApproval ?? false,
        });
      }
    }

    // Sort by editedAt desc
    allEdits.sort((a, b) => (b.editedAt ?? '').localeCompare(a.editedAt ?? ''));

    const total = allEdits.length;
    const limit  = filters.limit  ?? 100;
    const offset = filters.offset ?? 0;
    const paged  = allEdits.slice(offset, offset + limit);

    // Aggregate summary
    const summary = {
      totalEdits:       total,
      withViolations:   allEdits.filter(e => e.violationCount > 0).length,
      requireApproval:  allEdits.filter(e => e.requiresApproval).length,
      bySource:         {} as Record<string, number>,
      byEditType:       {} as Record<string, number>,
    };
    for (const e of allEdits) {
      summary.bySource[e.sourceOfChange]    = (summary.bySource[e.sourceOfChange] ?? 0) + 1;
      summary.byEditType[e.editType ?? '—'] = (summary.byEditType[e.editType ?? '—'] ?? 0) + 1;
    }

    return { period: { from, to }, summary, total, rows: paged };
  }

  // ── Shift codes catalogue for frontend dropdown ──────────────────────────────
  getShiftCodes() {
    const entries = Object.entries(SHIFT_CODE_MAP).map(([code, v]) => {
      let category = 'working';
      if (v.marker === 'off')     category = 'off';
      else if (v.marker === 'leave')   category = 'leave';
      else if (v.marker === 'sick')    category = 'sick';
      else if (v.marker === 'absent')  category = 'absent';
      else if (v.marker === 'holiday') category = 'holiday';
      else if (v.start) {
        const h = parseInt(v.start.split(':')[0], 10);
        if (h >= 6 && h < 9)   category = 'morning';
        else if (h >= 9 && h < 13)  category = 'between';
        else if (h >= 13 && h < 22) category = 'night';
        else                        category = 'midnight';
      }
      return { code, marker: v.marker, start: v.start, end: v.end, category };
    });
    return entries;
  }

  // ── Audit log for a date range ───────────────────────────────────────────────
  async getAuditLog(tenantId: string, weekStart: string, weeks = 1) {
    const { from, to } = this.getWeekRange(weekStart, weeks);
    const rows = await this.ds.query(
      `SELECT
         ar.employee_id,
         ar.attendance_date::date::text AS date,
         ar.notes,
         e.first_name_en, e.last_name_en, e.employee_no,
         f.name AS function_name
       FROM attendance_records ar
       JOIN employees e ON ar.employee_id = e.id
       LEFT JOIN functions f ON e.function_id = f.id
       WHERE ar.tenant_id = $1
         AND ar.attendance_date BETWEEN $2 AND $3
         AND ar.notes IS NOT NULL
         AND ar.notes != ''
       ORDER BY ar.attendance_date DESC`,
      [tenantId, from, to],
    );

    const result: any[] = [];
    for (const r of rows) {
      try {
        const audit = JSON.parse(r.notes);
        if (!audit.edits?.length) continue;
        for (const edit of audit.edits) {
          result.push({
            employeeId:   r.employee_id,
            employeeNo:   r.employee_no,
            employeeName: `${r.first_name_en} ${r.last_name_en ?? ''}`.trim(),
            functionName: r.function_name,
            date:         r.date,
            ...edit,
          });
        }
      } catch {}
    }
    // Sort by edit timestamp desc
    result.sort((a, b) => b.at.localeCompare(a.at));
    return result;
  }

  // ── Absence / Sick analysis grouped by shift + hour ─────────────────────────
  // Full analytics: codes NS/NA/MS/MA/BS/BA/CS/CA/ES/EA/MDS/MDA/MNS/MNA
  // + hour-level HC impact + shrinkage % by shift and function
  async getAbsenceAnalysis(
    tenantId: string,
    weekStart: string,
    weeks = 1,
    functionId?: string,
  ) {
    const { from, to } = this.getWeekRange(weekStart, weeks);
    const absParams: any[] = [tenantId, from, to];
    let fnFilter = '';
    if (functionId) { absParams.push(functionId); fnFilter = `AND e.function_id = $${absParams.length}`; }

    // ── SOURCE FIX (Director, 2026-07-02): the grid's SL/A cells live in roster_days (the
    //    canonical reconciled roster), while this analysis only read attendance_records markers
    //    → the panel showed EMPTY despite visible sick/absence. When roster_days covers the
    //    range it is the source of truth; attendance_records stays the fallback for future
    //    (publish-only) weeks. Codes are case-insensitive; ABS→A; shift-suffix codes
    //    (MS/BS/CS/NS/ES/EE20S/MDS/MNS + *A) carry their ORIGINAL shift.
    const rosterCovered = Number((await this.ds.query(
      `SELECT COUNT(*)::int n FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`,
      [tenantId, from, to]))[0]?.n || 0) > 0;

    let absRows: any[];
    let schedRows: any[];
    if (rosterCovered) {
      const rosterFn = functionId
        ? `AND COALESCE(r.role_function, r.function_name) = (SELECT name FROM functions WHERE id = $4)`
        : '';
      absRows = await this.ds.query(
        `SELECT
           COALESCE(r.person_no, r.employee_no)              AS employee_id,
           COALESCE(r.person_no, r.employee_no)              AS employee_no,
           COALESCE(r.clean_name, r.name)                    AS employee_name,
           r.work_date::text                                 AS date,
           CASE WHEN upper(trim(COALESCE(r.hr_code,''))) = 'SL' OR r.presence = 'sick'
                THEN 'sick' ELSE 'absent' END                AS marker,
           upper(trim(COALESCE(r.attendance_code, r.shift_code, ''))) AS raw_code,
           r.shift_start_min, r.shift_end_min,
           COALESCE(r.role_function, r.function_name)        AS function_name,
           COALESCE(r.role_function, r.function_name)        AS function_id
         FROM roster_days r
         WHERE r.tenant_id = $1 AND r.work_date BETWEEN $2 AND $3 AND r.is_active
           AND ( r.presence IN ('sick','absent')
                 OR upper(trim(COALESCE(r.hr_code,''))) IN ('SL','A','ABS') )
           ${rosterFn}
         ORDER BY r.work_date DESC`,
        absParams,
      );
      schedRows = await this.ds.query(
        `SELECT
           r.work_date::text                          AS date,
           COALESCE(r.role_function, r.function_name) AS function_id,
           COUNT(*) FILTER (WHERE r.presence IN ('office','wfh','sick','absent','leave')) AS total_scheduled,
           COUNT(*) FILTER (WHERE r.presence IN ('office','wfh'))                          AS present_count,
           COUNT(*) FILTER (WHERE r.presence IN ('sick','absent'))                          AS absent_sick_count
         FROM roster_days r
         WHERE r.tenant_id = $1 AND r.work_date BETWEEN $2 AND $3 AND r.is_active
           ${rosterFn}
         GROUP BY r.work_date, COALESCE(r.role_function, r.function_name)`,
        absParams,
      );
    } else {
      // Legacy fallback: markers written by publish + request approvals
      absRows = await this.ds.query(
        `SELECT
           ar.employee_id,
           e.employee_no,
           TRIM(e.first_name_en || ' ' || COALESCE(e.last_name_en,'')) AS employee_name,
           ar.attendance_date::date::text        AS date,
           ar.attendance_marker                  AS marker,
           NULL                                  AS raw_code,
           (EXTRACT(HOUR FROM ar.scheduled_start)*60 + EXTRACT(MINUTE FROM ar.scheduled_start))::int AS shift_start_min,
           (EXTRACT(HOUR FROM ar.scheduled_end)*60   + EXTRACT(MINUTE FROM ar.scheduled_end))::int   AS shift_end_min,
           f.name AS function_name,
           f.id   AS function_id
         FROM attendance_records ar
         JOIN employees e ON ar.employee_id = e.id
         LEFT JOIN functions f ON e.function_id = f.id
         WHERE ar.tenant_id = $1
           AND ar.attendance_date BETWEEN $2 AND $3
           AND ar.attendance_marker IN ('sick','absent')
           ${fnFilter}
         ORDER BY ar.attendance_date DESC`,
        absParams,
      );
      schedRows = await this.ds.query(
        `SELECT
           ar.attendance_date::date::text AS date,
           f.id   AS function_id,
           COUNT(*) FILTER (WHERE ar.attendance_marker IN ('present','sick','absent','leave')) AS total_scheduled,
           COUNT(*) FILTER (WHERE ar.attendance_marker = 'present') AS present_count,
           COUNT(*) FILTER (WHERE ar.attendance_marker IN ('sick','absent')) AS absent_sick_count
         FROM attendance_records ar
         JOIN employees e ON ar.employee_id = e.id
         LEFT JOIN functions f ON e.function_id = f.id
         WHERE ar.tenant_id = $1
           AND ar.attendance_date BETWEEN $2 AND $3
           ${fnFilter}
         GROUP BY ar.attendance_date, f.id`,
        absParams,
      );
    }

    // Build a quick lookup: date + functionId → {total, present, absent}
    const schedMap = new Map<string, { total: number; present: number; absentSick: number }>();
    for (const s of schedRows) {
      schedMap.set(`${s.date}|${s.function_id}`, {
        total:     parseInt(s.total_scheduled, 10),
        present:   parseInt(s.present_count,   10),
        absentSick:parseInt(s.absent_sick_count, 10),
      });
    }

    // ── Shift-base metadata (real Timing-sheet families). Operational codes carry the
    //    ORIGINAL shift as a prefix (NS = sick on N, EE20A = absence on EE20…).
    const BASE_META: Record<string, { category: string; ar: string; en: string }> = {
      M:  { category: 'morning',     ar: 'صباحي',           en: 'Morning'     },
      AM: { category: 'morning',     ar: 'صباحي',           en: 'Morning'     },
      B:  { category: 'between_b',   ar: 'بين (B)',         en: 'Between B'   },
      C:  { category: 'between_c',   ar: 'وسط (C)',         en: 'Between C'   },
      N:  { category: 'night_n',     ar: 'مسائي (N)',       en: 'Night N'     },
      E:  { category: 'night_e',     ar: 'ليلي (E)',        en: 'Night E'     },
      EE: { category: 'night_ee',    ar: 'عميق (EE)',       en: 'Deep Night'  },
      EE20:{ category: 'night_ee',   ar: 'عميق (EE20)',     en: 'Deep Night'  },
      MD: { category: 'midnight_md', ar: 'منتصف ليل (MD)',  en: 'Midnight MD' },
      MN: { category: 'midnight_mn', ar: 'فجر (MN)',        en: 'Midnight MN' },
    };
    // NS/BS/…/EE20S/MDA → the base shift; plain SL/A/ABS (or unknown) → null.
    const baseFromRaw = (raw: string | null): string | null => {
      const U = String(raw || '').toUpperCase().trim();
      if (!U || U === 'SL' || U === 'A' || U === 'ABS') return null;
      const m = /^([A-Z0-9]+?)[SA]$/.exec(U);
      if (m && BASE_META[m[1]]) return m[1];
      if (BASE_META[U]) return U; // raw already IS the shift (roster kept the code)
      return null;
    };
    const hourBase = (startMin: number | null): string | null => {
      if (startMin == null) return null;
      const h = Math.floor((((startMin % 1440) + 1440) % 1440) / 60);
      if (h >= 6 && h < 9)   return 'M';
      if (h >= 9 && h < 11)  return 'B';
      if (h >= 11 && h < 13) return 'C';
      if (h >= 13 && h < 16) return 'N';
      if (h >= 16 && h < 18) return 'E';
      if (h >= 18 && h < 22) return 'EE';
      if (h === 22)          return 'MD';
      return 'MN';
    };
    const deriveCode = (startMin: number | null, marker: 'sick' | 'absent', rawCode: string | null): {
      code: string; category: string; categoryLabel: { ar: string; en: string };
    } => {
      const suffix = marker === 'sick' ? 'S' : 'A';
      const base = baseFromRaw(rawCode) ?? hourBase(startMin);
      if (!base) return { code: `?${suffix}`, category: 'unknown', categoryLabel: { ar: 'غير محدد', en: 'Unknown' } };
      const meta = BASE_META[base];
      return { code: `${base}${suffix}`, category: meta.category, categoryLabel: { ar: meta.ar, en: meta.en } };
    };

    // Generate 30-min interval marks covering a shift window (minutes, cross-midnight aware)
    const shiftIntervalsMin = (startMin: number, endMin: number): number[] => {
      let e = endMin;
      if (e <= startMin) e += 24 * 60; // cross-midnight
      const result: number[] = [];
      for (let m = startMin; m < e; m += 30) result.push(m % (24 * 60));
      return result;
    };

    // Build aggregates by shift code
    const byCode: Record<string, { sick: number; absent: number; total: number; category: string; labelAr: string; labelEn: string }> = {};
    const byFunction: Record<string, { functionName: string; sick: number; absent: number; total: number; shrinkagePct: number }> = {};
    const byHour: Record<number, { sick: number; absent: number; total: number; impactedHc: number }> = {};
    const details: any[] = [];

    const mmToHHMM = (m: number | null) => m == null ? null :
      `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;

    for (const r of absRows) {
      const marker = r.marker as 'sick' | 'absent';
      const startMin = r.shift_start_min == null ? null : Number(r.shift_start_min);
      const endMin = r.shift_end_min == null ? null : Number(r.shift_end_min);
      const { code, category, categoryLabel } = deriveCode(startMin, marker, r.raw_code ?? null);

      // By code
      if (!byCode[code]) byCode[code] = { sick: 0, absent: 0, total: 0, category, labelAr: categoryLabel.ar, labelEn: categoryLabel.en };
      byCode[code][marker]++;
      byCode[code].total++;

      // By function
      const fnKey = r.function_id ?? 'unknown';
      if (!byFunction[fnKey]) byFunction[fnKey] = { functionName: r.function_name ?? '—', sick: 0, absent: 0, total: 0, shrinkagePct: 0 };
      byFunction[fnKey][marker]++;
      byFunction[fnKey].total++;

      // By hour (interval-level impact) — from the ORIGINAL shift window when known
      if (startMin != null && endMin != null) {
        for (const minOfDay of shiftIntervalsMin(startMin, endMin)) {
          const hourKey = Math.floor(minOfDay / 60);
          if (!byHour[hourKey]) byHour[hourKey] = { sick: 0, absent: 0, total: 0, impactedHc: 0 };
          byHour[hourKey][marker]++;
          byHour[hourKey].total++;
          byHour[hourKey].impactedHc++;
        }
      }

      details.push({
        employeeId:    r.employee_id,
        employeeNo:    r.employee_no,
        employeeName:  r.employee_name,
        functionId:    r.function_id,
        functionName:  r.function_name,
        date:          r.date,
        marker,
        shiftCode:     code,
        category,
        categoryLabel,
        shiftStart:    mmToHHMM(startMin),
        shiftEnd:      mmToHHMM(endMin),
      });
    }

    // Compute shrinkage % per function (avg over period)
    for (const [fnId, fnData] of Object.entries(byFunction)) {
      let totalScheduled = 0;
      let totalAbsentSick = 0;
      for (const [key, sched] of schedMap.entries()) {
        if (key.endsWith(`|${fnId}`)) {
          totalScheduled += sched.total;
          totalAbsentSick += sched.absentSick;
        }
      }
      fnData.shrinkagePct = totalScheduled > 0
        ? Math.round((totalAbsentSick / totalScheduled) * 100 * 10) / 10
        : 0;
    }

    const grandTotal = details.length;
    const grandSick   = details.filter(d => d.marker === 'sick').length;
    const grandAbsent = details.filter(d => d.marker === 'absent').length;

    // Most affected shift code and hour
    const topCode  = Object.entries(byCode).sort(([, a], [, b]) => b.total - a.total)[0]?.[0] ?? null;
    const topHour  = Object.entries(byHour).sort(([, a], [, b]) => b.impactedHc - a.impactedHc)[0]?.[0] ?? null;

    // Hour array sorted 0–23
    const byHourArray = Array.from({ length: 24 }, (_, h) => ({
      hour:       h,
      hourLabel:  `${String(h).padStart(2, '0')}:00`,
      sick:       byHour[h]?.sick      ?? 0,
      absent:     byHour[h]?.absent    ?? 0,
      total:      byHour[h]?.total     ?? 0,
      impactedHc: byHour[h]?.impactedHc ?? 0,
    }));

    // The AbsencePanel contract: byCategory[{category,label:{ar,en,code},sick,absent,total,pct}]
    // + mostAffectedShift. (The old endpoint returned only byCode — the panel crashed silently
    // on byCategory.map, which is the OTHER half of why "Absence Analysis" showed nothing.)
    const PANEL_FAMILY: Record<string, string> = {
      morning: 'morning', between_b: 'afternoon', between_c: 'afternoon',
      night_n: 'night', night_e: 'night', night_ee: 'night',
      midnight_md: 'midnight', midnight_mn: 'midnight', unknown: 'unknown',
    };
    const byCategory = Object.entries(byCode).map(([code, v]) => ({
      category: PANEL_FAMILY[v.category] ?? 'unknown',
      label: { ar: v.labelAr, en: v.labelEn, code },
      sick: v.sick, absent: v.absent, total: v.total,
      pct: grandTotal ? Math.round((v.total / grandTotal) * 100) : 0,
    })).sort((a, b) => b.total - a.total);

    return {
      period: { from, to, weeks },
      grandTotal,
      grandSick,
      grandAbsent,
      mostAffectedShift: topCode,
      topAffectedCode: topCode,
      topAffectedHour: topHour ? parseInt(topHour, 10) : null,
      byCategory,
      byCode: Object.entries(byCode).map(([code, v]) => ({ code, ...v }))
        .sort((a, b) => b.total - a.total),
      byFunction: Object.entries(byFunction).map(([fnId, v]) => ({ functionId: fnId, ...v }))
        .sort((a, b) => b.total - a.total),
      byHour: byHourArray,
      details,
    };
  }

  // ── Schedule Week Status (Publish / Lock) ───────────────────────────────

  async getWeekStatus(tenantId: string, weekStart: string) {
    const rows = await this.ds.query(
      `SELECT status, published_at, published_by, locked_at, locked_by, notes
       FROM schedule_week_status
       WHERE tenant_id = $1 AND week_start = $2::date`,
      [tenantId, weekStart],
    );
    if (!rows.length) {
      return { weekStart, status: 'draft', publishedAt: null, publishedBy: null, lockedAt: null, lockedBy: null, notes: null };
    }
    const r = rows[0];
    return {
      weekStart,
      status: r.status,
      publishedAt: r.published_at,
      publishedBy: r.published_by,
      lockedAt: r.locked_at,
      lockedBy: r.locked_by,
      notes: r.notes,
    };
  }

  async setWeekStatus(
    tenantId: string,
    weekStart: string,
    userId: string,
    action: 'publish' | 'lock' | 'unlock' | 'revert_to_draft',
    notes?: string,
  ) {
    const current = await this.getWeekStatus(tenantId, weekStart);

    if (action === 'unlock') {
      // The only way out of a locked week: back to 'published' (then it can be
      // edited / reverted / re-published as normal). Clears the lock stamp.
      if (current.status !== 'locked') {
        throw new BadRequestException('الجدول غير مقفل');
      }
      await this.ds.query(
        `UPDATE schedule_week_status
            SET status = 'published', locked_at = NULL, locked_by = NULL,
                notes = COALESCE($3, notes), updated_at = NOW()
          WHERE tenant_id = $1 AND week_start = $2::date`,
        [tenantId, weekStart, notes ?? null],
      );
      return this.finishWeekStatusChange(tenantId, weekStart, userId, action, current.status, notes);
    }

    if (action === 'publish') {
      if (current.status === 'locked') {
        throw new BadRequestException('الجدول مقفل ولا يمكن تعديل حالته');
      }
      await this.ds.query(
        `INSERT INTO schedule_week_status (tenant_id, week_start, status, published_at, published_by, notes, updated_at)
         VALUES ($1, $2::date, 'published', NOW(), $3, $4, NOW())
         ON CONFLICT (tenant_id, week_start) DO UPDATE
           SET status = 'published',
               published_at = COALESCE(schedule_week_status.published_at, NOW()),
               published_by = COALESCE(schedule_week_status.published_by, $3),
               notes = COALESCE($4, schedule_week_status.notes),
               updated_at = NOW()`,
        [tenantId, weekStart, userId, notes ?? null],
      );
    } else if (action === 'lock') {
      if (current.status === 'draft') {
        throw new BadRequestException('يجب نشر الجدول أولاً قبل القفل');
      }
      await this.ds.query(
        `INSERT INTO schedule_week_status (tenant_id, week_start, status, published_at, published_by, locked_at, locked_by, notes, updated_at)
         VALUES ($1, $2::date, 'locked', NOW(), $3, NOW(), $3, $4, NOW())
         ON CONFLICT (tenant_id, week_start) DO UPDATE
           SET status = 'locked',
               locked_at = COALESCE(schedule_week_status.locked_at, NOW()),
               locked_by = COALESCE(schedule_week_status.locked_by, $3),
               notes = COALESCE($4, schedule_week_status.notes),
               updated_at = NOW()`,
        [tenantId, weekStart, userId, notes ?? null],
      );
    } else {
      if (current.status === 'locked') {
        throw new BadRequestException('الجدول مقفل ولا يمكن الرجوع للمسودة');
      }
      await this.ds.query(
        `INSERT INTO schedule_week_status (tenant_id, week_start, status, notes, updated_at)
         VALUES ($1, $2::date, 'draft', $3, NOW())
         ON CONFLICT (tenant_id, week_start) DO UPDATE
           SET status = 'draft',
               notes = COALESCE($3, schedule_week_status.notes),
               updated_at = NOW()`,
        [tenantId, weekStart, notes ?? null],
      );
    }

    return this.finishWeekStatusChange(tenantId, weekStart, userId, action, current.status, notes);
  }

  /** Write the lifecycle transition to audit_logs (actor, week, old→new) and return the fresh status. */
  private async finishWeekStatusChange(
    tenantId: string,
    weekStart: string,
    userId: string,
    action: string,
    oldStatus: string,
    notes?: string,
  ) {
    const result = await this.getWeekStatus(tenantId, weekStart);
    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, action, module, entity_type, entity_id, old_value, new_value, notes)
       VALUES ($1,$2,$3,'schedule','schedule_week',NULL,$4,$5,$6)`,
      [
        tenantId,
        userId ?? null,
        `schedule.week.${action}`,
        JSON.stringify({ weekStart, status: oldStatus }),
        JSON.stringify({ weekStart, status: result.status }),
        notes ?? null,
      ],
    ).catch(() => {}); // audit must never break the lifecycle action itself
    return result;
  }
}
