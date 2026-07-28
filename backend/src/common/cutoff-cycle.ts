/**
 * CUT-OFF CYCLES — the period every entitlement and deduction is counted over.
 *
 * BR-TIM-002 (Confirmed): the workforce month is NOT the calendar month.
 *   · full-time   the 15th → the 14th of the next month
 *   · interns     the 1st  → the end of the same month
 *   · Bahrain     the 25th → the 24th of the next month
 *
 * WHY THIS FILE EXISTS: the permission balance (BR-PRM-003 — 6 hours and 3
 * permissions, renewing per CYCLE) was being enforced over a Saturday–Friday
 * WEEK. A cycle is roughly a month, so the code granted about four times the
 * agreed entitlement. Measured on the live data before the fix: of 2,298
 * employee-cycles, 384 (16.7%) exceeded 3 permissions and 442 (19.2%) exceeded
 * 6 hours — one cycle reached 11 permissions and 1,383 minutes (23 hours).
 *
 * The doctrine is that the RULE wins and the code is corrected to match it, so
 * this is a bug fix rather than a policy change — but it TIGHTENS what employees
 * can take, so the impact was measured and reported before it went live.
 *
 * BAHRAIN IS NOT IMPLEMENTED, deliberately. Nothing in the schema identifies a
 * Bahrain employee — `employees` has employment_type (full_time | intern) and no
 * site, location or country column, and no function or name carries the marker.
 * Guessing which people belong to a 25→24 cycle would silently mis-state their
 * balance, so they fall through to the full-time cycle and the gap is stated
 * here instead of being papered over. Add a site column and this becomes one
 * extra branch.
 */

export type CycleKind = 'full_time' | 'intern' | 'bahrain';

/** First day (inclusive) of each cycle kind, as a day-of-month. */
const CYCLE_START_DAY: Record<CycleKind, number> = {
  full_time: 15,
  intern: 1,
  bahrain: 25,
};

export interface CutoffCycle {
  /** Inclusive first day, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive last day, `YYYY-MM-DD`. */
  to: string;
  /** A stable label for the cycle, e.g. "2026-07-15 → 2026-08-14". */
  label: string;
  kind: CycleKind;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The cut-off cycle that CONTAINS `date` for an employee of `kind`.
 *
 * All arithmetic is UTC. A local-field mix here would move the cycle boundary by
 * a day on a +03 host, which is the same class of bug BR-TIM-001 exists for —
 * and on a boundary day that would put a permission in the wrong cycle entirely.
 */
export function cutoffCycleFor(date: string, kind: CycleKind = 'full_time'): CutoffCycle {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  const startDay = CYCLE_START_DAY[kind] ?? CYCLE_START_DAY.full_time;

  if (kind === 'intern') {
    // calendar month: 1st → last day of the same month
    const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { from: iso(from), to: iso(to), label: `${iso(from)} → ${iso(to)}`, kind };
  }

  // On or after the start day the cycle opened THIS month; before it, last month.
  const anchorMonth = d.getUTCDate() >= startDay ? d.getUTCMonth() : d.getUTCMonth() - 1;
  const from = new Date(Date.UTC(d.getUTCFullYear(), anchorMonth, startDay));
  // last day = the day before the next cycle opens
  const to = new Date(Date.UTC(d.getUTCFullYear(), anchorMonth + 1, startDay - 1));
  return { from: iso(from), to: iso(to), label: `${iso(from)} → ${iso(to)}`, kind };
}

/** Map an `employees.employment_type` value onto a cycle kind. */
export function cycleKindFor(employmentType?: string | null): CycleKind {
  return employmentType === 'intern' ? 'intern' : 'full_time';
}
