/**
 * Smart Break Management — pure policy/entitlement/window logic (B1/B2).
 * Zero I/O: everything here is unit-testable and shared by BreakPolicyService
 * and BreakSchedulerService. Keep business math OUT of SQL where practical.
 */

export interface BreakPolicyV2Row {
  id: string;
  tenant_id: string;
  function_name: string | null;    // canon function name; NULL = wildcard
  shift_type: string | null;       // shift code; NULL = wildcard
  employment_type: string | null;  // NULL = wildcard
  total_daily_minutes: number;
  max_sessions: number;
  duration_pattern: number[];      // session durations in generation order
  protected_first_min: number;
  protected_last_min: number;
  min_gap_between_breaks_min: number;
  min_work_before_first_min: number;
  max_delay_min: number;
  release_mode: 'auto' | 'supervisor' | 'hybrid' | 'freeze';
  thresholds: Record<string, unknown>;
  active: boolean;
}

const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase();

/**
 * Most-specific active policy wins.
 * Specificity ranking (highest first): function+shift_type > function > shift_type > default.
 * employment_type adds specificity WITHIN each level (a function+employment row beats
 * a function-only row). A row only matches when every non-NULL selector matches.
 * Score: function match = 4, shift_type match = 2, employment_type match = 1.
 */
export function pickMostSpecificPolicy(
  rows: BreakPolicyV2Row[],
  functionName: string | null | undefined,
  shiftType: string | null | undefined,
  employmentType: string | null | undefined,
): BreakPolicyV2Row | null {
  const fn = norm(functionName), st = norm(shiftType), et = norm(employmentType);
  let best: BreakPolicyV2Row | null = null;
  let bestScore = -1;
  for (const r of rows) {
    if (!r.active) continue;
    if (r.function_name != null && norm(r.function_name) !== fn) continue;
    if (r.shift_type != null && norm(r.shift_type) !== st) continue;
    if (r.employment_type != null && norm(r.employment_type) !== et) continue;
    const score =
      (r.function_name != null ? 4 : 0) +
      (r.shift_type != null ? 2 : 0) +
      (r.employment_type != null ? 1 : 0);
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

/** Session durations for a shift: policy pattern, capped by max_sessions and
 *  total_daily_minutes (never exceed either — trailing sessions are trimmed/cut). */
export function sessionPattern(policy: Pick<BreakPolicyV2Row, 'duration_pattern' | 'max_sessions' | 'total_daily_minutes'>): number[] {
  const raw = Array.isArray(policy.duration_pattern) ? policy.duration_pattern : [];
  const out: number[] = [];
  let sum = 0;
  for (const d of raw) {
    if (out.length >= policy.max_sessions) break;
    const dur = Math.max(0, Math.floor(Number(d) || 0));
    if (dur <= 0) continue;
    if (sum + dur > policy.total_daily_minutes) {
      const rest = policy.total_daily_minutes - sum;
      if (rest >= 5) { out.push(rest); sum += rest; }
      break;
    }
    out.push(dur); sum += dur;
  }
  return out;
}

export interface EntitlementCheck {
  allowed: boolean;
  remainingMin: number;
  remainingSessions: number;
  reason: string | null;      // EN
  reasonAr: string | null;    // AR
}

/**
 * Pure entitlement check: given entitlement, already-used minutes/sessions and a
 * requested duration, decide whether one more break session fits.
 */
export function computeEntitlement(
  entitledMinutes: number,
  maxSessions: number,
  usedMinutes: number,
  sessionsUsed: number,
  requestedMin: number,
): EntitlementCheck {
  const remainingMin = Math.max(0, entitledMinutes - usedMinutes);
  const remainingSessions = Math.max(0, maxSessions - sessionsUsed);
  if (remainingSessions <= 0) {
    return {
      allowed: false, remainingMin, remainingSessions,
      reason: `Break session limit reached (${maxSessions} per day).`,
      reasonAr: `تم بلوغ الحد الأقصى لعدد جلسات البريك (${maxSessions} يومياً).`,
    };
  }
  if (requestedMin > remainingMin) {
    return {
      allowed: false, remainingMin, remainingSessions,
      reason: `Requested ${requestedMin} min exceeds remaining daily break balance (${remainingMin} of ${entitledMinutes} min).`,
      reasonAr: `المدة المطلوبة ${requestedMin} دقيقة تتجاوز رصيد البريك المتبقي اليوم (${remainingMin} من ${entitledMinutes} دقيقة).`,
    };
  }
  return { allowed: true, remainingMin, remainingSessions, reason: null, reasonAr: null };
}

/**
 * Generation window inside a shift (minutes from shift start), honoring:
 *  - protected first window: no auto slot may START before max(protected_first, min_work_before_first)
 *  - protected last window:  no auto slot may END within protected_last of shift end
 * Returns null when the shift is too short to fit the session at all.
 */
export function generationWindow(
  shiftDurationMin: number,
  sessionDurationMin: number,
  policy: Pick<BreakPolicyV2Row, 'protected_first_min' | 'protected_last_min' | 'min_work_before_first_min'>,
): { earliestStartMin: number; latestStartMin: number } | null {
  const earliestStartMin = Math.max(policy.protected_first_min, policy.min_work_before_first_min);
  const latestStartMin = shiftDurationMin - policy.protected_last_min - sessionDurationMin;
  if (latestStartMin < earliestStartMin) return null;
  return { earliestStartMin, latestStartMin };
}

/**
 * Cross-midnight slot dating: the DATE a planned start belongs to.
 * scheduleDate = the shift's roster day (YYYY-MM-DD); offsets are minutes from
 * shift start. shiftStartMinOfDay = the shift's wall-clock start (0..1439).
 * When shiftStartMinOfDay + slotOffset crosses 1440, the slot belongs to the
 * next calendar day.
 */
export function plannedDateFor(scheduleDate: string, shiftStartMinOfDay: number, slotOffsetMin: number): string {
  const abs = shiftStartMinOfDay + slotOffsetMin;
  const dayShift = Math.floor(abs / 1440);
  if (dayShift <= 0) return scheduleDate;
  const d = new Date(`${scheduleDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayShift);
  return d.toISOString().slice(0, 10);
}

/** Wall-clock HH:MM for a slot offset (minutes from shift start). */
export function wallClockHHMM(shiftStartMinOfDay: number, slotOffsetMin: number): string {
  const m = ((shiftStartMinOfDay + slotOffsetMin) % 1440 + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Slot position bucket within the shift (for the fairness ledger). */
export function slotPositionBucket(slotStartOffsetMin: number, shiftDurationMin: number): 'early' | 'mid' | 'late' {
  const frac = shiftDurationMin > 0 ? slotStartOffsetMin / shiftDurationMin : 0;
  if (frac < 1 / 3) return 'early';
  if (frac < 2 / 3) return 'mid';
  return 'late';
}

/** Per-function per-interval simultaneous-break cap (anti-clustering §9). */
export function functionSimultaneousCap(
  scheduled: number,
  required: number,
  thresholds: Record<string, unknown> | null | undefined,
  coverageRatio = 0.7,
): number {
  const t = thresholds ?? {};
  const explicit = Number((t as any).max_simultaneous);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const buffer = Number((t as any).buffer_hc) || 0;
  // Real surplus when a demand source exists; degenerate required==scheduled (v1
  // rebuild) falls back to the coverage-ratio headroom so generation isn't crippled.
  const surplus = scheduled - required - buffer;
  if (surplus > 0) return surplus;
  return Math.max(1, Math.floor(scheduled * (1 - coverageRatio)));
}
