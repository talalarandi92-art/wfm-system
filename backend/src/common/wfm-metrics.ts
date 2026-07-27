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

/**
 * PUNCH-BASED tardiness, for the surfaces still reading `attendance_records`
 * (People 360, the Reports exports, coaching, the scorecard attendance block).
 * Same 7..240 window as CRED_LATE/CRED_EARLY — those name the SYSTEM-login
 * columns on roster_days; these name the PUNCH columns on attendance_records.
 *
 * They exist because five places were each carrying their own `> 0` test, so a
 * one-minute lateness counted against a person on one screen and not on another,
 * and a cross-midnight punch landing on the wrong calendar day read as a
 * four-hour lateness with no upper bound. Audited 2026-07-25: applying the window
 * moves the population from 1,710 late-days / 100 people to 1,149 / 89 — 551 of
 * the removed days were between 1 and 6 minutes, across 88 different people.
 */
export const PUNCH_LATE = '(punch_late_minutes BETWEEN 7 AND 240)';
export const PUNCH_EARLY = '(punch_early_out_minutes BETWEEN 7 AND 240)';

/**
 * The canonical-identity filter. `is_active` is the CANONICAL-DEDUP flag
 * (BR-ATT-008) — it marks the surviving row when one human has two ids (the
 * intern 6xxxx / full-time 1xxxx pair). It is NOT employment status.
 * Omitting it double-counts people; every roster read must carry it.
 */
export const ACTIVE_ROW = 'is_active';
