import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// ── Shift code → marker + times lookup ──────────────────────────────────────
// Used by editCell to resolve a typed shift code to DB values
const SHIFT_CODE_MAP: Record<string, { marker: string; start: string | null; end: string | null }> = {
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
  // Non-working
  OFF:  { marker: 'off',     start: null, end: null },
  L:    { marker: 'leave',   start: null, end: null },
  SL:   { marker: 'sick',    start: null, end: null },
  ABS:  { marker: 'absent',  start: null, end: null },
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
  if (marker === 'absent')  return { code: 'ABS', category: 'absent',  color: '#ef4444', label: 'غياب'           };
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

    const whereClauses: string[] = [
      `ar.tenant_id = '${tenantId}'`,
      `ar.attendance_date BETWEEN '${from}' AND '${to}'`,
    ];
    if (functionId) whereClauses.push(`e.function_id = '${functionId}'`);
    if (teamId)     whereClauses.push(`e.team_id = '${teamId}'`);

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
        t.name AS team_name
      FROM attendance_records ar
      JOIN employees e ON ar.employee_id = e.id
      LEFT JOIN functions f ON e.function_id = f.id
      LEFT JOIN teams t ON e.team_id = t.id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY f.name, e.first_name_en, ar.attendance_date
    `);

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
      const shift = deriveShiftLabel(r.scheduled_start, r.scheduled_end, r.attendance_marker, r.is_wfh);
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
        marker:      r.attendance_marker,
        start:       r.scheduled_start,
        end:         r.scheduled_end,
        isWfh:       r.is_wfh,
        punchIn:     r.punch_in,
        punchOut:    r.punch_out,
        lateMinutes: r.punch_late_minutes ?? r.system_late_minutes ?? 0,
        otMinutes:   r.ot_minutes ?? 0,
        editCount,
        lastEditBy,
        notes:       r.notes ?? null,
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
  private validateShiftAssignment(
    gender: string,
    newMarker: string,
    newStart: string | null,
    prevEnd: string | null,
  ): { rule: string; severity: 'error' | 'warning'; messageAr: string; messageEn: string }[] {
    const violations: { rule: string; severity: 'error' | 'warning'; messageAr: string; messageEn: string }[] = [];

    if (!newStart || newMarker !== 'present') return violations;

    const h = parseInt(newStart.split(':')[0], 10);

    // Female midnight rule
    if (gender === 'female') {
      if (h >= 22 || h < 6) {
        violations.push({
          rule: 'female_midnight_blocked',
          severity: 'error',
          messageAr: 'منع تعيين وردية منتصف الليل للموظفات',
          messageEn: 'Female employees cannot be assigned midnight shifts',
        });
      } else if (h >= 18) {
        violations.push({
          rule: 'female_late_warning',
          severity: 'warning',
          messageAr: 'تحذير: الوردية المتأخرة للموظفات تحتاج موافقة',
          messageEn: 'Warning: late shift for female requires approval',
        });
      }
    }

    // Minimum rest check (if we have prev shift end)
    if (prevEnd) {
      const prevH = parseInt(prevEnd.split(':')[0], 10);
      // Approximate rest hours (next day)
      const restApprox = 24 - prevH + h;
      if (restApprox < 10) {
        violations.push({
          rule: 'insufficient_rest',
          severity: 'error',
          messageAr: `راحة أقل من 10 ساعات (~${restApprox}س). يحتاج موافقة`,
          messageEn: `Less than 10 hours rest (~${restApprox}h). Approval required`,
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
  ) {
    if (!reason || reason.trim().length < 3)
      throw new BadRequestException('Reason must be at least 3 characters');

    const code = newShiftCode.trim().toUpperCase();
    const mapping = SHIFT_CODE_MAP[code];
    if (!mapping)
      throw new BadRequestException(
        `Unknown shift code "${code}". Supported: ${Object.keys(SHIFT_CODE_MAP).join(', ')}`,
      );

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

    // Run validation BEFORE applying the change
    const validations = this.validateShiftAssignment(
      rec.gender,
      mapping.marker,
      mapping.start,
      rec.scheduled_end,
    );
    const hasBlockingViolation = validations.some(v => v.severity === 'error');
    const requiresApproval = validations.length > 0;

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
      hcBefore,
      employeeName,
      functionName:    rec.function_name,
    });

    // Apply the change
    await this.ds.query(
      `UPDATE attendance_records
       SET attendance_marker = $1::attendance_marker_enum,
           scheduled_start   = CASE WHEN $2::text IS NULL THEN NULL ELSE $2::time END,
           scheduled_end     = CASE WHEN $3::text IS NULL THEN NULL ELSE $3::time END,
           notes             = $4
       WHERE tenant_id = $5 AND employee_id = $6 AND attendance_date::date::text = $7`,
      [
        mapping.marker,
        mapping.start,
        mapping.end,
        JSON.stringify(audit),
        tenantId,
        employeeId,
        date,
      ],
    );

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
    const fnFilter = functionId ? `AND e.function_id = '${functionId}'` : '';

    // Get sick/absent records
    const absRows = await this.ds.query(
      `SELECT
         ar.employee_id,
         ar.attendance_date::date::text        AS date,
         ar.attendance_marker                  AS marker,
         ar.scheduled_start::text              AS scheduled_start,
         ar.scheduled_end::text                AS scheduled_end,
         e.first_name_en, e.last_name_en, e.employee_no,
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
      [tenantId, from, to],
    );

    // Get total scheduled employees per day (for shrinkage %)
    const schedRows = await this.ds.query(
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
      [tenantId, from, to],
    );

    // Build a quick lookup: date + functionId → {total, present, absent}
    const schedMap = new Map<string, { total: number; present: number; absentSick: number }>();
    for (const s of schedRows) {
      schedMap.set(`${s.date}|${s.function_id}`, {
        total:     parseInt(s.total_scheduled, 10),
        present:   parseInt(s.present_count,   10),
        absentSick:parseInt(s.absent_sick_count, 10),
      });
    }

    // Detailed shift-code derivation: Maps start hour → code prefix
    // Follows the REAL Boutiqaat Timing sheet categories
    const deriveCode = (start: string | null, marker: 'sick' | 'absent'): {
      code: string; category: string; categoryLabel: { ar: string; en: string };
    } => {
      const suffix = marker === 'sick' ? 'S' : 'A';
      if (!start) return { code: `?${suffix}`, category: 'unknown', categoryLabel: { ar: 'غير محدد', en: 'Unknown' } };

      const h = parseInt(start.split(':')[0], 10);
      if (h >= 6 && h < 9)   return { code: `M${suffix}`,  category: 'morning',  categoryLabel: { ar: 'صباحي',             en: 'Morning'  } };
      if (h >= 9 && h < 11)  return { code: `B${suffix}`,  category: 'between_b',categoryLabel: { ar: 'بين (B)',           en: 'Between B'} };
      if (h >= 11 && h < 13) return { code: `C${suffix}`,  category: 'between_c',categoryLabel: { ar: 'وسط (C)',           en: 'Between C'} };
      if (h >= 13 && h < 16) return { code: `N${suffix}`,  category: 'night_n',  categoryLabel: { ar: 'مسائي (N)',         en: 'Night N'  } };
      if (h >= 16 && h < 18) return { code: `E${suffix}`,  category: 'night_e',  categoryLabel: { ar: 'ليلي (E)',          en: 'Night E'  } };
      if (h >= 18 && h < 22) return { code: `EE${suffix}`, category: 'night_ee', categoryLabel: { ar: 'عميق (EE)',         en: 'Deep Night'} };
      if (h === 22)           return { code: `MD${suffix}`, category: 'midnight_md', categoryLabel: { ar: 'منتصف ليل (MD)', en: 'Midnight MD' } };
      return               { code: `MN${suffix}`, category: 'midnight_mn', categoryLabel: { ar: 'فجر (MN)',             en: 'Midnight MN'} };
    };

    // Generate 30-min intervals covering a shift window (start → end)
    const shiftIntervals = (start: string, end: string): number[] => {
      const sh = parseInt(start.split(':')[0], 10);
      const sm = parseInt(start.split(':')[1] ?? '0', 10);
      let eh = parseInt(end.split(':')[0], 10);
      const em = parseInt(end.split(':')[1] ?? '0', 10);
      const startMins = sh * 60 + sm;
      let endMins = eh * 60 + em;
      if (endMins <= startMins) endMins += 24 * 60; // cross-midnight
      const result: number[] = [];
      for (let m = startMins; m < endMins; m += 30) result.push(m % (24 * 60));
      return result;
    };

    // Build aggregates by shift code
    const byCode: Record<string, { sick: number; absent: number; total: number; category: string; labelAr: string; labelEn: string }> = {};
    const byFunction: Record<string, { functionName: string; sick: number; absent: number; total: number; shrinkagePct: number }> = {};
    const byHour: Record<number, { sick: number; absent: number; total: number; impactedHc: number }> = {};
    const details: any[] = [];

    for (const r of absRows) {
      const marker = r.marker as 'sick' | 'absent';
      const { code, category, categoryLabel } = deriveCode(r.scheduled_start, marker);

      // By code
      if (!byCode[code]) byCode[code] = { sick: 0, absent: 0, total: 0, category, labelAr: categoryLabel.ar, labelEn: categoryLabel.en };
      byCode[code][marker]++;
      byCode[code].total++;

      // By function
      const fnKey = r.function_id ?? 'unknown';
      if (!byFunction[fnKey]) byFunction[fnKey] = { functionName: r.function_name ?? '—', sick: 0, absent: 0, total: 0, shrinkagePct: 0 };
      byFunction[fnKey][marker]++;
      byFunction[fnKey].total++;

      // By hour (interval-level impact)
      if (r.scheduled_start && r.scheduled_end) {
        const intervals = shiftIntervals(
          r.scheduled_start.slice(0, 5),
          r.scheduled_end.slice(0, 5),
        );
        for (const minOfDay of intervals) {
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
        employeeName:  `${r.first_name_en} ${r.last_name_en ?? ''}`.trim(),
        functionId:    r.function_id,
        functionName:  r.function_name,
        date:          r.date,
        marker,
        shiftCode:     code,
        category,
        categoryLabel,
        shiftStart:    r.scheduled_start ? r.scheduled_start.slice(0, 5) : null,
        shiftEnd:      r.scheduled_end   ? r.scheduled_end.slice(0, 5)   : null,
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

    return {
      period: { from, to, weeks },
      grandTotal,
      grandSick,
      grandAbsent,
      topAffectedCode: topCode,
      topAffectedHour: topHour ? parseInt(topHour, 10) : null,
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
    action: 'publish' | 'lock' | 'revert_to_draft',
    notes?: string,
  ) {
    const current = await this.getWeekStatus(tenantId, weekStart);

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

    return this.getWeekStatus(tenantId, weekStart);
  }
}
