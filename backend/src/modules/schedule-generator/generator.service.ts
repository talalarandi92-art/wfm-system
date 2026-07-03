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
import { shiftCategoryFromCode } from '@common/shift-category';

const DEFAULT_OPTIONS: GeneratorOptions = {
  minRestHours: 10,
  offDaysPerWeek: 2,   // business rule: 2 OFF days/week (one weekend + one mid-week)
  internProductivity: 0.70,
  // Females end by C (21:00) by default; late shifts (E/N) only when a supervisor
  // explicitly enables the exception. Midnight (N2/MD) always blocked.
  allowFemaleN: false,
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
    weekStart = this.snapToSaturday(weekStart);   // workforce week always Sat→Fri
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
    const [ytdDist, lastShifts, consecDays, leaveRows] = await Promise.all([
      // preSwap=true: fairness on the PRE-swap schedule (user rule — swaps must not game rotation)
      this.loadYtdDistribution(tenantId, pool.map(e => e.id), from, true),
      this.loadLastShifts(tenantId, pool.map(e => e.id), from),
      this.loadConsecutiveDays(tenantId, pool.map(e => e.id), from),
      // Approved leaves overlapping the target week → unavailable days
      this.ds.query(
        `SELECT r.employee_id, rl.start_date::date::text AS start_date, rl.end_date::date::text AS end_date
         FROM requests r
         JOIN request_leaves rl ON rl.request_id = r.id
         WHERE r.tenant_id = $1 AND r.status = 'approved'
           AND rl.start_date <= $3::date AND rl.end_date >= $2::date`,
        [tenantId, from, to],
      ).catch(() => []),
    ]);

    // empId → Set of week dates covered by approved leave
    const onLeave = new Map<string, Set<string>>();
    for (const lv of leaveRows) {
      for (const date of dates) {
        if (date >= lv.start_date && date <= lv.end_date) {
          (onLeave.get(lv.employee_id) ?? onLeave.set(lv.employee_id, new Set()).get(lv.employee_id)!).add(date);
        }
      }
    }

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
      onLeave,
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

    // Current operational context — the plan is anchored to TODAY's reality
    const [liveSnap] = await this.ds.query(
      `SELECT agents_json, captured_at FROM integration_snapshots
       WHERE tenant_id = $1 AND source = 'sprinklr'
       ORDER BY captured_at DESC LIMIT 1`, [tenantId]).catch(() => [null]);
    const liveAgents = liveSnap
      ? (Array.isArray(liveSnap.agents_json) ? liveSnap.agents_json : JSON.parse(liveSnap.agents_json || '[]'))
      : [];
    const [permRow] = await this.ds.query(
      `SELECT COUNT(*) AS cnt FROM requests r
       JOIN request_permissions rp ON rp.request_id = r.id
       WHERE r.tenant_id = $1 AND r.status = 'approved'
         AND rp.permission_date = (NOW() AT TIME ZONE 'Asia/Kuwait')::date
         AND rp.start_time <= (NOW() AT TIME ZONE 'Asia/Kuwait')::time
         AND rp.end_time   >= (NOW() AT TIME ZONE 'Asia/Kuwait')::time`,
      [tenantId]).catch(() => [{ cnt: 0 }]);

    const days = demandDays.map(d => {
      const onLeaveCount = [...onLeave.values()].filter(s => s.has(d.date)).length;
      const requiredPeak = Math.max(...d.requiredCurve);
      const staffedPeak  = Math.max(...d.staffedCurve);
      // Risk verdict per day: gaps in the daytime window are what matters
      // (pre-07:00 gaps are coverable only by prior-day MD tails — known limitation)
      const daytimeGaps = d.residualGaps.filter((g: any) => +g.interval.slice(0, 2) >= 7);
      const riskStatus = daytimeGaps.length > 0 ? 'critical'
        : staffedPeak < requiredPeak * 0.95 ? 'warning' : 'safe';
      return {
        date: d.date, mix: d.mix,
        requiredPeak, staffedPeak,
        availablePool: pool.length - onLeaveCount,
        onApprovedLeave: onLeaveCount,
        riskStatus,
        requiredCurve: d.requiredCurve, staffedCurve: d.staffedCurve,
        residualGaps: d.residualGaps,
      };
    });

    return {
      weekStart, weekEnd: dates[6], mode: 'demand-driven',
      currentContext: {
        activeEmployees: pool.length,
        liveOnlineNow: liveAgents.filter((a: any) =>
          ['available', 'idle', 'busy'].includes(a.status)).length,
        onActivePermissionNow: +(permRow?.cnt ?? 0),
        liveCapturedAt: liveSnap?.captured_at ?? null,
      },
      demand: {
        basis: byWeekday.size >= 5
          ? `P90 per weekday over ${allCurves.length} measured days`
          : `sparse history (${allCurves.length} measured day(s)) — same curve applied to all weekdays; accuracy improves as data accumulates`,
        demandScale,
        days,
      },
      grid,
      unfilled: roster.unfilled,
      warnings: roster.warnings,
      summary: {
        employees: pool.length,
        totalShiftsPlanned: roster.assignments.filter(a => a.code !== 'OFF' && a.code !== 'L').length,
        totalOffDays:       roster.assignments.filter(a => a.code === 'OFF').length,
        totalLeaveDays:     roster.assignments.filter(a => a.code === 'L').length,
        unfilledSlots:      roster.unfilled.length,
        residualGapIntervals: totalResidual,
        femaleNWarnings:    roster.warnings.length,
        criticalDays: days.filter(d => d.riskStatus === 'critical').length,
        safeDays:     days.filter(d => d.riskStatus === 'safe').length,
        fairnessBasis: 'pre-swap (approved swaps reversed before counting — swaps cannot game rotation)',
      },
    };
  }

  /**
   * Shift-rate comparison: each employee's rotation distribution BEFORE
   * approved swaps (the fairness basis) vs AFTER (what actually runs).
   * Answers «روتيشن ٪ قبل التبديلات و٪ بعد التبديلات».
   */
  async getShiftRateComparison(tenantId: string, weekStart: string, functionIds?: string[]) {
    const fns = await this.loadEmployees(tenantId, functionIds);
    const pool = fns.flatMap(f => f.employees);
    if (!pool.length) return { weekStart, rows: [] };
    const ids = pool.map(e => e.id);

    const [pre, post] = await Promise.all([
      this.loadYtdDistribution(tenantId, ids, weekStart, true),   // swaps reversed
      this.loadYtdDistribution(tenantId, ids, weekStart, false),  // as scheduled today
    ]);

    const CATS = ['morning', 'afternoon', 'evening', 'night', 'midnight'] as const;
    const pctView = (d?: ShiftDistribution) => {
      const working = d ? CATS.reduce((s, c) => s + (d as any)[c], 0) : 0;
      const out: Record<string, { count: number; pct: number }> = {};
      for (const c of CATS) {
        const count = d ? (d as any)[c] : 0;
        out[c] = { count, pct: working ? +((count / working) * 100).toFixed(1) : 0 };
      }
      return { byCategory: out, workingTotal: working };
    };

    const rows = pool.map(e => {
      const a = pctView(pre.get(e.id));
      const b = pctView(post.get(e.id));
      const delta: Record<string, number> = {};
      let changed = false;
      for (const c of CATS) {
        delta[c] = +(b.byCategory[c].pct - a.byCategory[c].pct).toFixed(1);
        if (delta[c] !== 0) changed = true;
      }
      return {
        employeeId: e.id, employeeNo: e.employeeNo, name: e.name,
        gender: e.gender, functionName: e.functionName,
        preSwap: a, postSwap: b, deltaPct: delta, affectedBySwaps: changed,
      };
    });

    return {
      weekStart,
      fairnessBasis: 'preSwap — the generator uses these numbers so swaps cannot game rotation',
      affectedEmployees: rows.filter(r => r.affectedBySwaps).length,
      rows: rows.sort((x, y) => Number(y.affectedBySwaps) - Number(x.affectedBySwaps)
        || x.name.localeCompare(y.name)),
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

  /**
   * Snap any date to the Saturday that starts its workforce week (Sat→Fri).
   * The generator engine treats dates[0] as Saturday and assigns exactly
   * `offDaysPerWeek` OFFs inside each 7-day block. If weekStart is NOT a
   * Saturday, every block straddles a true Sat→Fri boundary and OFF days pile
   * up (e.g. 3 in one calendar week) while day names get mislabeled. Snapping
   * here guarantees each generated week == one true calendar week.
   * JS getDay(): 0=Sun … 6=Sat → days to subtract = (getDay() + 1) % 7.
   */
  private snapToSaturday(dateStr: string): string {
    const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
    if (isNaN(d.getTime())) return dateStr;
    const back = (d.getDay() + 1) % 7;
    d.setDate(d.getDate() - back);
    return this.fmtDate(d);
  }

  // ── Derive shift from start time — FALLBACK ONLY when the row has no shift
  //    code. Bands aligned with the canonical shiftCategoryFromHour
  //    (common/shift-category.ts): M 07 · B 09 · C 11 · N 13 · E 16 · EE 18 · MD 22.
  private deriveShiftFromStart(startTime: string | null, endTime?: string | null): ShiftDef {
    if (!startTime) return SHIFTS.OFF;
    const h = parseInt(startTime.split(':')[0], 10);
    if (h >= 5  && h <= 8)  return SHIFTS.M;
    if (h >= 9  && h <= 10) return SHIFTS.B;
    if (h >= 11 && h <= 12) return SHIFTS.C;
    if (h >= 13 && h <= 15) return SHIFTS.N;
    if (h >= 16 && h <= 17) return SHIFTS.E;
    if (h >= 18 && h <= 20) return SHIFTS.N2;   // EE
    if (h >= 21 && h <= 22) return SHIFTS.MD;
    return SHIFTS.MN;
  }

  // ── CODE-FIRST classification (canonical rule — WFM_RULES §3): resolve a raw
  //    scheduled shift code to its catalog ShiftDef via the ONE classifier.
  //    Returns null when the code is unclassifiable → caller falls back to hours.
  private shiftDefFromCode(codeRaw: string | null | undefined): ShiftDef | null {
    if (!codeRaw) return null;
    const cat = shiftCategoryFromCode(codeRaw);
    if (cat === 'other') return null;
    const code = String(codeRaw).toUpperCase()
      .replace(/^WFH[-_]?/, '').replace(/[-_]?WFH$/, '').trim();
    // Exact/prefix catalog match, longest code first (MD before M, EE before E)
    const match = Object.values(SHIFTS)
      .filter(s => s.code !== 'OFF' && s.code !== 'L')
      .sort((a, b) => b.code.length - a.code.length)
      .find(s => code === s.code || code.startsWith(s.code));
    if (match) return match;
    // No direct catalog entry (e.g. AM) → category representative
    if (cat === 'midnight') return SHIFTS.MD;
    if (cat === 'night')    return SHIFTS.N;
    if (cat === 'evening')  return SHIFTS.E;
    return SHIFTS.M;
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

  // Helper: derive shift code label from start time (fallback for byCodes when
  // the row carries no code) — delegates to the ONE hour→ShiftDef fallback.
  private deriveShiftCode(start: string | null): string {
    return this.deriveShiftFromStart(start).code;
  }

  // Helper: is a date a weekend day. OFFICIAL RULING (Director, 2026-07-02):
  // weekend = THURSDAY + FRIDAY only. JS getDay(): Thu=4, Fri=5.
  private isWeekend(dateStr: string): boolean {
    const d = new Date(dateStr + 'T00:00:00');
    return d.getDay() === 4 || d.getDay() === 5; // Thu, Fri
  }

  // ── Load YTD shift distribution ─────────────────────────────────────────────
  /**
   * YTD shift distribution for fairness.
   *
   * FAIRNESS RULE (user decision): fairness is computed on the schedule
   * BEFORE approved shift swaps. Swapping must never game the rotation —
   * if you traded your midnight away, it still counts as YOURS.
   * `preSwap=true` (generator default) reverses approved swaps before counting.
   */
  private async loadYtdDistribution(
    tenantId: string,
    employeeIds: string[],
    weekStart: string,
    preSwap = true,
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
         sc.code AS shift_code,
         ar.attendance_date::date::text AS attendance_date
       FROM attendance_records ar
       LEFT JOIN shift_codes sc ON sc.id = ar.scheduled_shift_code_id
       WHERE ar.tenant_id = $1
         AND ar.employee_id = ANY($2::uuid[])
         AND ar.attendance_date BETWEEN $3 AND $4`,
      [tenantId, employeeIds, yearStart, ytdEnd],
    );

    // Reverse approved swaps: restore each side's ORIGINAL shift times
    if (preSwap) {
      const swaps = await this.ds.query(
        `SELECT r.employee_id AS requester_id, rs.target_employee_id,
                rs.requester_date::date::text AS requester_date,
                rs.target_date::date::text    AS target_date,
                sc1.start_time AS req_start, sc1.end_time AS req_end, sc1.code AS req_code,
                sc2.start_time AS tgt_start, sc2.end_time AS tgt_end, sc2.code AS tgt_code
         FROM request_shift_swaps rs
         JOIN requests r ON r.id = rs.request_id AND r.status = 'approved'
         LEFT JOIN shift_codes sc1 ON sc1.id = rs.requester_shift_code_id
         LEFT JOIN shift_codes sc2 ON sc2.id = rs.target_shift_code_id
         WHERE r.tenant_id = $1
           AND rs.requester_date BETWEEN $2 AND $3`,
        [tenantId, yearStart, ytdEnd],
      ).catch(() => []);

      if (swaps.length) {
        // (employeeId|date) → original times + code
        const original = new Map<string, { start: string | null; end: string | null; code: string | null }>();
        for (const s of swaps) {
          original.set(`${s.requester_id}|${s.requester_date}`,
            { start: s.req_start, end: s.req_end, code: s.req_code });
          if (s.target_employee_id) {
            original.set(`${s.target_employee_id}|${s.target_date ?? s.requester_date}`,
              { start: s.tgt_start, end: s.tgt_end, code: s.tgt_code });
          }
        }
        for (const r of rows) {
          const o = original.get(`${r.employee_id}|${r.attendance_date}`);
          if (o) { r.scheduled_start = o.start; r.scheduled_end = o.end; r.shift_code = o.code; }
        }
      }
    }

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

      // CODE-FIRST (canonical rule): classify by the scheduled shift CODE via
      // the ONE classifier; fall back to the hour-derived code ONLY when the
      // row carries no code. The raw code feeds byCodes.
      const code: string = r.shift_code ?? this.deriveShiftCode(r.scheduled_start);
      const cat = shiftCategoryFromCode(code);
      if (cat === 'morning')        d.morning++;
      else if (cat === 'evening')   d.evening++;
      else if (cat === 'night')     d.night++;
      else if (cat === 'midnight')  d.midnight++;

      // Per-code count
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
         ar.employee_id, ar.scheduled_start, ar.scheduled_end, ar.attendance_marker,
         sc.code AS shift_code
       FROM attendance_records ar
       LEFT JOIN shift_codes sc ON sc.id = ar.scheduled_shift_code_id
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
        // Code-first; hour fallback ONLY when the row has no shift code
        map.set(r.employee_id,
          this.shiftDefFromCode(r.shift_code)
            ?? this.deriveShiftFromStart(r.scheduled_start, r.scheduled_end));
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

  /** Audit a female late/N override when a schedule generated with it is saved. */
  async logFemaleOverride(tenantId: string, userId: string | null, options?: Partial<GeneratorOptions>) {
    if (!options) return;
    const flags: string[] = [];
    if (options.allowFemaleN) flags.push('allowFemaleN');
    if (options.femaleLateFunctionIds?.length) flags.push(`femaleLateFunctionIds=[${options.femaleLateFunctionIds.join(',')}]`);
    if (!flags.length) return;
    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, action, module, entity_type, entity_id, notes)
       VALUES ($1,$2,'schedule.female_late_override','schedule-generator','schedule',NULL,$3)`,
      [tenantId, userId ?? null, `Female late/N override used at generation: ${flags.join('; ')}`],
    ).catch(() => {});
  }

  // ── Main Generate ────────────────────────────────────────────────────────────
  async generate(
    tenantId: string,
    weekStart: string,
    functionIds?: string[],
    rawOptions?: Partial<GeneratorOptions>,
  ): Promise<GeneratorResult> {
    const options: GeneratorOptions = { ...DEFAULT_OPTIONS, ...rawOptions };
    weekStart = this.snapToSaturday(weekStart);   // workforce week always Sat→Fri

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

    const weeksCount = Math.min(Math.max(options.weeks ?? 1, 1), 4);

    // Full generation horizon (for the approved-leave lookup)
    const allDates: string[] = [];
    for (let w = 0; w < weeksCount; w++) allDates.push(...buildWeekDates(this.addWeeks(weekStart, w)));
    const horizonFrom = allDates[0];
    const horizonTo = allDates[allDates.length - 1];

    const [ytdDist, lastShifts, consecDays, leaveRows] = await Promise.all([
      this.loadYtdDistribution(tenantId, allEmployeeIds, weekStart),
      this.loadLastShifts(tenantId, allEmployeeIds, weekStart),
      this.loadConsecutiveDays(tenantId, allEmployeeIds, weekStart),
      // Approved leaves overlapping the horizon → those days become 'L'
      this.ds.query(
        `SELECT r.employee_id, rl.start_date::date::text AS start_date, rl.end_date::date::text AS end_date
         FROM requests r
         JOIN request_leaves rl ON rl.request_id = r.id
         WHERE r.tenant_id = $1 AND r.status = 'approved'
           AND rl.start_date <= $3::date AND rl.end_date >= $2::date`,
        [tenantId, horizonFrom, horizonTo],
      ).catch(() => []),
    ]);

    // empId → Set of dates covered by approved leave (same shape as the demand path)
    const onLeave = new Map<string, Set<string>>();
    for (const lv of leaveRows) {
      for (const date of allDates) {
        if (date >= lv.start_date && date <= lv.end_date) {
          (onLeave.get(lv.employee_id) ?? onLeave.set(lv.employee_id, new Set()).get(lv.employee_id)!).add(date);
        }
      }
    }

    // ── Single week (default path) ────────────────────────────────────────────
    if (weeksCount === 1) {
      return generateWeeklySchedule(employeesByFunction, ytdDist, lastShifts, weekStart, options, consecDays, onLeave);
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
        onLeave,
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
            emp.weekStats.afternoonCount = (emp.weekStats.afternoonCount ?? 0) + (wEmp.weekStats.afternoonCount ?? 0);
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
            const wknd = this.isWeekend(day.date);
            if (day.shift.code === 'OFF') {
              dist.off++; dist.total++;
              if (wknd) dist.weekendOff = (dist.weekendOff ?? 0) + 1;
            } else {
              dist.total++;
              if (wknd) dist.weekendWork = (dist.weekendWork ?? 0) + 1;
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
         SELECT gen_random_uuid(), vals.vid::uuid, vals.tid::uuid, vals.eid::uuid, vals.dt::date,
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
  async publishVersion(tenantId: string, versionId: string, userId: string, force = false) {
    const [version] = await this.ds.query(
      `SELECT id, period_start::date::text AS period_start, period_end::date::text AS period_end
       FROM schedule_versions WHERE id = $1 AND tenant_id = $2`,
      [versionId, tenantId],
    );
    if (!version) throw new BadRequestException('Schedule version not found.');

    // PUBLISH-OVERWRITE GUARD (business rule 6.7): a published/locked schedule
    // must never be silently overwritten by publishing another version over the
    // same period. An explicit force archives the old version(s) — audited below.
    const conflicts = await this.ds.query(
      `SELECT id, label, status
       FROM schedule_versions
       WHERE tenant_id = $1 AND id <> $2 AND status IN ('published','locked')
         AND period_start <= $4::date AND period_end >= $3::date`,
      [tenantId, versionId, version.period_start, version.period_end],
    );
    if (conflicts.length && !force) {
      throw new BadRequestException(
        `A published/locked schedule already covers ${version.period_start} → ${version.period_end}: ` +
        conflicts.map((c: any) => `"${c.label ?? c.id}" (${c.status})`).join('; ') +
        `. Re-publish with force=true to archive it and replace, or edit the published version instead.`,
      );
    }
    if (conflicts.length && force) {
      await this.ds.query(
        `UPDATE schedule_versions SET status = 'archived', updated_at = NOW()
         WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, conflicts.map((c: any) => c.id)],
      );
    }

    await this.ds.query(
      `UPDATE schedule_versions
       SET status = 'published', published_at = NOW(), published_by = $3, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status IN ('draft','generated','reviewed')`,
      [versionId, tenantId, userId],
    );

    // Apply the published version to the live, agent-facing schedule. Each entry's
    // shift code is resolved to its scheduled times and upserted into
    // attendance_records (tenant, employee, date) — so once published, every agent
    // sees their new shifts. Only the SCHEDULED fields are touched; rows that
    // already carry ACTUAL punch/system data are skipped entirely (never rewrite
    // a day that has really been worked) and reported in the response.
    const [applied] = await this.ds.query(
      `WITH src AS (
         SELECT se.tenant_id, se.employee_id, se.entry_date, se.attendance_marker,
                sc.id AS shift_code_id, sc.start_time, sc.end_time, sc.start_time_2, sc.end_time_2
           FROM schedule_entries se
           LEFT JOIN shift_codes sc ON sc.tenant_id = se.tenant_id AND sc.code = se.shift_code_display
          WHERE se.schedule_version_id = $1 AND se.tenant_id = $2
       ),
       skipped AS (
         SELECT s.employee_id, s.entry_date
           FROM src s
           JOIN attendance_records ar
             ON ar.tenant_id = $2 AND ar.employee_id = s.employee_id AND ar.attendance_date = s.entry_date
          WHERE ar.punch_in IS NOT NULL OR ar.system_login IS NOT NULL
       ),
       ins AS (
         INSERT INTO attendance_records
           (id, tenant_id, employee_id, attendance_date, scheduled_shift_code_id,
            scheduled_start, scheduled_end, scheduled_start_2, scheduled_end_2,
            attendance_marker, created_at, updated_at)
         SELECT gen_random_uuid(), s.tenant_id, s.employee_id, s.entry_date, s.shift_code_id,
                s.start_time, s.end_time, s.start_time_2, s.end_time_2,
                s.attendance_marker::attendance_marker_enum, NOW(), NOW()
           FROM src s
          WHERE NOT EXISTS (
            SELECT 1 FROM skipped k
            WHERE k.employee_id = s.employee_id AND k.entry_date = s.entry_date)
         ON CONFLICT (tenant_id, employee_id, attendance_date) DO UPDATE SET
            scheduled_shift_code_id = EXCLUDED.scheduled_shift_code_id,
            scheduled_start   = EXCLUDED.scheduled_start,
            scheduled_end     = EXCLUDED.scheduled_end,
            scheduled_start_2 = EXCLUDED.scheduled_start_2,
            scheduled_end_2   = EXCLUDED.scheduled_end_2,
            attendance_marker = EXCLUDED.attendance_marker,
            updated_at = NOW()
         RETURNING 1
       )
       SELECT (SELECT COUNT(*)::int FROM ins)     AS n,
              (SELECT COUNT(*)::int FROM skipped) AS skipped`,
      [versionId, tenantId],
    );

    // Audit the forced replacement — one row per archived version.
    if (conflicts.length && force) {
      for (const c of conflicts) {
        await this.ds.query(
          `INSERT INTO audit_logs (tenant_id, actor_id, action, module, entity_type, entity_id, notes)
           VALUES ($1,$2,'schedule.published','schedule-generator','schedule_version',$3,$4)`,
          [tenantId, userId, c.id,
           `Force-published version ${versionId} over ${version.period_start} → ${version.period_end}; ` +
           `archived ${c.status} version ${c.id} ("${c.label ?? ''}"); ` +
           `applied ${applied?.n ?? 0} row(s) to attendance_records, skipped ${applied?.skipped ?? 0} with actual punch/system data`],
        ).catch(() => {});
      }
    }

    return {
      success: true,
      versionId,
      appliedToAgents: applied?.n ?? 0,
      skippedWithActuals: applied?.skipped ?? 0,
      archivedVersionIds: force ? conflicts.map((c: any) => c.id) : [],
    };
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
