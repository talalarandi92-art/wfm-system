/**
 * Pure attendance reconciliation engine — no DB, no I/O — encodes the WFM
 * business rules confirmed by the user (2026-06-15). One agent, one day.
 *
 * Sources merged upstream into this normalized shape:
 *   • system   = Ameyo ∪ Sprinklr (earliest Ready-Start, latest Logout; union when dual)
 *   • punch    = Odoo biometric (Employee-ID keyed)
 *   • schedule = shift start/end (from Shifts)
 *   • approved = late/early minutes covered by an approved Permission/Comp
 *
 * Rules:
 *   1. Presence:  WFH is determined ONLY by a WFH shift code or a WFH location —
 *      NEVER inferred from "system login but no punch". system+punch=office ·
 *      system&!punch=office+missing_punch (see line ~76) · punch&!system=anomaly · neither=absent
 *   2. An approved permission/comp exempts that many late / early-out minutes.
 *   3. Late ALWAYS owes compensation (make-up on BOTH system & punch), even 1 min.
 *      A financial DEDUCTION only starts when effective late > 20 min.
 *   4. Overtime is split: worked-before-shift (OT-before) vs worked-after-shift (OT-after).
 *
 * Times are minutes-from-midnight. Callers normalise cross-midnight (end<start ⇒ +1440).
 */

export const DEDUCTION_THRESHOLD_MIN = 20;

export interface ReconInput {
  shiftStartMin: number | null;
  shiftEndMin: number | null;
  shiftStart2Min?: number | null; // split shift 2nd period start (e.g. Ramadan CR)
  shiftEnd2Min?: number | null;   // split shift 2nd period end — the working day ENDS here
  systemStartMin: number | null;  // earliest Ameyo/Sprinklr ready-start (union)
  systemEndMin: number | null;    // latest Ameyo/Sprinklr logout (union)
  punchInMin: number | null;      // Odoo punch in
  punchOutMin: number | null;     // Odoo punch out
  approvedLateMin?: number;       // late minutes covered by approved permission/comp
  approvedEarlyOutMin?: number;   // early-out minutes covered by approved permission/comp
}

export type Presence = 'office' | 'wfh' | 'anomaly' | 'absent' | 'unconfirmed';

export interface ReconResult {
  presence: Presence;
  systemLateMin: number; punchLateMin: number;
  systemEarlyOutMin: number; punchEarlyOutMin: number;
  /** Governing (official) figures after permission/comp exemption. */
  effectiveLateMin: number; effectiveEarlyOutMin: number;
  deductionApplies: boolean;        // effective late > 20 min
  compensationOwedMin: number;      // = effective late; must be made up on system AND punch
  otBeforeMin: number; otAfterMin: number; otTotalMin: number;
  /** OT measured on the biometric punch (after-shift) — for comparison with the system OT. */
  otPunchMin: number;
  /** OT rounded to HR half-hour blocks (min 30) for submission. */
  otRoundedMin: number;
  /** % of the scheduled shift actually covered by presence (punch ∪ system). */
  conformancePct: number;
  flags: string[];
}

/** HR rounding: OT granted in 30-min blocks, nearest half hour (round half up). */
export function roundOt(min: number): number {
  return min > 0 ? Math.round(min / 30) * 30 : 0;
}

const lateBy = (actual: number | null, start: number | null) =>
  actual != null && start != null ? Math.max(0, actual - start) : 0;
const earlyBy = (actual: number | null, end: number | null) =>
  actual != null && end != null ? Math.max(0, end - actual) : 0;

export function reconcileDay(inp: ReconInput): ReconResult {
  const hasSystem = inp.systemStartMin != null;
  const hasPunch = inp.punchInMin != null;
  const flags: string[] = [];

  let presence: Presence;
  if (hasSystem && hasPunch) presence = 'office';
  // System session but NO fingerprint punch = a MISSING PUNCH on an office shift — NOT WFH.
  // WFH is only ever asserted from a WFH shift code / WFH location (carried by the rich roster_days
  // builder), never inferred here. (Corrected 2026-06-24 to match WFM_RULES_AND_DECISIONS §4.)
  else if (hasSystem && !hasPunch) { presence = 'office'; flags.push('missing_punch'); }
  else if (!hasSystem && hasPunch) { presence = 'anomaly'; flags.push('punch_no_system'); }
  else { presence = 'absent'; }

  // SPLIT SHIFT (e.g. Ramadan CR 15:00-17:00 + 19:00-24:00): the WORKING DAY ends at
  // the LAST period's end, and the gap between periods is an unpaid break — NOT
  // overtime. Measure late from period-1 start, OT-after / early-out from the last
  // period's end, and conformance over BOTH periods.
  const p1s = inp.shiftStartMin;
  const hasSplit = inp.shiftStart2Min != null && inp.shiftEnd2Min != null;
  const rawLastEnd = hasSplit ? (inp.shiftEnd2Min as number) : inp.shiftEndMin;
  // Cross-midnight: the working day ends at/after midnight (last end ≤ period-1 start).
  const crossMidnight = p1s != null && rawLastEnd != null && rawLastEnd <= p1s;
  const adjEnd = (e: number | null) => (e == null) ? null : (p1s != null && e <= p1s ? e + 1440 : e);
  const bumpEnd = (t: number | null) => (crossMidnight && t != null && p1s != null && t < p1s) ? t + 1440 : t;
  const shiftEndAdj = adjEnd(rawLastEnd);           // end of the working day (last period)
  const systemEndAdj = bumpEnd(inp.systemEndMin);
  const punchOutAdj = bumpEnd(inp.punchOutMin);
  // Paid periods (cross-midnight adjusted) for conformance.
  const periods: Array<[number, number]> = [];
  if (p1s != null && inp.shiftEndMin != null) periods.push([p1s, adjEnd(inp.shiftEndMin) as number]);
  if (hasSplit) periods.push([inp.shiftStart2Min as number, adjEnd(inp.shiftEnd2Min ?? null) as number]);

  const systemLateMin = lateBy(inp.systemStartMin, inp.shiftStartMin);
  const punchLateMin = hasPunch ? lateBy(inp.punchInMin, inp.shiftStartMin) : 0;
  // A degenerate system window (a few minutes, no biometric punch to corroborate)
  // means the real work wasn't captured (e.g. a WFH/social agent whose Sprinklr
  // activity is missing for that month). Don't fabricate a huge early-out / tiny
  // conformance from it — flag it as incomplete and suppress the misleading figure.
  const sysWinDur = (inp.systemStartMin != null && systemEndAdj != null) ? systemEndAdj - inp.systemStartMin : 0;
  const systemIncomplete = hasSystem && !hasPunch && sysWinDur < 15;
  if (systemIncomplete) flags.push('system_incomplete');
  const systemEarlyOutMin = systemIncomplete ? 0 : earlyBy(systemEndAdj, shiftEndAdj);
  const punchEarlyOutMin = hasPunch ? earlyBy(punchOutAdj, shiftEndAdj) : 0;

  // Official figure: biometric when present (office), else system (WFH).
  const govLate = hasPunch ? punchLateMin : systemLateMin;
  const govEarly = hasPunch ? punchEarlyOutMin : systemEarlyOutMin;

  const effectiveLateMin = Math.max(0, govLate - (inp.approvedLateMin ?? 0));
  const effectiveEarlyOutMin = Math.max(0, govEarly - (inp.approvedEarlyOutMin ?? 0));

  if ((inp.approvedLateMin ?? 0) > 0 && govLate > 0) flags.push('late_covered_by_permission');
  if ((inp.approvedEarlyOutMin ?? 0) > 0 && govEarly > 0) flags.push('early_covered_by_permission');

  const deductionApplies = effectiveLateMin > DEDUCTION_THRESHOLD_MIN;
  const compensationOwedMin = effectiveLateMin; // any late must be made up (system + punch)
  if (deductionApplies) flags.push('deduction');
  if (compensationOwedMin > 0) flags.push('compensation_owed');
  // worked in the system meaningfully before the shift → candidate before-shift OT (review)
  if (inp.shiftStartMin != null && inp.systemStartMin != null && (inp.shiftStartMin - inp.systemStartMin) >= 15) flags.push('possible_ot_before');

  // Overtime is measured on the SYSTEM (actual work in the tool), not biometric:
  // someone who punches early to grab coffee but opens the system at shift time
  // earns no OT. Cross-midnight aware.
  let otBeforeMin = inp.shiftStartMin != null && inp.systemStartMin != null ? Math.max(0, inp.shiftStartMin - inp.systemStartMin) : 0;
  let otAfterMin = shiftEndAdj != null && systemEndAdj != null ? Math.max(0, systemEndAdj - shiftEndAdj) : 0;
  // BLEED GUARD: a forgotten/never-closed session (esp. on night/MD shifts) leaves
  // the logout hours or a full day late, producing impossible OT (e.g. 15h "after" a
  // 9h MD shift). When the OT exceeds what a person can plausibly work (6h) AND there
  // is no biometric punch landing near the same time to corroborate it, the timestamp
  // is bleed — don't credit it as OT. Flag it instead so it can be reviewed, never
  // silently paid. Real OT (≤6h, or punch-corroborated) is untouched.
  const MAX_PLAUSIBLE_OT_MIN = 6 * 60;
  const endCorroborated = hasPunch && punchOutAdj != null && systemEndAdj != null && Math.abs(punchOutAdj - systemEndAdj) <= 90;
  const startCorroborated = hasPunch && inp.punchInMin != null && inp.systemStartMin != null && Math.abs(inp.punchInMin - inp.systemStartMin) <= 90;
  if (otAfterMin > MAX_PLAUSIBLE_OT_MIN && !endCorroborated) { flags.push('ot_after_bleed'); otAfterMin = 0; }
  if (otBeforeMin > MAX_PLAUSIBLE_OT_MIN && !startCorroborated) { flags.push('ot_before_bleed'); otBeforeMin = 0; }
  // Same, but on the biometric punch — shown alongside the system OT for comparison.
  const otPunchMin = shiftEndAdj != null && punchOutAdj != null ? Math.max(0, punchOutAdj - shiftEndAdj) : 0;
  // Conformance still reflects real presence (punch ∪ system).
  const earliestStart = [inp.systemStartMin, inp.punchInMin].filter((x): x is number => x != null).sort((a, b) => a - b)[0] ?? null;
  const latestEnd = [systemEndAdj, punchOutAdj].filter((x): x is number => x != null).sort((a, b) => b - a)[0] ?? null;

  // Conformance: how much of the scheduled shift was actually covered by presence —
  // PLUS time covered by an APPROVED permission/comp (the agent was legitimately away,
  // so it must NOT lower conformance). e.g. an approved late-in or early-out counts
  // as covered.
  let conformancePct = 0;
  if (periods.length && earliestStart != null && latestEnd != null) {
    // paid duration = sum of all periods (the inter-period gap is NOT counted);
    // coverage = presence overlap with EACH period, summed. A split shift is only
    // 100% when both periods are covered.
    const paidDur = periods.reduce((s, [a, b]) => s + Math.max(0, b - a), 0);
    const overlap = periods.reduce((s, [a, b]) => s + Math.max(0, Math.min(latestEnd, b) - Math.max(earliestStart, a)), 0);
    const permitted = (inp.approvedLateMin ?? 0) + (inp.approvedEarlyOutMin ?? 0);
    conformancePct = paidDur > 0 ? Math.min(100, Math.round(100 * Math.min(overlap + permitted, paidDur) / paidDur)) : 0;
  }

  return {
    presence, systemLateMin, punchLateMin, systemEarlyOutMin, punchEarlyOutMin,
    effectiveLateMin, effectiveEarlyOutMin, deductionApplies, compensationOwedMin,
    otBeforeMin, otAfterMin, otTotalMin: otBeforeMin + otAfterMin, otPunchMin, otRoundedMin: roundOt(otAfterMin), conformancePct, flags,
  };
}
