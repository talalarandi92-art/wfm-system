/**
 * CANONICAL WFM METRIC DEFINITIONS — the ONE source (EXECUTION_BRIEF bug #2, extracted
 * 2026-07-06 from recon.controller.ts). Every report/controller MUST import these; a local
 * redefinition is a correctness bug (two dashboards disagreeing on the same KPI).
 *
 * TRUE_OT (BR-OT-001): overtime lives in THREE DISJOINT buckets — ot_min (worked-day OT),
 *   offday_ot_min (worked an OFF/leave day), holiday_ot_min (worked an official holiday).
 *   Each roster_days row sits in exactly one bucket, so the real total is their SUM.
 *   Summing ot_min alone undercounts (~28% on live data).
 *
 * CRED_LATE / CRED_EARLY (BR-TRD-001/002): a credible late-in/early-out is 7..240 min
 *   (>6 min tolerated, rule 2026-06-30). Cross-midnight night shifts (MD/MN/MNR) make the
 *   post-midnight session tail read as a multi-hour false late/early — an artifact — so
 *   values >4h are excluded from credible-tardiness counts (HR-safe).
 *
 * MATERNITY_7H (BR-MAT-001): the maternity-7h mothers (Haya Mohanna 12375, Shaima Saoud
 *   12434) work a legitimate 7h day — their ~2h/day early-out is STRUCTURAL, not a
 *   violation → excluded from credible EARLY-OUT everywhere (late-in still counts).
 */
export const MATERNITY_7H = "('12375','12434')";

export const TRUE_OT =
  '(COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0))';

export const CRED_LATE = '(sys_late_min BETWEEN 7 AND 240)';

export const CRED_EARLY =
  `(sys_early_min BETWEEN 7 AND 240 AND COALESCE(person_no,employee_no) NOT IN ${MATERNITY_7H})`;
