import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface ShiftWindow {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  gender: string;
  functionId: string;
  shiftStart: Date; // absolute datetime
  shiftEnd: Date;
  tenantId: string;
}

export interface BreakTypeRow {
  id: string;
  name: string;
  name_ar: string;
  duration_minutes: number;
  color: string;
  icon: string;
  is_mandatory: boolean;
  is_prayer: boolean;
  applies_gender: string;
  max_per_shift: number;
  sort_order: number;
}

export interface BreakPolicyRow {
  id: string;
  break_type_id: string;
  allowed_count: number;
  earliest_start_offset: number;
  latest_start_offset: number;
  min_gap_between_breaks: number;
  priority: number;
  function_id: string | null;
}

export interface PrayerTimesRow {
  dhuhr: string | null;
  asr: string | null;
  maghrib: string | null;
}

export interface CoverageInterval {
  intervalStart: string; // HH:MM
  intervalEnd: string;
  functionId: string;
  requiredHc: number;
  scheduledHc: number;
}

export interface GeneratedSlot {
  employee_id: string;
  schedule_date: string;
  break_type_id: string;
  slot_number: number;
  planned_start: string; // HH:MM
  planned_end: string;
  generated_by: 'auto';
  tenant_id: string;
}

export interface ScheduleResult {
  slots: GeneratedSlot[];
  warnings: string[];
  fairnessMap: Map<string, number>; // employeeId → slot quality score
}

@Injectable()
export class BreakSchedulerService {
  private readonly logger = new Logger(BreakSchedulerService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Core auto-scheduler: Greedy Staggering with fairness + coverage constraint.
   *
   * Algorithm:
   * 1. Load break types + policies + prayer times for the date.
   * 2. Sort employees by fairness score ascending (lowest score = most deprived → gets priority).
   * 3. For each employee, per policy (sorted by priority desc):
   *    a. Find all valid start-time candidates within the policy window.
   *    b. For each candidate, check coverage: scheduled_hc - currently_breaking >= min_required.
   *    c. Pick first valid candidate. If none, log warning.
   * 4. Mark the time slot as occupied (update in-memory coverage map).
   * 5. Return all generated slots + warnings.
   */
  async generateForDate(
    tenantId: string,
    scheduleDate: string,
    functionId?: string,
  ): Promise<ScheduleResult> {
    const warnings: string[] = [];

    // ── 1. Load employees on shift for this date ─────────────────────────────
    const shiftRows = await this.dataSource.query<
      Array<{
        employee_id: string;
        employee_no: string;
        employee_name: string;
        gender: string;
        function_id: string;
        shift_start: string;
        shift_end: string;
        fairness_score: number;
      }>
    >(
      `
      SELECT
        ar.employee_id,
        e.employee_no,
        (e.first_name_en || ' ' || COALESCE(e.last_name_en,'')) AS employee_name,
        e.gender,
        e.function_id,
        (ar.attendance_date::text || ' ' || ar.scheduled_start::text || '+03')::timestamptz AS shift_start,
        CASE WHEN ar.scheduled_end <= ar.scheduled_start THEN
          ((ar.attendance_date + 1)::text || ' ' || ar.scheduled_end::text || '+03')::timestamptz
        ELSE
          (ar.attendance_date::text  || ' ' || ar.scheduled_end::text || '+03')::timestamptz
        END AS shift_end,
        COALESCE(bf.fairness_score, 0) AS fairness_score
      FROM attendance_records ar
      JOIN employees e ON e.id = ar.employee_id
      LEFT JOIN shift_codes ss ON ss.id = ar.scheduled_shift_code_id
      LEFT JOIN break_fairness bf ON bf.employee_id = ar.employee_id
        AND bf.tenant_id = ar.tenant_id
        AND bf.period_year  = EXTRACT(YEAR  FROM $2::date)
        AND bf.period_month = EXTRACT(MONTH FROM $2::date)
      WHERE ar.tenant_id = $1
        AND ar.attendance_date = $2::date
        AND ar.scheduled_start IS NOT NULL AND ar.scheduled_end IS NOT NULL
        AND COALESCE(ss.is_working_shift, TRUE) = TRUE
        AND COALESCE(ss.is_leave_code, FALSE)  = FALSE
        ${functionId ? 'AND e.function_id = $3' : ''}
      ORDER BY fairness_score ASC, ar.employee_id
      `,
      functionId
        ? [tenantId, scheduleDate, functionId]
        : [tenantId, scheduleDate],
    );

    if (shiftRows.length === 0) {
      return { slots: [], warnings: ['No working employees found for this date.'], fairnessMap: new Map() };
    }

    // ── 2. Load break types + policies ───────────────────────────────────────
    const breakTypes = await this.dataSource.query<BreakTypeRow[]>(
      `SELECT * FROM break_types WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order`,
      [tenantId],
    );

    const policies = await this.dataSource.query<BreakPolicyRow[]>(
      `SELECT * FROM break_policies
       WHERE tenant_id = $1 AND is_active = TRUE
         ${functionId ? 'AND (function_id IS NULL OR function_id = $2)' : 'AND function_id IS NULL OR function_id IS NOT NULL'}
       ORDER BY priority DESC`,
      functionId ? [tenantId, functionId] : [tenantId],
    );

    // ── 3. Load prayer times for date ────────────────────────────────────────
    const prayerRow = await this.dataSource.query<PrayerTimesRow[]>(
      `SELECT dhuhr, asr, maghrib FROM prayer_times
       WHERE tenant_id = $1 AND prayer_date = $2::date LIMIT 1`,
      [tenantId, scheduleDate],
    );
    const prayers = prayerRow[0] ?? null;

    // ── 4. Load required HC by interval (from headcount_intervals or capacity snapshots) ──
    const coverageRows = await this.dataSource.query<
      Array<{ interval_start: string; interval_end: string; function_id: string; required_hc: number; scheduled_hc: number }>
    >(
      `SELECT
        interval_start::text, interval_end::text,
        function_id,
        required_hc,
        scheduled_hc
       FROM headcount_intervals
       WHERE tenant_id = $1 AND snapshot_date = $2::date
       ${functionId ? 'AND function_id = $3' : ''}
       ORDER BY interval_start`,
      functionId ? [tenantId, scheduleDate, functionId] : [tenantId, scheduleDate],
    );

    // In-memory coverage map: key = "HH:MM|functionId" → { required, scheduled, onBreak }
    type CoverageCell = { required: number; scheduled: number; onBreak: number };
    const coverageMap = new Map<string, CoverageCell>();
    for (const row of coverageRows) {
      const key = `${row.interval_start.slice(0, 5)}|${row.function_id}`;
      coverageMap.set(key, {
        required: row.required_hc,
        scheduled: row.scheduled_hc,
        onBreak: 0,
      });
    }

    // ── FALLBACK: headcount_intervals has never been populated on this system —
    // an empty map made checkCoverage() always pass (a no-op guard). When empty,
    // rebuild coverage LIVE from the scheduled working agents (attendance_records,
    // already loaded above): count per function per 15-min interval each shift covers
    // (cross-midnight handled — shift_end was moved to the next day in SQL).
    // required = scheduled, so the 70% rule caps simultaneous breaks at 30% of staff.
    if (coverageMap.size === 0) {
      this.logger.warn(
        `headcount_intervals is EMPTY for ${scheduleDate}${functionId ? ` (function ${functionId})` : ''} — ` +
        `break coverage falling back to LIVE scheduled-HC from attendance_records (required = scheduled). ` +
        `Populate headcount_intervals to enforce real required-HC coverage.`,
      );
      const coverageKey = (t: Date, fnId: string) =>
        `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}|${fnId}`;
      for (const emp of shiftRows) {
        const s = new Date(emp.shift_start);
        const e = new Date(emp.shift_end);
        for (let t = new Date(s); t < e; t = new Date(t.getTime() + 15 * 60000)) {
          const key = coverageKey(t, emp.function_id);
          const cell = coverageMap.get(key);
          if (cell) {
            cell.scheduled += 1;
            cell.required += 1;
          } else {
            coverageMap.set(key, { required: 1, scheduled: 1, onBreak: 0 });
          }
        }
      }
    }

    const MIN_COVERAGE_RATIO = 0.7; // at least 70% of required HC must remain available

    // ── 5. Generate slots ─────────────────────────────────────────────────────
    const slots: GeneratedSlot[] = [];
    const fairnessMap = new Map<string, number>();

    const breakTypeMap = new Map(breakTypes.map(bt => [bt.id, bt]));
    const policyByType = new Map<string, BreakPolicyRow[]>();
    for (const p of policies) {
      if (!policyByType.has(p.break_type_id)) policyByType.set(p.break_type_id, []);
      policyByType.get(p.break_type_id)!.push(p);
    }

    // Sort policies by priority desc for scheduling order (lunch first, then prayer, coffee, etc.)
    const sortedTypes = [...breakTypes].sort((a, b) => {
      // Prayer always first (mandatory), then lunch, coffee, bio
      if (a.is_mandatory && !b.is_mandatory) return -1;
      if (!a.is_mandatory && b.is_mandatory) return 1;
      if (a.is_prayer && !b.is_prayer) return -1;
      if (!a.is_prayer && b.is_prayer) return 1;
      return a.sort_order - b.sort_order;
    });

    for (const emp of shiftRows) {
      const shiftStart = new Date(emp.shift_start);
      const shiftEnd = new Date(emp.shift_end);
      const shiftDurationMin = (shiftEnd.getTime() - shiftStart.getTime()) / 60000;

      // DELTA for this run only — the ledger UPSERT adds it to the stored score.
      // (pg returns numeric as a string; using emp.fairness_score directly here
      //  caused string concatenation → numeric overflow.)
      let empFairnessScore = 0;
      let slotNumber = 0;

      for (const bt of sortedTypes) {
        const applicablePolicies = (policyByType.get(bt.id) ?? []).filter(
          p => !p.function_id || p.function_id === emp.function_id,
        );
        if (applicablePolicies.length === 0) continue;

        // Merge: take most-specific policy (function-specific over global)
        const policy =
          applicablePolicies.find(p => p.function_id === emp.function_id) ??
          applicablePolicies[0];

        // Skip if gender doesn't apply
        if (bt.applies_gender !== 'all' && bt.applies_gender !== emp.gender) continue;

        const allowedCount = policy.allowed_count;

        // Special handling for prayer breaks
        if (bt.is_prayer && prayers) {
          const prayerTimes = [prayers.dhuhr, prayers.asr, prayers.maghrib].filter(Boolean) as string[];
          let scheduled = 0;

          for (const ptime of prayerTimes) {
            if (scheduled >= allowedCount) break;

            const [ph, pm] = ptime.split(':').map(Number);
            const prayerMinOffset = ph * 60 + pm - (shiftStart.getHours() * 60 + shiftStart.getMinutes());

            // Only if prayer falls within shift window (with 30-min buffer)
            if (prayerMinOffset < policy.earliest_start_offset || prayerMinOffset > shiftDurationMin - policy.latest_start_offset) continue;

            const breakStartMin = prayerMinOffset;
            const breakEndMin = breakStartMin + bt.duration_minutes;
            const breakStartTime = addMinutes(shiftStart, breakStartMin);
            const breakEndTime = addMinutes(shiftStart, breakEndMin);

            if (checkCoverage(breakStartTime, breakEndTime, emp.function_id, coverageMap, MIN_COVERAGE_RATIO)) {
              slotNumber++;
              markBreakOnCoverage(breakStartTime, breakEndTime, emp.function_id, coverageMap, true);
              slots.push({
                employee_id: emp.employee_id,
                schedule_date: scheduleDate,
                break_type_id: bt.id,
                slot_number: slotNumber,
                planned_start: formatTime(breakStartTime),
                planned_end: formatTime(breakEndTime),
                generated_by: 'auto',
                tenant_id: tenantId,
              });
              scheduled++;
              empFairnessScore += 1;
            } else {
              // Find nearest safe window (±15 min)
              const shifted = findNearestSafeSlot(
                breakStartMin, bt.duration_minutes, shiftStart,
                policy.earliest_start_offset, shiftDurationMin - policy.latest_start_offset,
                emp.function_id, coverageMap, MIN_COVERAGE_RATIO,
              );
              if (shifted !== null) {
                slotNumber++;
                const st = addMinutes(shiftStart, shifted);
                const et = addMinutes(shiftStart, shifted + bt.duration_minutes);
                markBreakOnCoverage(st, et, emp.function_id, coverageMap, true);
                slots.push({
                  employee_id: emp.employee_id,
                  schedule_date: scheduleDate,
                  break_type_id: bt.id,
                  slot_number: slotNumber,
                  planned_start: formatTime(st),
                  planned_end: formatTime(et),
                  generated_by: 'auto',
                  tenant_id: tenantId,
                });
                scheduled++;
                empFairnessScore += 0.5; // partial quality (shifted from prayer)
                warnings.push(`${emp.employee_name}: prayer break shifted ±15min due to coverage.`);
              } else {
                warnings.push(`${emp.employee_name}: couldn't schedule prayer (${ptime}) — coverage too low.`);
              }
            }
          }
          continue; // prayer handled separately
        }

        // Regular break scheduling (lunch, coffee, bio, etc.)
        const earliestMin = policy.earliest_start_offset;
        const latestMin = shiftDurationMin - policy.latest_start_offset - bt.duration_minutes;
        const minGap = policy.min_gap_between_breaks;

        let placed = 0;
        let lastBreakEnd = earliestMin - minGap; // ensure first break respects gap from shift start
        const step = 15; // try every 15 min

        for (let attempt = 0; attempt < allowedCount && placed < allowedCount; attempt++) {
          // Candidate: evenly distribute N breaks across window
          const windowSize = latestMin - earliestMin;
          const segmentSize = windowSize / allowedCount;
          let candidate = Math.round(earliestMin + attempt * segmentSize + segmentSize / 2);
          candidate = Math.max(earliestMin, Math.min(latestMin, candidate));

          // Respect min gap
          if (candidate < lastBreakEnd + minGap) candidate = lastBreakEnd + minGap;
          if (candidate > latestMin) {
            warnings.push(`${emp.employee_name}: can't fit ${bt.name} break #${attempt + 1} within window.`);
            break;
          }

          // Try candidate, then scan forward/backward for coverage
          const safeMin = findNearestSafeSlot(
            candidate, bt.duration_minutes, shiftStart,
            earliestMin, latestMin,
            emp.function_id, coverageMap, MIN_COVERAGE_RATIO, minGap, lastBreakEnd,
          );

          if (safeMin !== null) {
            slotNumber++;
            const st = addMinutes(shiftStart, safeMin);
            const et = addMinutes(shiftStart, safeMin + bt.duration_minutes);
            markBreakOnCoverage(st, et, emp.function_id, coverageMap, true);
            slots.push({
              employee_id: emp.employee_id,
              schedule_date: scheduleDate,
              break_type_id: bt.id,
              slot_number: slotNumber,
              planned_start: formatTime(st),
              planned_end: formatTime(et),
              generated_by: 'auto',
              tenant_id: tenantId,
            });
            lastBreakEnd = safeMin + bt.duration_minutes;
            placed++;
            empFairnessScore += attempt === 0 ? 1 : 0.5; // early slot = higher quality
          } else {
            warnings.push(`${emp.employee_name}: can't schedule ${bt.name} break #${attempt + 1} — no coverage-safe slot.`);
          }
        }
      }

      fairnessMap.set(emp.employee_id, empFairnessScore);
    }

    return { slots, warnings, fairnessMap };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function addMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60000);
}

function formatTime(d: Date): string {
  return d.toTimeString().slice(0, 5);
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Check every 15-min interval covered by [breakStart, breakEnd] for coverage safety. */
function checkCoverage(
  breakStart: Date,
  breakEnd: Date,
  functionId: string,
  coverageMap: Map<string, { required: number; scheduled: number; onBreak: number }>,
  minRatio: number,
): boolean {
  let t = new Date(breakStart);
  while (t < breakEnd) {
    const key = `${formatTime(t)}|${functionId}`;
    const cell = coverageMap.get(key);
    if (cell) {
      const available = cell.scheduled - (cell.onBreak + 1); // +1 for this employee
      if (cell.required > 0 && available / cell.required < minRatio) return false;
    }
    t = new Date(t.getTime() + 15 * 60000);
  }
  return true;
}

/** Mark/unmark break occupancy on the coverage map. */
function markBreakOnCoverage(
  breakStart: Date,
  breakEnd: Date,
  functionId: string,
  coverageMap: Map<string, { required: number; scheduled: number; onBreak: number }>,
  add: boolean,
): void {
  let t = new Date(breakStart);
  while (t < breakEnd) {
    const key = `${formatTime(t)}|${functionId}`;
    const cell = coverageMap.get(key);
    if (cell) cell.onBreak += add ? 1 : -1;
    t = new Date(t.getTime() + 15 * 60000);
  }
}

/**
 * Search ±30 min in steps of 15 min for a coverage-safe slot.
 * Returns the offset in minutes from shift start, or null if none found.
 */
function findNearestSafeSlot(
  preferredOffset: number,
  duration: number,
  shiftStart: Date,
  earliest: number,
  latest: number,
  functionId: string,
  coverageMap: Map<string, { required: number; scheduled: number; onBreak: number }>,
  minRatio: number,
  minGap = 0,
  lastBreakEnd = 0,
): number | null {
  const searchRadius = 30;
  const step = 15;
  for (let delta = 0; delta <= searchRadius; delta += step) {
    for (const sign of [0, 1, -1]) {
      if (delta === 0 && sign !== 0) continue;
      const candidate = preferredOffset + sign * delta;
      if (candidate < earliest || candidate + duration > latest) continue;
      if (candidate < lastBreakEnd + minGap) continue;
      const st = addMinutes(shiftStart, candidate);
      const et = addMinutes(shiftStart, candidate + duration);
      if (checkCoverage(st, et, functionId, coverageMap, minRatio)) return candidate;
    }
  }
  return null;
}
