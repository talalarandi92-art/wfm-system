import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  SHIFTS,
  ShiftDef,
  EmployeeInfo,
  ShiftDistribution,
  GeneratorOptions,
  GeneratorResult,
} from './generator.types';
import { generateWeeklySchedule, buildWeekDates } from './generator.engine';
import { computeShiftMix, assignRoster } from './demand.engine';
import { CapacityService } from '../capacity/capacity.service';

const DEFAULT_OPTIONS: GeneratorOptions = {
  minRestHours: 10,
  offDaysPerWeek: 1,
  internProductivity: 0.70,
  allowFemaleN: true,
  weeks: 1,
};

@Injectable()
export class GeneratorService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly capacity: CapacityService,
  ) {}

  /* ═══════════════════════════════════════════════════════════════════════════
   *  DEMAND-DRIVEN GENERATION — schedule built FROM the requirement curve.
   *
   *  1. Requirement: per-weekday 48×30-min required-HC curve from the capacity
   *     live-plan over the trailing 14 days (P90 across same weekdays; with
   *     sparse history the available days' element-wise max is used for all —
   *     reported honestly in `demand.basis`).
   *  2. Phase 1 — computeShiftMix: greedy set-cover → how many M/B/C/E/N/MD
   *     each day needs.
   *  3. Phase 2 — assignRoster: employees fill the mix under gender / rest /
   *     consecutive / fairness rules; unfillable slots returned as gaps.
   * ═══════════════════════════════════════════════════════════════════════════ */
  async generateDemandDriven(
    tenantId: string,
    weekStart: string,
    optionsIn?: Partial<GeneratorOptions> & { demandScale?: number },
  ) {
    const options = { ...DEFAULT_OPTIONS, ...(optionsIn ?? {}) };
    const demandScale = Math.min(3, Math.max(0.3, optionsIn?.demandScale ?? 1));
    const dates = buildWeekDates(weekStart);

    // ── 1. Requirement curves from live-plan history ──────────────────────────
    const histDates: string[] = [];
    for (let i = 0; i <= 14; i++) {  // include TODAY — often the only measured day early on
      const d = new Date(Date.now() + 3 * 3600e3 - i * 86400e3);
      histDates.push(d.toISOString().slice(0, 10));
    }
    const plans = await Promise.all(
      histDates.map(d => this.capacity.getLivePlan(tenantId, d).catch(() => null)),
    );

    // weekday (0-6) → list of measured 48-curves
    const byWeekday = new Map<number, number[][]>();
    const allCurves: number[][] = [];
    for (let i = 0; i < plans.length; i++) {
      const p = plans[i];
      if (!p || p.coverage.measuredIntervals < 4) continue;
      const curve = p.intervals.map((iv: any) => iv.measured ? (iv.requiredHc ?? 0) : 0);
      const wd = new Date(histDates[i]).getDay();
      (byWeekday.get(wd) ?? byWeekday.set(wd, []).get(wd)!).push(curve);
      allCurves.push(curve);
    }
    if (!allCurves.length) {
      throw new BadRequestException(
        'No measured workload history yet — keep the Sprinklr bridge running, then retry. ' +
        'لا يوجد تاريخ حمل مُقاس بعد — شغّل جسر سبرينكلر يوماً ثم أعد المحاولة.');
    }

    const p90 = (vals: number[]) => {
      const s = [...vals].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
    };
    const curveFor = (samples: number[][]): number[] =>
      Array.from({ length: 48 }, (_, i) => p90(samples.map(c => c[i])));
    const fallback = curveFor(allCurves);

    // ── 2+3. Per-day mix + roster ────────────────────────────────────────────
    const fns = await this.loadEmployees(tenantId, options.functionIds);
    const pool: EmployeeInfo[] = fns.flatMap(f => f.employees);
    if (!pool.length) throw new BadRequestException('No active employees in scope.');

    const { from, to } = this.weekRange(weekStart);
    const [ytdDist, lastShifts, consecDays] = await Promise.all([
      this.loadYtdDistribution(tenantId, pool.map(e => e.id), from),
      this.loadLastShifts(tenantId, pool.map(e => e.id), from),
      this.loadConsecutiveDays(tenantId, pool.map(e => e.id), from),
    ]);

    const mixByDate = new Map<string, Record<string, number>>();
    const demandDays: any[] = [];
    // Bodies available per day ≈ pool minus the OFF allowance
    const maxStaffPerDay = Math.max(1, pool.length - Math.ceil(pool.length * options.offDaysPerWeek / 7));

    for (const date of dates) {
      const wd = new Date(date).getDay();
      const samples = byWeekday.get(wd);
      const required = (samples?.length ? curveFor(samples) : fallback)
        .map(v => Math.ceil(v * demandScale));
      const day = computeShiftMix(date, required, maxStaffPerDay);
      mixByDate.set(date, day.mix);
      demandDays.push(day);
    }

    const roster = assignRoster(dates, mixByDate, pool, ytdDist, lastShifts, consecDays, {
      minRestHours: options.minRestHours,
      offDaysPerWeek: options.offDaysPerWeek,
    });

    // ── 4. Shape the output: grid + per-day coverage + honest gaps ───────────
    const byEmp = new Map<string, Record<string, string>>();
    for (const a of roster.assignments) {
      const m = byEmp.get(a.employeeId) ?? {};
      m[a.date] = a.code;
      byEmp.set(a.employeeId, m);
    }
    const grid = pool.map(e => ({
      employeeId: e.id, employeeNo: e.employeeNo, name: e.name,
      gender: e.gender, functionName: e.functionName,
      days: byEmp.get(e.id) ?? {},
    }));

    const totalResidual = demandDays.reduce((s, d) => s + d.residualGaps.length, 0);
    return {
      weekStart, weekEnd: dates[6], mode: 'demand-driven',
      demand: {
        basis: byWeekday.size >= 5
          ? `P90 per weekday over ${allCurves.length} measured days`
          : `sparse history (${allCurves.length} measured day(s)) — same curve applied to all weekdays; accuracy improves as data accumulates`,
        demandScale,
        days: demandDays.map(d => ({
          date: d.date, mix: d.mix,
          requiredPeak: Math.max(...d.requiredCurve),
          staffedPeak:  Math.max(...d.staffedCurve),
          requiredCurve: d.requiredCurve, staffedCurve: d.staffedCurve,
          residualGaps: d.residualGaps,
        })),
      },
      grid,
      unfilled: roster.unfilled,
      warnings: roster.warnings,
      summary: {
        employees: pool.length,
        totalShiftsPlanned: roster.assignments.filter(a => a.code !== 'OFF').length,
        totalOffDays:       roster.assignments.filter(a => a.code === 'OFF').length,
        unfilledSlots:      roster.unfilled.length,
        residualGapIntervals: totalResidual,
        femaleNWarnings:    roster.warnings.length,
      },
    };
  }

  // ── Date helpers ────────────────────────────────────────────────────────────
  private fmtDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private weekRange(weekStart: string): { from: string; to: string } {
    const d = new Date(weekStart);
    const to = new Date(d);
    to.setDate(d.getDate() + 6);
    return { from: this.fmtDate(d), to: this.fmtDate(to) };
  }

  private addWeeks(dateStr: string, n: number): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + n * 7);
    return this.fmtDate(d);
  }

  // ── Derive shift from start/end times ────────────────────────────────────────
  private deriveShiftFromStart(startTime: string | null, endTime?: string | null): ShiftDef {
    if (!startTime) return SHIFTS.OFF;
    const h = parseInt(startTime.split(':')[0], 10);
    if (h >= 6  && h < 10) return SHIFTS.M;
    if (h >= 10 && h < 12) return SHIFTS.B;
    if (h >= 12 && h < 14) return SHIFTS.C;
    if (h >= 14 && h < 17) return SHIFTS.E;
    if (h >= 17 && h < 20) return SHIFTS.N;
    if (h >= 20 && h < 23) return SHIFTS.N2;
    return SHIFTS.MD;
  }

  // ── Load active employees ────────────────────────────────────────────────────
  private async loadEmployees(
    tenantId: string,
    functionIds?: string[],
  ): Promise<{ id: string; name: string; employees: EmployeeInfo[] }[]> {
    let whereExtra = '';
    const params: any[] = [tenantId];
    if (functionIds && functionIds.length > 0) {
      whereExtra = ` AND e.function_id = ANY($2::uuid[])`;
      params.push(functionIds);
    }

    const rows = await this.ds.query(
      `SELECT e.id, e.employee_no, e.first_name_en, e.last_name_en,
              e.gender, e.employment_type, f.id AS fn_id, f.name AS fn_name
       FROM employees e
       LEFT JOIN functions f ON e.function_id = f.id
       WHERE e.tenant_id = $1 AND e.status = 'active'${whereExtra}
       ORDER BY f.name, e.first_name_en`,
      params,
    );

    // Group by function
    const fnMap = new Map<string, { id: string; name: string; employees: EmployeeInfo[] }>();
    for (const r of rows) {
      const fnKey = r.fn_id ?? 'no-function';
      if (!fnMap.has(fnKey)) {
        fnMap.set(fnKey, { id: fnKey, name: r.fn_name ?? 'بدون قسم', employees: [] });
      }
      fnMap.get(fnKey)!.employees.push({
        id:              r.id,
        employeeNo:      r.employee_no,
        name:            `${r.first_name_en} ${r.last_name_en ?? ''}`.trim(),
        gender:          r.gender,
        employmentType:  r.employment_type,
        functionId:      r.fn_id ?? '',
        functionName:    r.fn_name ?? '—',
      });
    }
    return Array.from(fnMap.values()).filter((fn) => fn.employees.length > 0);
  }

  // Helper: derive shift code label from start time (for byCodes tracking)
  private deriveShiftCode(start: string | null): string {
    if (!start) return 'OFF';
    const h = parseInt(start.split(':')[0], 10);
    if (h >= 6  && h < 10) return 'M';
    if (h >= 10 && h < 12) return 'B';
    if (h >= 12 && h < 14) return 'C';
    if (h >= 14 && h < 17) return 'E';   // covers N/E family 14-16
    if (h >= 17 && h < 20) return 'N';
    if (h >= 20 && h < 23) return 'EE';
    return 'MD';
  }

  // Helper: is a date a weekend day (Fri=5 or Sat=6 in JS getDay())
  private isWeekend(dateStr: string): boolean {
    const d = new Date(dateStr + 'T00:00:00');
    return d.getDay() === 5 || d.getDay() === 6;
  }

  // ── Load YTD shift distribution ─────────────────────────────────────────────
  private async loadYtdDistribution(
    tenantId: string,
    employeeIds: string[],
    weekStart: string,
  ): Promise<Map<string, ShiftDistribution>> {
    const yearStart = `${weekStart.substring(0, 4)}-01-01`;
    const yesterday = new Date(weekStart);
    yesterday.setDate(yesterday.getDate() - 1);
    const ytdEnd = this.fmtDate(yesterday);

    const rows = await this.ds.query(
      `SELECT
         ar.employee_id,
         ar.attendance_marker,
         ar.scheduled_start,
         ar.scheduled_end,
         ar.attendance_date::date::text AS attendance_date
       FROM attendance_records ar
       WHERE ar.tenant_id = $1
         AND ar.employee_id = ANY($2::uuid[])
         AND ar.attendance_date BETWEEN $3 AND $4`,
      [tenantId, employeeIds, yearStart, ytdEnd],
    );

    const emptyDist = (): ShiftDistribution => ({
      morning: 0, afternoon: 0, evening: 0, night: 0, midnight: 0,
      off: 0, leave: 0, total: 0,
      byCodes: {}, weekendOff: 0, weekendWork: 0, maxConsecutive: 0,
    });

    const distMap = new Map<string, ShiftDistribution>();
    const consecutiveMap = new Map<string, { current: number; max: number }>();

    for (const r of rows) {
      if (!distMap.has(r.employee_id)) {
        distMap.set(r.employee_id, emptyDist());
        consecutiveMap.set(r.employee_id, { current: 0, max: 0 });
      }
      const d = distMap.get(r.employee_id)!;
      const cons = consecutiveMap.get(r.employee_id)!;
      const isWknd = this.isWeekend(r.attendance_date);
      d.total++;

      if (r.attendance_marker === 'off') {
        d.off++;
        if (isWknd) d.weekendOff++;
        cons.current = 0;
        continue;
      }
      if (r.attendance_marker === 'leave' || r.attendance_marker === 'sick' || r.attendance_marker === 'comp') {
        d.leave++;
        cons.current = 0;
        continue;
      }
      if (r.attendance_marker === 'absent' || r.attendance_marker === 'holiday') {
        d.total--;
        cons.current = 0;
        continue;
      }

      // Working day
      cons.current++;
      if (cons.current > cons.max) cons.max = cons.current;
      if (isWknd) d.weekendWork++;

      const shift = this.deriveShiftFromStart(r.scheduled_start, r.scheduled_end);
      if (shift.category === 'morning')        d.morning++;
      else if (shift.category === 'afternoon') d.afternoon++;
      else if (shift.category === 'evening')   d.evening++;
      else if (shift.category === 'night')     d.night++;
      else if (shift.category === 'midnight')  d.midnight++;

      // Per-code count
      const code = this.deriveShiftCode(r.scheduled_start);
      d.byCodes[code] = (d.byCodes[code] ?? 0) + 1;
    }

    // Store max consecutive
    for (const [empId, dist] of distMap) {
      dist.maxConsecutive = consecutiveMap.get(empId)?.max ?? 0;
    }

    return distMap;
  }

  // ── Load last shift before week ─────────────────────────────────────────────
  private async loadLastShifts(
    tenantId: string,
    employeeIds: string[],
    beforeDate: string,
  ): Promise<Map<string, ShiftDef>> {
    const rows = await this.ds.query(
      `SELECT DISTINCT ON (ar.employee_id)
         ar.employee_id, ar.scheduled_start, ar.scheduled_end, ar.attendance_marker
       FROM attendance_records ar
       WHERE ar.tenant_id = $1
         AND ar.employee_id = ANY($2::uuid[])
         AND ar.attendance_date < $3
       ORDER BY ar.employee_id, ar.attendance_date DESC`,
      [tenantId, employeeIds, beforeDate],
    );

    const map = new Map<string, ShiftDef>();
    for (const r of rows) {
      if (r.attendance_marker === 'off') {
        map.set(r.employee_id, SHIFTS.OFF);
      } else {
        map.set(r.employee_id, this.deriveShiftFromStart(r.scheduled_start, r.scheduled_end));
      }
    }
    return map;
  }

  // ── Load consecutive working days before a date ──────────────────────────────
  private async loadConsecutiveDays(
    tenantId: string,
    employeeIds: string[],
    beforeDate: string,
  ): Promise<Map<string, number>> {
    // Fetch up to 7 days before weekStart (enough to detect consecutive days)
    const rows = await this.ds.query(
      `SELECT
         ar.employee_id,
         ar.attendance_date::date::text AS date,
         ar.attendance_marker
       FROM attendance_records ar
       WHERE ar.tenant_id = $1
         AND ar.employee_id = ANY($2::uuid[])
         AND ar.attendance_date::date >= ($3::date - interval '7 days')
         AND ar.attendance_date::date <  $3::date
       ORDER BY ar.employee_id, ar.attendance_date DESC`,
      [tenantId, employeeIds, beforeDate],
    );

    // Group by employee
    const byEmp = new Map<string, string[]>();
    for (const r of rows) {
      if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
      byEmp.get(r.employee_id)!.push(r.attendance_marker);
    }

    const result = new Map<string, number>();
    for (const [empId, markers] of byEmp) {
      let count = 0;
      // markers are sorted DESC (most recent first)
      for (const m of markers) {
        if (m === 'off' || m === 'leave' || m === 'sick' || m === 'absent' || m === 'holiday') break;
        count++;
      }
      result.set(empId, count);
    }
    return result;
  }

  // ── Main Generate ────────────────────────────────────────────────────────────
  async generate(
    tenantId: string,
    weekStart: string,
    functionIds?: string[],
    rawOptions?: Partial<GeneratorOptions>,
  ): Promise<GeneratorResult> {
    const options: GeneratorOptions = { ...DEFAULT_OPTIONS, ...rawOptions };

    // Load data
    const employeesByFunction = await this.loadEmployees(tenantId, functionIds);
    const allEmployeeIds = employeesByFunction.flatMap((fn) => fn.employees.map((e) => e.id));

    if (!allEmployeeIds.length) {
      return {
        weekStart, weekEnd: buildWeekDates(weekStart)[6],
        dates: buildWeekDates(weekStart),
        functions: [], coverage: [], violations: [], fairness: { score: 0, nightVariance: 0, midnightVariance: 0, morningVariance: 0, weekendFairnessScore: 100, details: [] },
        summary: { totalEmployees: 0, totalErrors: 0, totalWarnings: 0, avgCoveragePct: 0, offAssigned: 0, workingDays: 0 },
        generatedAt: new Date().toISOString(),
      };
    }

    const [ytdDist, lastShifts, consecDays] = await Promise.all([
      this.loadYtdDistribution(tenantId, allEmployeeIds, weekStart),
      this.loadLastShifts(tenantId, allEmployeeIds, weekStart),
      this.loadConsecutiveDays(tenantId, allEmployeeIds, weekStart),
    ]);

    const weeksCount = Math.min(Math.max(options.weeks ?? 1, 1), 4);

    // ── Single week (default path) ────────────────────────────────────────────
    if (weeksCount === 1) {
      return generateWeeklySchedule(employeesByFunction, ytdDist, lastShifts, weekStart, options, consecDays);
    }

    // ── Multi-week: run engine week by week, feed each week into the next ─────
    let currentWeekStart = weekStart;
    let currentLastShifts = new Map(lastShifts);
    let currentYtdDist = new Map(ytdDist);
    let currentConsecDays = new Map(consecDays);
    let combined: GeneratorResult | null = null;

    for (let w = 0; w < weeksCount; w++) {
      const weekResult = generateWeeklySchedule(
        employeesByFunction,
        currentYtdDist,
        currentLastShifts,
        currentWeekStart,
        options,
        currentConsecDays,
      );

      if (!combined) {
        combined = { ...weekResult, functions: weekResult.functions.map(fn => ({
          ...fn, employees: fn.employees.map(emp => ({ ...emp, assignments: [...emp.assignments] })),
        })) };
      } else {
        combined.weekEnd = weekResult.weekEnd;
        combined.dates   = [...combined.dates, ...weekResult.dates];

        for (const fn of combined.functions) {
          const wFn = weekResult.functions.find(f => f.id === fn.id);
          if (!wFn) continue;
          for (const emp of fn.employees) {
            const wEmp = wFn.employees.find(e => e.employee.id === emp.employee.id);
            if (!wEmp) continue;
            emp.assignments = [...emp.assignments, ...wEmp.assignments];
            emp.weekStats.morningCount   += wEmp.weekStats.morningCount;
            emp.weekStats.eveningCount   = (emp.weekStats.eveningCount ?? 0) + (wEmp.weekStats.eveningCount ?? 0);
            emp.weekStats.nightCount     += wEmp.weekStats.nightCount;
            emp.weekStats.midnightCount  += wEmp.weekStats.midnightCount;
            emp.weekStats.offCount       += wEmp.weekStats.offCount;
            emp.weekStats.violationCount += wEmp.weekStats.violationCount;
          }
        }

        combined.coverage   = [...combined.coverage, ...weekResult.coverage];
        combined.violations = [...combined.violations, ...weekResult.violations];
        combined.summary.totalErrors    = combined.violations.filter(v => v.severity === 'error').length;
        combined.summary.totalWarnings  = combined.violations.filter(v => v.severity === 'warning').length;
        combined.summary.workingDays    = combined.functions.reduce((t, fn) =>
          t + fn.employees.reduce((et, emp) =>
            et + emp.assignments.filter(a => a.shift.code !== 'OFF').length, 0), 0);
        combined.summary.offAssigned    = combined.functions.reduce((t, fn) =>
          t + fn.employees.reduce((et, emp) =>
            et + emp.assignments.filter(a => a.shift.code === 'OFF').length, 0), 0);
        // Use last week's fairness (most up-to-date distribution)
        combined.fairness = weekResult.fairness;
      }

      // Advance to next week
      currentWeekStart = this.addWeeks(currentWeekStart, 1);

      // Update lastShifts = last day's assignment for each employee
      const lastDate = weekResult.dates[weekResult.dates.length - 1];
      const nextLastShifts = new Map<string, ShiftDef>();
      for (const fn of weekResult.functions) {
        for (const emp of fn.employees) {
          const lastDay = emp.assignments.find(a => a.date === lastDate);
          if (lastDay) nextLastShifts.set(emp.employee.id, lastDay.shift);
        }
      }
      // Keep old entries for employees with no data in this week
      for (const [id, shift] of currentLastShifts) {
        if (!nextLastShifts.has(id)) nextLastShifts.set(id, shift);
      }
      currentLastShifts = nextLastShifts;

      // Update YTD distribution with this week's assignments
      const updatedDist = new Map<string, ShiftDistribution>();
      for (const [id, d] of currentYtdDist) updatedDist.set(id, { ...d });
      for (const fn of weekResult.functions) {
        for (const emp of fn.employees) {
          const dist: ShiftDistribution = updatedDist.get(emp.employee.id) ??
            { morning: 0, afternoon: 0, evening: 0, night: 0, midnight: 0, off: 0, leave: 0, total: 0, byCodes: {}, weekendOff: 0, weekendWork: 0, maxConsecutive: 0 };
          for (const day of emp.assignments) {
            if (day.shift.code === 'OFF') { dist.off++; dist.total++; }
            else {
              dist.total++;
              if (day.shift.category === 'morning')        dist.morning++;
              else if (day.shift.category === 'afternoon') dist.afternoon++;
              else if (day.shift.category === 'evening')   dist.evening++;
              else if (day.shift.category === 'night')     dist.night++;
              else if (day.shift.category === 'midnight')  dist.midnight++;
            }
          }
          updatedDist.set(emp.employee.id, dist);
        }
      }
      currentYtdDist = updatedDist;

      // Update consecutive days: count trailing working days from end of this week
      const nextConsecDays = new Map<string, number>();
      for (const fn of weekResult.functions) {
        for (const emp of fn.employees) {
          // Count backwards from last day of this week
          let streak = 0;
          for (let d = emp.assignments.length - 1; d >= 0; d--) {
            if (emp.assignments[d].shift.code === 'OFF') break;
            streak++;
          }
          nextConsecDays.set(emp.employee.id, streak);
        }
      }
      // Carry over employees not in this function set
      for (const [id, n] of currentConsecDays) {
        if (!nextConsecDays.has(id)) nextConsecDays.set(id, n);
      }
      currentConsecDays = nextConsecDays;
    }

    return combined!;
  }

  // ── Save Draft to DB ─────────────────────────────────────────────────────────
  async saveDraft(
    tenantId: string,
    result: GeneratorResult,
    generatedByUserId: string,
    label?: string,
  ): Promise<string> {
    // Check if a draft already exists for this week
    const existing = await this.ds.query(
      `SELECT id, version_number FROM schedule_versions
       WHERE tenant_id = $1 AND period_start = $2 AND status = 'draft'
       ORDER BY version_number DESC LIMIT 1`,
      [tenantId, result.weekStart],
    );

    const versionNumber = existing.length > 0 ? existing[0].version_number + 1 : 1;

    // Create version
    const [version] = await this.ds.query(
      `INSERT INTO schedule_versions
         (id, tenant_id, period_type, period_start, period_end, status,
          version_number, label, notes, generated_at, generated_by,
          coverage_gaps, fairness_score, total_employees, total_working_entries, created_by)
       VALUES
         (gen_random_uuid(), $1, 'weekly', $2, $3, 'draft',
          $4, $5, $6, NOW(), $7,
          $8, $9, $10, $11, $7)
       RETURNING id`,
      [
        tenantId,
        result.weekStart,
        result.weekEnd,
        versionNumber,
        label ?? `Draft v${versionNumber} — Week of ${result.weekStart}`,
        `Generated: ${result.summary.totalErrors} errors, ${result.summary.totalWarnings} warnings`,
        generatedByUserId,
        JSON.stringify(result.violations.filter((v) => v.type === 'coverage_gap')),
        result.fairness.score,
        result.summary.totalEmployees,
        result.summary.workingDays,
      ],
    );

    const versionId: string = version.id;

    // Insert schedule entries (batch)
    const entries: any[] = [];
    for (const fn of result.functions) {
      for (const es of fn.employees) {
        for (const day of es.assignments) {
          entries.push({
            versionId,
            tenantId,
            employeeId: es.employee.id,
            entryDate: day.date,
            shiftCodeDisplay: day.shift.code,
            attendanceMarker: day.shift.code === 'OFF' ? 'off' : 'present',
            validationFlags: day.violations.length > 0 ? JSON.stringify(day.violations) : null,
          });
        }
      }
    }

    // Insert in batches of 100
    for (let i = 0; i < entries.length; i += 100) {
      const batch = entries.slice(i, i + 100);
      const values = batch
        .map((_, j) => {
          const base = j * 7;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
        })
        .join(', ');
      const params: any[] = [];
      batch.forEach((e) => {
        params.push(
          e.versionId, e.tenantId, e.employeeId,
          e.entryDate, e.shiftCodeDisplay,
          e.attendanceMarker,
          e.validationFlags,
        );
      });
      await this.ds.query(
        `INSERT INTO schedule_entries
           (id, schedule_version_id, tenant_id, employee_id, entry_date,
            shift_code_display, attendance_marker, validation_flags, created_at, updated_at)
         SELECT gen_random_uuid(), vals.vid, vals.tid, vals.eid, vals.dt,
                vals.scd, vals.am::attendance_marker_enum, vals.vf::jsonb, NOW(), NOW()
         FROM (VALUES ${values}) AS vals(vid, tid, eid, dt, scd, am, vf)`,
        params,
      );
    }

    return versionId;
  }

  // ── List Versions ─────────────────────────────────────────────────────────────
  async listVersions(tenantId: string, weekStart?: string) {
    const where = weekStart
      ? `WHERE tenant_id = $1 AND period_start = $2`
      : `WHERE tenant_id = $1`;
    const params = weekStart ? [tenantId, weekStart] : [tenantId];
    return this.ds.query(
      `SELECT id, period_start, period_end, status, version_number, label,
              fairness_score, total_employees, total_working_entries,
              generated_at, published_at, created_at
       FROM schedule_versions
       ${where}
       ORDER BY period_start DESC, version_number DESC
       LIMIT 50`,
      params,
    );
  }

  // ── Get Version Entries ───────────────────────────────────────────────────────
  async getVersionEntries(tenantId: string, versionId: string) {
    const version = await this.ds.query(
      `SELECT * FROM schedule_versions WHERE id = $1 AND tenant_id = $2`,
      [versionId, tenantId],
    );
    if (!version.length) return null;

    const entries = await this.ds.query(
      `SELECT se.*, e.first_name_en, e.last_name_en, e.employee_no, e.gender,
              f.name AS function_name
       FROM schedule_entries se
       JOIN employees e ON se.employee_id = e.id
       LEFT JOIN functions f ON e.function_id = f.id
       WHERE se.schedule_version_id = $1 AND se.tenant_id = $2
       ORDER BY f.name, e.first_name_en, se.entry_date`,
      [versionId, tenantId],
    );

    return { version: version[0], entries };
  }

  // ── Publish Version ───────────────────────────────────────────────────────────
  async publishVersion(tenantId: string, versionId: string, userId: string) {
    await this.ds.query(
      `UPDATE schedule_versions
       SET status = 'published', published_at = NOW(), published_by = $3, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status IN ('draft','generated','reviewed')`,
      [versionId, tenantId, userId],
    );
    return { success: true, versionId };
  }

  // ── Available Weeks ───────────────────────────────────────────────────────────
  async getAvailableWeeks(tenantId: string): Promise<string[]> {
    const rows = await this.ds.query(
      `SELECT DISTINCT
         (attendance_date - (((EXTRACT(DOW FROM attendance_date)::int + 1) % 7) * INTERVAL '1 day'))::date AS week_sat
       FROM attendance_records
       WHERE tenant_id = $1
       ORDER BY week_sat DESC`,
      [tenantId],
    );
    const fmtDate = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return rows.map((r: any) => fmtDate(new Date(r.week_sat)));
  }

  // ── Functions list ─────────────────────────────────────────────────────────
  async getFunctions(tenantId: string) {
    return this.ds.query(
      `SELECT f.id, f.name, COUNT(DISTINCT e.id) AS employee_count
       FROM functions f
       LEFT JOIN employees e ON e.function_id = f.id AND e.tenant_id = $1 AND e.status = 'active'
       WHERE f.tenant_id = $1
       GROUP BY f.id, f.name
       HAVING COUNT(DISTINCT e.id) > 0
       ORDER BY COUNT(DISTINCT e.id) DESC`,
      [tenantId],
    );
  }
}
