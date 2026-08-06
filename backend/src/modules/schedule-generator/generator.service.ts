import {
  Injectable, BadRequestException, NotFoundException,
} from '@nestjs/common';
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
import { buildGenerateVerdict, fairnessFromDistributions } from './verdict.engine';
import { CapacityService } from '../capacity/capacity.service';
import { StaffingService } from '../capacity/staffing.service';
import { shiftCategoryFromCode } from '@common/shift-category';
import { normalizeShiftCode } from '@common/shift-normalize';

import { isWeekend as isWeekendDow } from '../../common/wfm-calc';
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
    private readonly staffing: StaffingService,
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

    // ── 1. Requirement curves — PRIMARY: the Staffing Requirement Engine ─────
    // (Director 2026-07-06: the generator's first constraint is the forecast→Erlang
    // hourly requirement per function — CPO/AHT/ACW/hold/occupancy/shrinkage/
    // productivity; rotation & humane rules apply INSIDE that envelope.)
    // FALLBACK: Sprinklr live-plan history (P90 per weekday) when no forecast data.
    let forecastByDate: Map<string, number[]> | null = null;
    // date → canonFn → 48-slot required curve — the per-function allocation inside ONE generate
    let fnCurveByDate: Map<string, Map<string, number[]>> | null = null;
    let forecastBasis = '';
    try {
      // scope the requirement to the same functions the pool is scoped to
      let functionKeys: string[] | undefined;
      if (options.functionIds?.length) {
        const rows = await this.ds.query(
          `SELECT DISTINCT canon_fn(name) AS k FROM functions WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tenantId, options.functionIds],
        );
        functionKeys = rows.map((r: any) => r.k);
      }
      const req = await this.staffing.hourlyRequirement(tenantId, weekStart, buildWeekDates(weekStart)[6], { functionKeys });
      const total = req.days.reduce((s: number, d: any) => s + d.totalCurve48.reduce((a: number, b: number) => a + b, 0), 0);
      if (total > 0) {
        forecastByDate = new Map(req.days.map((d: any) => [d.date, d.totalCurve48]));
        fnCurveByDate = new Map(req.days.map((d: any) => [
          d.date,
          new Map(d.functions.map((f: any) => {
            const curve = new Array(48).fill(0);
            for (const x of f.hours) { curve[x.hour * 2] = x.requiredScheduledHc; curve[x.hour * 2 + 1] = x.requiredScheduledHc; }
            return [f.functionKey, curve];
          })),
        ]));
        forecastBasis = req.basis;
      }
    } catch (e) { /* no staffing params / no volume history → fall back below */ }

    // weekday (0-6) → list of measured 48-curves (fallback basis)
    const byWeekday = new Map<number, number[][]>();
    const allCurves: number[][] = [];
    if (!forecastByDate) {
      const histDates: string[] = [];
      for (let i = 0; i <= 14; i++) {  // include TODAY — often the only measured day early on
        const d = new Date(Date.now() + 3 * 3600e3 - i * 86400e3);
        histDates.push(d.toISOString().slice(0, 10));
      }
      const plans = await Promise.all(
        histDates.map(d => this.capacity.getLivePlan(tenantId, d).catch(() => null)),
      );
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
          'No forecast basis (staffing engine) and no measured workload history — upload contact volume or keep the Sprinklr bridge running, then retry. ' +
          'لا يوجد أساس توقع ولا تاريخ حمل مُقاس — ارفع بيانات الفوليوم أو شغّل جسر سبرينكلر ثم أعد المحاولة.');
      }
    }

    const p90 = (vals: number[]) => {
      const s = [...vals].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
    };
    const curveFor = (samples: number[][]): number[] =>
      Array.from({ length: 48 }, (_, i) => p90(samples.map(c => c[i])));
    const fallback = allCurves.length ? curveFor(allCurves) : new Array(48).fill(0);

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

    const demandDays: any[] = [];
    let roster: ReturnType<typeof assignRoster>;
    // Per-day per-function coverage detail (populated in per-function mode)
    const perFunctionByDate = new Map<string, any[]>();
    const noCurveFns: string[] = [];

    if (fnCurveByDate) {
      // ── PER-FUNCTION allocation (Director 2026-07-07): each function gets its
      //    OWN hourly curve, its OWN shift mix, and its OWN pool — inside one
      //    generate. Rules (gender/rest/fairness/rotation) run per function, so
      //    coverage can never silently borrow bodies across functions.
      const assignments: any[] = [], unfilled: any[] = [], warnings: string[] = [];
      const fnDayParts = new Map<string, { fn: string; day: any }[]>(); // date → parts

      for (const grp of fns) {
        const hasCurve = dates.some(d => {
          const c = fnCurveByDate!.get(d)?.get(grp.name);
          return !!c && c.some(v => v > 0);
        });
        if (!hasCurve) {
          if (grp.employees.length) noCurveFns.push(`${grp.name} (${grp.employees.length})`);
          continue;
        }
        const poolF = grp.employees;
        const maxStaffF = Math.max(1, poolF.length - Math.ceil(poolF.length * options.offDaysPerWeek / 7));
        const mixF = new Map<string, Record<string, number>>();
        for (const date of dates) {
          const curve = fnCurveByDate!.get(date)?.get(grp.name) ?? new Array(48).fill(0);
          const required = curve.map(v => Math.ceil(v * demandScale));
          const day = computeShiftMix(date, required, maxStaffF);
          mixF.set(date, day.mix);
          (fnDayParts.get(date) ?? fnDayParts.set(date, []).get(date)!).push({ fn: grp.name, day });
        }
        const rosterF = assignRoster(dates, mixF, poolF, ytdDist, lastShifts, consecDays, {
          minRestHours: options.minRestHours,
          offDaysPerWeek: options.offDaysPerWeek,
          allowFemaleN: options.allowFemaleN,
          femaleLateFunctionIds: options.femaleLateFunctionIds,
          onLeave,
          offStrategy: options.offStrategy,
          rotationFairness: options.rotationFairness,
        });
        assignments.push(...rosterF.assignments);
        unfilled.push(...rosterF.unfilled.map(u => ({ ...u, functionName: grp.name })));
        warnings.push(...rosterF.warnings.map(w => `[${grp.name}] ${w}`));
      }
      if (noCurveFns.length) {
        warnings.push(
          `No forecast basis (not demand-staffed in staffing_params) — schedule manually or via the ladder: ${noCurveFns.join(', ')} · ` +
          `بدون أساس توقع — جدولة يدوية أو عبر الروتيشن التدريجي: ${noCurveFns.join(', ')}`);
      }
      roster = { assignments, unfilled, warnings };

      // Aggregate per-date totals (for the day summary) + keep per-function detail
      for (const date of dates) {
        const parts = fnDayParts.get(date) ?? [];
        const requiredCurve = new Array(48).fill(0), staffedCurve = new Array(48).fill(0);
        const mix: Record<string, number> = {}; const residualGaps: any[] = [];
        for (const p of parts) {
          p.day.requiredCurve.forEach((v: number, i: number) => { requiredCurve[i] += v; });
          p.day.staffedCurve.forEach((v: number, i: number) => { staffedCurve[i] += v; });
          for (const [c, n] of Object.entries(p.day.mix)) mix[c] = (mix[c] ?? 0) + (n as number);
          residualGaps.push(...p.day.residualGaps.map((g: any) => ({ ...g, functionName: p.fn })));
        }
        demandDays.push({ date, mix, requiredCurve, staffedCurve, residualGaps });
        perFunctionByDate.set(date, parts.map(p => ({
          functionName: p.fn,
          requiredPeak: Math.max(...p.day.requiredCurve, 0),
          staffedPeak: Math.max(...p.day.staffedCurve, 0),
          mix: p.day.mix,
          residualGaps: p.day.residualGaps.length,
        })));
      }
    } else {
      // ── Fallback: single total curve over the whole pool (live-plan history) ──
      const mixByDate = new Map<string, Record<string, number>>();
      const maxStaffPerDay = Math.max(1, pool.length - Math.ceil(pool.length * options.offDaysPerWeek / 7));
      for (const date of dates) {
        const samples = byWeekday.get(new Date(date).getDay());
        const base = samples?.length ? curveFor(samples) : fallback;
        const required = base.map(v => Math.ceil(v * demandScale));
        const day = computeShiftMix(date, required, maxStaffPerDay);
        mixByDate.set(date, day.mix);
        demandDays.push(day);
      }
      roster = assignRoster(dates, mixByDate, pool, ytdDist, lastShifts, consecDays, {
        minRestHours: options.minRestHours,
        offDaysPerWeek: options.offDaysPerWeek,
        allowFemaleN: options.allowFemaleN,
        femaleLateFunctionIds: options.femaleLateFunctionIds,
        onLeave,
        offStrategy: options.offStrategy,
        rotationFairness: options.rotationFairness,
      });
    }

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
      // (pre-07:00 gaps are coverable only by prior-day MD tails — known limitation).
      // GRADED (2026-07-08): a lone −1 body for a half-hour edge is a WARNING for the
      // day-of team (remedies/OT), not a critical day — critical = a deep hole (deficit
      // ≥2 anywhere) or a wide one (>6 daytime half-hour slots short).
      const daytimeGaps = d.residualGaps.filter((g: any) => +g.interval.slice(0, 2) >= 7);
      const deepGap = daytimeGaps.some((g: any) => g.deficit >= 2);
      const riskStatus = (deepGap || daytimeGaps.length > 6) ? 'critical'
        : daytimeGaps.length > 0 || staffedPeak < requiredPeak * 0.95 ? 'warning' : 'safe';
      return {
        date: d.date, mix: d.mix,
        requiredPeak, staffedPeak,
        availablePool: pool.length - onLeaveCount,
        onApprovedLeave: onLeaveCount,
        riskStatus,
        requiredCurve: d.requiredCurve, staffedCurve: d.staffedCurve,
        residualGaps: d.residualGaps,
        // per-function coverage detail (per-function allocation mode)
        perFunction: perFunctionByDate.get(d.date) ?? null,
      };
    });

    // ── VERDICT (Stage 2A) — the UI-ready analysis block that makes the result
    //    sell itself: coverage per day/function, fairness (REUSING the classic
    //    engine's calcFairness on the pre-swap YTD already loaded above), and
    //    rule-compliance counters RECOUNTED from the final grid (self-verifying).
    const fairness = fairnessFromDistributions(
      pool.map(e => ({ id: e.id, name: e.name, gender: e.gender })),
      ytdDist,
    );
    const verdict = buildGenerateVerdict({
      dates,
      grid,
      days,
      unfilled: roster.unfilled,
      warnings: roster.warnings,
      offDaysPerWeek: options.offDaysPerWeek,
      minRestHours: options.minRestHours,
      fairness,
    });

    return {
      weekStart, weekEnd: dates[6], mode: 'demand-driven',
      verdict,
      currentContext: {
        activeEmployees: pool.length,
        liveOnlineNow: liveAgents.filter((a: any) =>
          ['available', 'idle', 'busy'].includes(a.status)).length,
        onActivePermissionNow: +(permRow?.cnt ?? 0),
        liveCapturedAt: liveSnap?.captured_at ?? null,
      },
      demand: {
        basis: forecastByDate
          ? `STAFFING ENGINE (per-function allocation) — ${forecastBasis}`
          : byWeekday.size >= 5
            ? `P90 per weekday over ${allCurves.length} measured days (live-plan fallback — staffing engine had no volume data)`
            : `sparse history (${allCurves.length} measured day(s)) — same curve applied to all weekdays; accuracy improves as data accumulates`,
        source: forecastByDate ? 'forecast-erlang' : 'live-plan-history',
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
        // Behavioral-merge options actually applied to this run (Director 2026-07-08)
        offStrategy: options.offStrategy ?? 'lowest-demand',
        rotationFairness: !!options.rotationFairness,
      },
    };
  }

  /**
   * HOURLY HEALTH per function (Director 2026-07-03: "أشوف الجينيريت عمل هيدكاونت مناسب
   * لكل فنكشن ولا لا"): planned HC per hour (avg/day) computed from the PROPOSAL itself,
   * vs the observed baseline = avg scheduled HC per hour per function over the 28 days
   * before weekStart (roster_days). Hours where planned < 85% of a real baseline are
   * flagged; a function with flagged hours gets verdict 'review'. Honest: baseline is
   * the OBSERVED pattern, not an Erlang demand — stated in `basis`.
   */
  private async hourlyHealthFromPlan(
    tenantId: string, weekStart: string, nDays: number,
    planned: Map<string, number[]>,   // fn name → per-hour covered (person·day) counts
  ) {
    const base = await this.ds.query(`
      WITH h AS (SELECT generate_series(0,23) hh),
      r AS (SELECT canon_fn(COALESCE(role_function,function_name)) fn, shift_start_min ss, shift_end_min se
              FROM roster_days
             WHERE tenant_id=$1 AND is_active AND shift_start_min IS NOT NULL
               AND work_date >= ($2::date - interval '28 days') AND work_date < $2::date),
      d AS (SELECT COUNT(DISTINCT work_date)::int n FROM roster_days
             WHERE tenant_id=$1 AND is_active AND shift_start_min IS NOT NULL
               AND work_date >= ($2::date - interval '28 days') AND work_date < $2::date)
      SELECT r.fn, h.hh AS "hour",
        (COUNT(*) FILTER (WHERE ((r.ss%1440+1440)%1440) < h.hh*60+60 AND LEAST(((r.ss%1440+1440)%1440)+(CASE WHEN r.se<=r.ss THEN r.se+1440-r.ss ELSE r.se-r.ss END),1440) > h.hh*60
                             OR ((((r.ss%1440+1440)%1440)+(CASE WHEN r.se<=r.ss THEN r.se+1440-r.ss ELSE r.se-r.ss END))>1440
                                 AND ((((r.ss%1440+1440)%1440)+(CASE WHEN r.se<=r.ss THEN r.se+1440-r.ss ELSE r.se-r.ss END))-1440) > h.hh*60)))::float
          / NULLIF((SELECT n FROM d),0) AS baseline
      FROM r CROSS JOIN h GROUP BY r.fn, h.hh`, [tenantId, weekStart]).catch(() => []);
    const baseMap: Record<string, number[]> = {};
    for (const b of base) {
      if (!baseMap[b.fn]) baseMap[b.fn] = Array(24).fill(0);
      baseMap[b.fn][b.hour] = +(+b.baseline || 0).toFixed(1);
    }
    const functions = [...planned.entries()].map(([fn, counts]) => {
      const hours = counts.map((c, h) => {
        const plan = +(c / nDays).toFixed(1);
        const baseline = baseMap[fn]?.[h] ?? 0;
        const ratio = baseline > 0 ? +(plan / baseline).toFixed(2) : null;
        return { hour: h, planned: plan, baseline, ratio, short: baseline >= 1 && plan < baseline * 0.85 };
      });
      const shortHours = hours.filter(x => x.short).map(x => x.hour);
      return { fn, hours, shortHours, verdict: shortHours.length ? 'review' : 'ok' };
    }).sort((a, b) => b.hours.reduce((s, x) => s + x.planned, 0) - a.hours.reduce((s, x) => s + x.planned, 0));
    return {
      basis: 'baseline = observed avg scheduled HC per hour over the 28 days before the week (not an Erlang demand)',
      functions,
      verdict: functions.some(f => f.verdict === 'review') ? 'review' : 'ok',
    };
  }

  /** Spread one shift window into per-hour buckets of a fn's counter. */
  private spreadWindow(counts: number[], startHHMM: string | null, endHHMM: string | null) {
    if (!startHHMM || !endHHMM) return;
    const toMin = (t: string) => parseInt(t.split(':')[0], 10) * 60 + parseInt(t.split(':')[1] ?? '0', 10);
    const s = ((toMin(startHHMM) % 1440) + 1440) % 1440;
    let e = toMin(endHHMM); if (e <= s) e += 1440;
    for (let h = 0; h < 24; h++) {
      const covers = (s < h * 60 + 60 && Math.min(e, 1440) > h * 60) || (e > 1440 && e - 1440 > h * 60);
      if (covers) counts[h]++;
    }
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
      // Interns fold into their parent team (Director rule): generating for a parent function
      // pulls in every function whose canonical name matches (e.g. "Internship CH - WA" → "CH - WA"),
      // so the whole team is scheduled together instead of the parent's own employees only.
      whereExtra = ` AND canon_fn(f.name) = ANY(ARRAY(SELECT canon_fn(name) FROM functions WHERE id = ANY($2::uuid[])))`;
      params.push(functionIds);
    }

    const rows = await this.ds.query(
      `SELECT e.id, e.employee_no, e.first_name_en, e.last_name_en,
              e.gender, e.employment_type, f.id AS fn_id, f.name AS fn_name, canon_fn(f.name) AS fn_canon
       FROM employees e
       LEFT JOIN functions f ON e.function_id = f.id
       WHERE e.tenant_id = $1 AND e.status = 'active'${whereExtra}
       ORDER BY f.name, e.first_name_en`,
      params,
    );

    // Group by CANONICAL function so interns merge into their parent team's schedulable pool
    // (id here is an in-memory grouping/merge key only — schedule_entries key on employee_id).
    const fnMap = new Map<string, { id: string; name: string; employees: EmployeeInfo[] }>();
    for (const r of rows) {
      const fnKey = r.fn_canon ?? r.fn_id ?? 'no-function';
      if (!fnMap.has(fnKey)) {
        fnMap.set(fnKey, { id: fnKey, name: r.fn_canon ?? r.fn_name ?? 'بدون قسم', employees: [] });
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

  /* Weekend = Thursday + Friday + Saturday (Director's ruling 2026-08-05).
     This used to be a private copy of the rule, which is how the platform ended up running
     two different weekends at once. It now delegates to wfm-calc, so the generator cannot
     drift from analytics again. */
  private isWeekend(dateStr: string): boolean {
    return isWeekendDow(new Date(dateStr + 'T00:00:00').getDay());
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

  // ── Load the shift on the day IMMEDIATELY BEFORE the week ───────────────────
  // Both engines use this value for two things: the rest check on day 1, and the
  // rotation band to move on from. Both are statements about the ADJACENT day —
  // so the row must BE the adjacent day. Without the floor, a week generated
  // beyond the data horizon anchored on whatever row happened to be last: for
  // 2026-08-15 that was 2026-08-01 for 104 people and 2026-07-17 for 54, read as
  // if it were yesterday. It produced a rest violation nobody could have caused.
  // Sibling loadConsecutiveDays already bounds itself to 7 days; this is the
  // same discipline, at the tighter window rest actually needs.
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
         AND ar.attendance_date <  $3::date
         AND ar.attendance_date >= $3::date - interval '1 day'
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

    // Per-function per-hour planned HC + baseline verdict, attached to every result
    // (Director 2026-07-03 — the generate must SHOW whether HC per function is adequate).
    const attachHourlyHealth = async (result: GeneratorResult) => {
      const planned = new Map<string, number[]>();
      for (const fn of result.functions) {
        const counts = planned.get(fn.name) ?? planned.set(fn.name, Array(24).fill(0)).get(fn.name)!;
        for (const emp of fn.employees) {
          for (const a of emp.assignments) {
            if (a.shift?.code && a.shift.code !== 'OFF' && a.shift.start && a.shift.end) {
              this.spreadWindow(counts, a.shift.start, a.shift.end);
            }
          }
        }
      }
      (result as any).hourlyHealth = await this.hourlyHealthFromPlan(tenantId, weekStart, result.dates.length, planned);
      return result;
    };

    // ── Single week (default path) ────────────────────────────────────────────
    if (weeksCount === 1) {
      return attachHourlyHealth(generateWeeklySchedule(employeesByFunction, ytdDist, lastShifts, weekStart, options, consecDays, onLeave));
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

    return attachHourlyHealth(combined!);
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

  /**
   * Save a DEMAND-DRIVEN result as a draft schedule_version (behavioral merge
   * D-077 — completes generate-demand → save → publish end-to-end). Same
   * lifecycle as the classic saveDraft: the existing versions/:id/publish path
   * applies it to agents unchanged. fairness_score stays NULL (the demand
   * result reports coverage risk, not a fairness index — never fake a number).
   */
  async saveDemandDraft(
    tenantId: string,
    demand: Awaited<ReturnType<GeneratorService['generateDemandDriven']>>,
    generatedByUserId: string,
    label?: string,
  ): Promise<string> {
    const existing = await this.ds.query(
      `SELECT version_number FROM schedule_versions
       WHERE tenant_id = $1 AND period_start = $2 AND status = 'draft'
       ORDER BY version_number DESC LIMIT 1`,
      [tenantId, demand.weekStart],
    );
    const versionNumber = existing.length > 0 ? existing[0].version_number + 1 : 1;

    const [version] = await this.ds.query(
      `INSERT INTO schedule_versions
         (id, tenant_id, period_type, period_start, period_end, status,
          version_number, label, notes, generated_at, generated_by,
          coverage_gaps, fairness_score, total_employees, total_working_entries, created_by)
       VALUES
         (gen_random_uuid(), $1, 'weekly', $2, $3, 'draft',
          $4, $5, $6, NOW(), $7,
          $8, NULL, $9, $10, $7)
       RETURNING id`,
      [
        tenantId, demand.weekStart, demand.weekEnd, versionNumber,
        label ?? `Demand draft v${versionNumber} — Week of ${demand.weekStart}`,
        `Demand-driven: ${demand.summary.unfilledSlots} unfilled, ${demand.summary.residualGapIntervals} residual gap intervals, ` +
          `${demand.summary.criticalDays} critical day(s) [offStrategy=${(demand.summary as any).offStrategy}, rotationFairness=${(demand.summary as any).rotationFairness}]`,
        generatedByUserId,
        JSON.stringify(demand.unfilled ?? []),
        demand.summary.employees,
        demand.summary.totalShiftsPlanned,
      ],
    );
    const versionId: string = version.id;

    // Grid rows → schedule_entries (same shape/marker mapping as the classic path)
    const entries: any[] = [];
    for (const row of demand.grid) {
      for (const [entryDate, code] of Object.entries(row.days ?? {})) {
        entries.push({
          versionId, tenantId,
          employeeId: row.employeeId,
          entryDate,
          shiftCodeDisplay: code,
          attendanceMarker: code === 'OFF' ? 'off' : 'present',
          validationFlags: null,
        });
      }
    }
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
        params.push(e.versionId, e.tenantId, e.employeeId, e.entryDate,
          e.shiftCodeDisplay, e.attendanceMarker, e.validationFlags);
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
    if (!version) throw new NotFoundException('Schedule version not found.');

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
    // The `force` branch below archives the old version and replaces it. It is
    // deliberately NOT reachable from the API — no route passes force — because
    // force-replacing a published week rewrites what agents have already been told
    // to work; exposing it is the Director's decision (BR-APP-006), not a default.
    // So the refusal must not advertise a switch no endpoint accepts.
    if (conflicts.length && !force) {
      throw new BadRequestException(
        `A published/locked schedule already covers ${version.period_start} → ${version.period_end}: ` +
        conflicts.map((c: any) => `"${c.label ?? c.id}" (${c.status})`).join('; ') +
        `. Edit the published version instead — post-publish edits are versioned and audited.`,
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

    // Dual-write (O-11 / D-051 follow-up): mirror the published SCHEDULED fields into the
    // canonical roster_days rows so roster reports never diverge from the agent-facing
    // schedule. UPDATE-only — roster_days rows are created by the recon engine, and days
    // that already carry actual evidence (punch or system login) are left untouched
    // (same guard as the attendance_records skip above). shift_end_min is stored in the
    // recon engine's CANONICAL form (start+duration, MD → 1860) — a raw wall-clock end
    // (420) with crosses_midnight=true is internally contradictory and breaks any consumer
    // that derives duration from se-ss (audit 2026-07-03 finding #3).
    const rosterEntries: Array<{ employee_no: string; d: string; code: string; start_min: number | null; end_min: number | null }> =
      await this.ds.query(
        `SELECT e.employee_no, se.entry_date::text AS d, se.shift_code_display AS code,
                (EXTRACT(HOUR FROM sc.start_time)*60 + EXTRACT(MINUTE FROM sc.start_time))::int AS start_min,
                (EXTRACT(HOUR FROM sc.end_time)*60 + EXTRACT(MINUTE FROM sc.end_time))::int   AS end_min
           FROM schedule_entries se
           JOIN employees e ON e.id = se.employee_id
           LEFT JOIN shift_codes sc ON sc.tenant_id = se.tenant_id AND sc.code = se.shift_code_display
          WHERE se.schedule_version_id = $1 AND se.tenant_id = $2`,
        [versionId, tenantId],
      );
    let rosterSynced = 0;
    if (rosterEntries.length) {
      const vals: any[] = [tenantId];
      const tuples: string[] = [];
      for (const en of rosterEntries) {
        if (!en.code) continue;
        const norm = normalizeShiftCode(en.code);
        const presence = norm.status === 'working' ? 'office'
          : norm.status === 'wfh' ? 'wfh'
          : norm.status === 'absence' ? 'absent'
          : norm.status === 'separation' ? 'left'
          : norm.status === 'unknown' ? null : norm.status;
        // canonical end: if the raw wall-clock end is <= start, the shift crosses midnight → +1440.
        const endCanon = (en.end_min != null && en.start_min != null && en.end_min <= en.start_min) ? en.end_min + 1440 : en.end_min;
        const xmid = endCanon != null && endCanon > 1440;
        const base = vals.length;
        vals.push(en.employee_no, en.d, en.code, en.start_min, endCanon,
                  presence, norm.hrCode, norm.base ?? en.code, xmid);
        tuples.push(`($${base + 1}, $${base + 2}::date, $${base + 3}, $${base + 4}::int, $${base + 5}::int, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}::boolean)`);
      }
      if (tuples.length) {
        const res = await this.ds.query(
          `UPDATE roster_days rd
              SET shift_code = v.code, shift_start_min = v.start_min, shift_end_min = v.end_min,
                  presence = COALESCE(v.presence, rd.presence), hr_code = v.hr_code,
                  attendance_code = v.code, shift_category = v.base, crosses_midnight = v.xmid
             FROM (VALUES ${tuples.join(',')}) AS v(person_no, work_date, code, start_min, end_min, presence, hr_code, base, xmid)
            WHERE rd.tenant_id = $1 AND rd.person_no = v.person_no AND rd.work_date = v.work_date
              AND rd.is_active
              AND rd.punch_in_min IS NULL AND rd.sys_login_min IS NULL`,
          vals,
        );
        // UPDATE via ds.query returns [rows, affectedCount] for raw UPDATE ... (tuple form)
        rosterSynced = Array.isArray(res) && typeof res[1] === 'number' ? res[1] : 0;
      }
    }

    // Audit the forced replacement — one row per archived version.
    if (conflicts.length && force) {
      for (const c of conflicts) {
        await this.ds.query(
          `INSERT INTO audit_logs (tenant_id, actor_id, action, module, entity_type, entity_id, notes)
           VALUES ($1,$2,'schedule.published','schedule-generator','schedule_version',$3,$4)`,
          [tenantId, userId, c.id,
           `Force-published version ${versionId} over ${version.period_start} → ${version.period_end}; ` +
           `archived ${c.status} version ${c.id} ("${c.label ?? ''}"); ` +
           `applied ${applied?.n ?? 0} row(s) to attendance_records, skipped ${applied?.skipped ?? 0} with actual punch/system data; synced ${rosterSynced} roster_days row(s)`],
        ).catch(() => {});
      }
    }

    return {
      success: true,
      versionId,
      appliedToAgents: applied?.n ?? 0,
      skippedWithActuals: applied?.skipped ?? 0,
      rosterDaysSynced: rosterSynced,
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
    // Interns fold into their parent team (canon_fn strips a leading "Internship "):
    // per-function counts are computed first, then summed under canon_fn so a parent
    // shows its combined headcount and interns no longer appear as separate options.
    return this.ds.query(
      // representative id = the parent row's id (the one whose own name is already canonical);
      // Postgres has no min(uuid), so pick via array_agg ordered parent-first.
      `SELECT (array_agg(pf.id ORDER BY (canon_fn(pf.name) = pf.name) DESC, pf.name))[1] AS id,
              canon_fn(pf.name) AS name, SUM(pf.employee_count) AS employee_count
       FROM (
         SELECT f.id, f.name, COUNT(DISTINCT e.id) AS employee_count
         FROM functions f
         LEFT JOIN employees e ON e.function_id = f.id AND e.tenant_id = $1 AND e.status = 'active'
         WHERE f.tenant_id = $1
         GROUP BY f.id, f.name
       ) pf
       GROUP BY canon_fn(pf.name)
       HAVING SUM(pf.employee_count) > 0
       ORDER BY SUM(pf.employee_count) DESC`,
      [tenantId],
    );
  }
}
