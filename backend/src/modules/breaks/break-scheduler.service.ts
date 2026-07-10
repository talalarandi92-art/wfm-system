import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CoverageRebuildService } from '../coverage/coverage-rebuild.service';
import { BreakPolicyService } from './break-policy.service';
import {
  BreakPolicyV2Row,
  functionSimultaneousCap,
  generationWindow,
  pickMostSpecificPolicy,
  plannedDateFor,
  sessionPattern,
  slotPositionBucket,
  wallClockHHMM,
} from './break-policy.logic';

export interface BreakTypeRow {
  id: string;
  name: string;
  duration_minutes: number;
  is_prayer: boolean;
  is_active?: boolean;
}

export interface PrayerTimesRow {
  dhuhr: string | null;
  asr: string | null;
  maghrib: string | null;
}

export interface GeneratedSlot {
  employee_id: string;
  schedule_date: string;   // roster day
  planned_date: string;    // calendar day planned_start belongs to (cross-midnight fix)
  break_type_id: string;
  slot_number: number;
  planned_start: string;   // HH:MM wall-clock
  planned_end: string;
  earliest_start: string;  // HH:MM — planned −30min bounded by protected window
  latest_start: string;    // HH:MM — planned +30min bounded by protected window
  generated_reason: string;
  priority_score: number;
  generated_by: 'auto';
  tenant_id: string;
}

export interface EmployeeFairnessDelta {
  delta: number;
  early: number;
  mid: number;
  late: number;
}

export interface ScheduleResult {
  slots: GeneratedSlot[];
  warnings: string[];
  fairnessMap: Map<string, EmployeeFairnessDelta>;
  coverageSource: 'headcount_intervals' | 'fallback';
}

type CoverageCell = { required: number; scheduled: number; onBreak: number };

const BUCKET_MS = 15 * 60000;
const DEFAULT_COVERAGE_RATIO = 0.7; // fallback floor when no policy threshold

/**
 * Optimizer v2 (B2) — policy-driven greedy staggering with fairness, real
 * coverage floor and anti-clustering. Evolution of the v1 greedy scheduler:
 *  - session count/durations come from break_policies_v2 (most-specific wins),
 *    NOT from the break_types hardcode;
 *  - protected first/last windows + min_work_before_first + min_gap enforced;
 *  - coverage floor = required_hc from headcount_intervals (rebuilt in-process
 *    from roster_days when the date has no rows); the old required=scheduled
 *    live fallback survives ONLY when the rebuild yields nothing, and such
 *    slots are marked generated_reason='fallback-coverage';
 *  - anti-clustering: per-interval simultaneous-break caps per FUNCTION
 *    (thresholds.max_simultaneous or computed) and per TEAM MANAGER
 *    (thresholds.max_simultaneous_per_team, default 1);
 *  - cross-midnight correct: slots carry planned_date; coverage keys are
 *    absolute 15-min epoch buckets (no wall-clock collisions).
 */
@Injectable()
export class BreakSchedulerService {
  private readonly logger = new Logger(BreakSchedulerService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly policyService: BreakPolicyService,
    private readonly coverageRebuild: CoverageRebuildService,
  ) {}

  private bucketKey(t: Date, fnId: string): string {
    return `${Math.floor(t.getTime() / BUCKET_MS)}|${fnId}`;
  }

  /** Every aligned 15-min bucket a [start,end) span touches — a break starting
   *  off-grid (e.g. 14:06–14:21) occupies BOTH the 14:00 and 14:15 buckets. */
  private bucketsOf(start: Date, end: Date): Date[] {
    const out: Date[] = [];
    for (let tm = Math.floor(start.getTime() / BUCKET_MS) * BUCKET_MS; tm < end.getTime(); tm += BUCKET_MS) {
      out.push(new Date(tm));
    }
    return out;
  }

  async generateForDate(
    tenantId: string,
    scheduleDate: string,
    functionId?: string,
  ): Promise<ScheduleResult> {
    const warnings: string[] = [];

    // ── 1. Employees on shift (canonical function fold + team manager + employment type) ──
    const shiftRows: Array<{
      employee_id: string; employee_no: string; employee_name: string; gender: string;
      function_id: string; function_name: string; employment_type: string | null;
      shift_code: string | null; team_manager: string | null;
      shift_start: string; shift_end: string; fairness_score: number;
    }> = await this.dataSource.query(
      `
      WITH fns AS (
        SELECT canon_fn(name) AS cname,
               (array_agg(id ORDER BY (canon_fn(name) = name) DESC, name))[1] AS fid
        FROM functions WHERE tenant_id = $1 GROUP BY canon_fn(name)
      )
      SELECT
        ar.employee_id,
        e.employee_no,
        (e.first_name_en || ' ' || COALESCE(e.last_name_en,'')) AS employee_name,
        e.gender,
        COALESCE(cf.fid, e.function_id) AS function_id,
        canon_fn(COALESCE(f.name,'—'))  AS function_name,
        e.employment_type::text         AS employment_type,
        ss.code                         AS shift_code,
        rd.team_manager                 AS team_manager,
        (ar.attendance_date::text || ' ' || ar.scheduled_start::text || '+03')::timestamptz AS shift_start,
        CASE WHEN ar.scheduled_end <= ar.scheduled_start THEN
          ((ar.attendance_date + 1)::text || ' ' || ar.scheduled_end::text || '+03')::timestamptz
        ELSE
          (ar.attendance_date::text  || ' ' || ar.scheduled_end::text || '+03')::timestamptz
        END AS shift_end,
        COALESCE(bf.fairness_score, 0) AS fairness_score
      FROM attendance_records ar
      JOIN employees e ON e.id = ar.employee_id
      LEFT JOIN functions f ON f.id = e.function_id
      LEFT JOIN fns cf ON cf.cname = canon_fn(f.name)
      LEFT JOIN shift_codes ss ON ss.id = ar.scheduled_shift_code_id
      LEFT JOIN LATERAL (
        SELECT r.team_manager FROM roster_days r
        WHERE r.tenant_id = ar.tenant_id AND r.person_no = e.employee_no
          AND r.work_date = ar.attendance_date AND r.is_active
        LIMIT 1
      ) rd ON TRUE
      LEFT JOIN break_fairness bf ON bf.employee_id = ar.employee_id
        AND bf.tenant_id = ar.tenant_id
        AND bf.period_year  = EXTRACT(YEAR  FROM $2::date)
        AND bf.period_month = EXTRACT(MONTH FROM $2::date)
      WHERE ar.tenant_id = $1
        AND ar.attendance_date = $2::date
        AND ar.scheduled_start IS NOT NULL AND ar.scheduled_end IS NOT NULL
        AND COALESCE(ss.is_working_shift, TRUE) = TRUE
        AND COALESCE(ss.is_leave_code, FALSE)  = FALSE
        ${functionId ? 'AND (e.function_id = $3 OR cf.fid = $3)' : ''}
      ORDER BY fairness_score ASC, ar.employee_id
      `,
      functionId ? [tenantId, scheduleDate, functionId] : [tenantId, scheduleDate],
    );

    if (shiftRows.length === 0) {
      return { slots: [], warnings: ['No working employees found for this date.'], fairnessMap: new Map(), coverageSource: 'fallback' };
    }

    // ── 2. Policy matrix (v2) — resolved per employee, most-specific wins ────
    const policies = await this.policyService.loadActivePolicies(tenantId);
    if (policies.length === 0) {
      warnings.push('No active break_policies_v2 rows — nothing generated (seed the default policy).');
      return { slots: [], warnings, fairnessMap: new Map(), coverageSource: 'fallback' };
    }
    const defaultPolicy = pickMostSpecificPolicy(policies, null, null, null) ?? policies[0];
    const coverageRatio = Number((defaultPolicy.thresholds as any)?.coverage_ratio) || DEFAULT_COVERAGE_RATIO;

    // ── 3. Break types (duration → type mapping; policy drives durations) ────
    const breakTypes: BreakTypeRow[] = await this.dataSource.query(
      `SELECT id, name, duration_minutes, is_prayer FROM break_types
       WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order`,
      [tenantId],
    );
    if (breakTypes.length === 0) {
      return { slots: [], warnings: ['No active break types configured.'], fairnessMap: new Map(), coverageSource: 'fallback' };
    }
    const typeForDuration = (dur: number): BreakTypeRow =>
      [...breakTypes].filter(bt => !bt.is_prayer)
        .sort((a, b) => Math.abs(a.duration_minutes - dur) - Math.abs(b.duration_minutes - dur))[0]
      ?? breakTypes[0];

    // ── 4. Prayer times (soft alignment: snap a session to a prayer if close) ─
    const prayerRow: PrayerTimesRow[] = await this.dataSource.query(
      `SELECT dhuhr, asr, maghrib FROM prayer_times
       WHERE tenant_id = $1 AND prayer_date = $2::date LIMIT 1`,
      [tenantId, scheduleDate],
    );
    const prayerMinutes: number[] = prayerRow[0]
      ? ([prayerRow[0].dhuhr, prayerRow[0].asr, prayerRow[0].maghrib].filter(Boolean) as string[])
          .map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); })
      : [];

    // ── 5. Coverage floor from headcount_intervals (rebuild in-process if empty) ─
    let coverageSource: 'headcount_intervals' | 'fallback' = 'headcount_intervals';
    let intervalRows = await this.loadIntervals(tenantId, scheduleDate);
    if (intervalRows.length === 0) {
      this.logger.log(`headcount_intervals empty for ${scheduleDate} — invoking coverage rebuild in-process`);
      try {
        await this.coverageRebuild.rebuild(tenantId, scheduleDate, scheduleDate);
        intervalRows = await this.loadIntervals(tenantId, scheduleDate);
      } catch (e: any) {
        this.logger.warn(`coverage rebuild failed: ${e.message}`);
      }
    }

    const coverageMap = new Map<string, CoverageCell>();
    for (const row of intervalRows) {
      const key = this.bucketKey(new Date(row.interval_start), row.function_id);
      coverageMap.set(key, { required: +row.required_hc, scheduled: +row.scheduled_hc, onBreak: 0 });
    }

    if (coverageMap.size === 0) {
      // FALLBACK (kept from v1): build live from scheduled agents; required = scheduled,
      // so the coverage-ratio rule caps simultaneous breaks. Slots get marked
      // generated_reason='fallback-coverage'.
      coverageSource = 'fallback';
      this.logger.warn(
        `headcount_intervals still EMPTY for ${scheduleDate} after rebuild — falling back to LIVE scheduled-HC (required = scheduled).`,
      );
      for (const emp of shiftRows) {
        for (const t of this.bucketsOf(new Date(emp.shift_start), new Date(emp.shift_end))) {
          const key = this.bucketKey(t, emp.function_id);
          const cell = coverageMap.get(key);
          if (cell) { cell.scheduled += 1; cell.required += 1; }
          else coverageMap.set(key, { required: 1, scheduled: 1, onBreak: 0 });
        }
      }
    }

    // ── 6. Pre-occupy coverage with KEPT slots (active/completed/manual — regen never touches them) ─
    const keptSlots: Array<{
      employee_id: string; planned_start: string; planned_end: string;
      planned_date: string; slot_number: number; function_id: string;
    }> = await this.dataSource.query(
      `WITH fns AS (
         SELECT canon_fn(name) AS cname,
                (array_agg(id ORDER BY (canon_fn(name) = name) DESC, name))[1] AS fid
         FROM functions WHERE tenant_id = $1 GROUP BY canon_fn(name)
       )
       SELECT bs.employee_id, bs.planned_start::text, bs.planned_end::text,
              COALESCE(bs.planned_date, bs.schedule_date)::text AS planned_date,
              bs.slot_number,
              COALESCE(cf.fid, e.function_id) AS function_id
       FROM break_slots bs
       JOIN employees e ON e.id = bs.employee_id
       LEFT JOIN functions f ON f.id = e.function_id
       LEFT JOIN fns cf ON cf.cname = canon_fn(f.name)
       WHERE bs.tenant_id = $1 AND bs.schedule_date = $2::date
         AND NOT (bs.status = 'scheduled' AND bs.generated_by = 'auto')
         AND bs.status NOT IN ('cancelled','missed')`,
      [tenantId, scheduleDate],
    );

    const teamOnBreak = new Map<string, number>(); // bucketEpoch|team_manager → count
    const teamKey = (t: Date, team: string) => `${Math.floor(t.getTime() / BUCKET_MS)}|${team}`;
    const teamOf = new Map(shiftRows.map(r => [r.employee_id, r.team_manager]));

    const keptByEmployee = new Map<string, Array<{ startMs: number; endMs: number; maxSlot: number }>>();
    for (const ks of keptSlots) {
      const st = new Date(`${ks.planned_date}T${String(ks.planned_start).slice(0, 5)}:00+03:00`);
      let en = new Date(`${ks.planned_date}T${String(ks.planned_end).slice(0, 5)}:00+03:00`);
      if (en <= st) en = new Date(en.getTime() + 86400000);
      for (const t of this.bucketsOf(st, en)) {
        const cell = coverageMap.get(this.bucketKey(t, ks.function_id));
        if (cell) cell.onBreak += 1;
        const team = teamOf.get(ks.employee_id);
        if (team) teamOnBreak.set(teamKey(t, team), (teamOnBreak.get(teamKey(t, team)) ?? 0) + 1);
      }
      const list = keptByEmployee.get(ks.employee_id) ?? [];
      list.push({ startMs: st.getTime(), endMs: en.getTime(), maxSlot: ks.slot_number });
      keptByEmployee.set(ks.employee_id, list);
    }

    // ── 7. Placement feasibility: coverage ratio + anti-clustering caps ──────
    const teamCap = Math.max(1, Number((defaultPolicy.thresholds as any)?.max_simultaneous_per_team) || 1);

    const canPlace = (start: Date, end: Date, fnId: string, team: string | null, thresholds: Record<string, unknown>): boolean => {
      for (const t of this.bucketsOf(start, end)) {
        const cell = coverageMap.get(this.bucketKey(t, fnId));
        if (cell) {
          // real floor: available after this break must keep >= ratio × required
          const available = cell.scheduled - (cell.onBreak + 1);
          if (cell.required > 0 && available / cell.required < coverageRatio) return false;
          // anti-clustering per function
          const cap = functionSimultaneousCap(cell.scheduled, cell.required, thresholds, coverageRatio);
          if (cell.onBreak + 1 > cap) return false;
        }
        // anti-clustering per team manager (max 1 simultaneous by default)
        if (team && (teamOnBreak.get(teamKey(t, team)) ?? 0) + 1 > teamCap) return false;
      }
      return true;
    };

    const markPlace = (start: Date, end: Date, fnId: string, team: string | null): void => {
      for (const t of this.bucketsOf(start, end)) {
        const cell = coverageMap.get(this.bucketKey(t, fnId));
        if (cell) cell.onBreak += 1;
        if (team) teamOnBreak.set(teamKey(t, team), (teamOnBreak.get(teamKey(t, team)) ?? 0) + 1);
      }
    };

    // ── 8. Generate — fairness-ordered employees, policy-driven sessions ─────
    const slots: GeneratedSlot[] = [];
    const fairnessMap = new Map<string, EmployeeFairnessDelta>();

    for (const emp of shiftRows) {
      const shiftStart = new Date(emp.shift_start);
      const shiftEnd = new Date(emp.shift_end);
      const shiftDurationMin = Math.round((shiftEnd.getTime() - shiftStart.getTime()) / 60000);
      const shiftStartMinOfDay = shiftStart.getHours() * 60 + shiftStart.getMinutes();

      const policy = pickMostSpecificPolicy(policies, emp.function_name, emp.shift_code, emp.employment_type) ?? defaultPolicy;
      const sessions = sessionPattern(policy);
      if (!sessions.length) continue;

      const fair: EmployeeFairnessDelta = { delta: 0, early: 0, mid: 0, late: 0 };
      const kept = keptByEmployee.get(emp.employee_id) ?? [];
      let slotNumber = kept.reduce((m, k) => Math.max(m, k.maxSlot), 0);
      // min-gap seeding: last kept break end (offset minutes from shift start), else "far past"
      let lastBreakEndMin = kept.length
        ? Math.max(...kept.map(k => Math.round((k.endMs - shiftStart.getTime()) / 60000)))
        : -100000;

      const minGap = policy.min_gap_between_breaks_min;
      const nSessions = sessions.length;

      for (let i = 0; i < nSessions; i++) {
        const dur = sessions[i];
        const window = generationWindow(shiftDurationMin, dur, policy);
        if (!window) {
          warnings.push(`${emp.employee_name}: shift too short (${shiftDurationMin}m) for break #${i + 1} outside protected hours.`);
          break;
        }
        const { earliestStartMin, latestStartMin } = window;

        // spread sessions across the shift midsection
        const span = latestStartMin - earliestStartMin;
        let candidate = Math.round(earliestStartMin + (span * (i + 0.5)) / nSessions);

        // soft prayer alignment: snap to a prayer time within ±45 min of the ideal spot
        for (const pm of prayerMinutes) {
          const offset = pm - shiftStartMinOfDay + (pm < shiftStartMinOfDay && shiftDurationMin + shiftStartMinOfDay > 1440 ? 1440 : 0);
          if (offset >= earliestStartMin && offset <= latestStartMin && Math.abs(offset - candidate) <= 45) {
            candidate = offset;
            break;
          }
        }

        if (candidate < lastBreakEndMin + minGap) candidate = lastBreakEndMin + minGap;
        if (candidate > latestStartMin) {
          warnings.push(`${emp.employee_name}: can't fit break #${i + 1} (${dur}m) — min-gap pushes past protected end window.`);
          continue;
        }

        // nearest coverage-safe placement (±30 min, 15-min steps)
        const safeMin = this.findNearestSafe(
          candidate, dur, shiftStart, earliestStartMin, latestStartMin,
          emp.function_id, emp.team_manager, policy.thresholds, canPlace, minGap, lastBreakEndMin,
        );
        if (safeMin == null) {
          warnings.push(`${emp.employee_name}: no coverage-safe slot for break #${i + 1} (${dur}m).`);
          continue;
        }

        const st = new Date(shiftStart.getTime() + safeMin * 60000);
        const en = new Date(st.getTime() + dur * 60000);
        markPlace(st, en, emp.function_id, emp.team_manager);

        const bt = typeForDuration(dur);
        const bucket = slotPositionBucket(safeMin, shiftDurationMin);
        fair[bucket] += 1;
        fair.delta += safeMin === candidate ? 1 : 0.5;

        const earliestBound = Math.max(earliestStartMin, safeMin - 30);
        const latestBound = Math.min(latestStartMin, safeMin + 30);
        slotNumber += 1;
        slots.push({
          employee_id: emp.employee_id,
          schedule_date: scheduleDate,
          planned_date: plannedDateFor(scheduleDate, shiftStartMinOfDay, safeMin),
          break_type_id: bt.id,
          slot_number: slotNumber,
          planned_start: wallClockHHMM(shiftStartMinOfDay, safeMin),
          planned_end: wallClockHHMM(shiftStartMinOfDay, safeMin + dur),
          earliest_start: wallClockHHMM(shiftStartMinOfDay, earliestBound),
          latest_start: wallClockHHMM(shiftStartMinOfDay, latestBound),
          generated_reason: coverageSource === 'fallback' ? 'fallback-coverage' : `policy:${policy.id}`,
          priority_score: Number(emp.fairness_score) || 0,
          generated_by: 'auto',
          tenant_id: tenantId,
        });
        lastBreakEndMin = safeMin + dur;
      }

      fairnessMap.set(emp.employee_id, fair);
    }

    return { slots, warnings, fairnessMap, coverageSource };
  }

  /** headcount_intervals for the date AND the next day (cross-midnight spill). */
  private async loadIntervals(tenantId: string, scheduleDate: string): Promise<Array<{
    interval_start: string; function_id: string; required_hc: number; scheduled_hc: number;
  }>> {
    return this.dataSource.query(
      `SELECT interval_start, function_id, required_hc, scheduled_hc
       FROM headcount_intervals
       WHERE tenant_id = $1 AND snapshot_date IN ($2::date, $2::date + 1)`,
      [tenantId, scheduleDate],
    );
  }

  /** ±30 min search in 15-min steps for a placement passing coverage + caps. */
  private findNearestSafe(
    preferredOffset: number,
    duration: number,
    shiftStart: Date,
    earliest: number,
    latest: number,
    fnId: string,
    team: string | null,
    thresholds: Record<string, unknown>,
    canPlace: (s: Date, e: Date, fn: string, team: string | null, th: Record<string, unknown>) => boolean,
    minGap = 0,
    lastBreakEnd = -100000,
  ): number | null {
    const searchRadius = 30;
    const step = 15;
    for (let delta = 0; delta <= searchRadius; delta += step) {
      for (const sign of [0, 1, -1]) {
        if (delta === 0 && sign !== 0) continue;
        const candidate = preferredOffset + sign * delta;
        if (candidate < earliest || candidate > latest) continue;
        if (candidate < lastBreakEnd + minGap) continue;
        const st = new Date(shiftStart.getTime() + candidate * 60000);
        const en = new Date(st.getTime() + duration * 60000);
        if (canPlace(st, en, fnId, team, thresholds)) return candidate;
      }
    }
    return null;
  }
}
