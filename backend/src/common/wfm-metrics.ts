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

/**
 * SCORECARD MONTH RESULT — read it from `weekly_nets`, never from `avg_net_points`.
 *
 * `scorecard_monthly.weekly_nets` is stored as [W1 … Wn, MONTH RESULT]. The last
 * element is NOT another week: in the source workbook each agent occupies five
 * consecutive rows whose `Weeks` column reads 1, 2, 3, 4 and then a TEXT label —
 * `Final` (755 agent-months), `TMS` (157), `Leave` (60), `Support` (6). That fifth
 * row is the month's verdict. `import-scorecards.js` appends every row's Net Points
 * in sheet order, so the verdict lands last, and then averages the WHOLE array into
 * `avg_net_points` — folding the month result in as if it were a fifth week.
 *
 * Measured against each workbook's own `Results` sheet (`Net Points` column), all
 * 13 months on disk:
 *     last element   Oct 64/64 · Nov 93/93 · Jan 82/82 · Feb 66/66 · Mar 67/67 · Apr 65/65
 *     avg_net_points  1 to 9 out of 60-90, in every single month
 * So `avg_net_points` is neither the month result nor the average of the weeks, and
 * it was what ten read sites across four modules used as "the agent's score for that
 * month" — /scorecard/analyze, People 360, the ops trend, the intern recommendations.
 *
 * KNOWN EDGE: 7 of 985 agent-months have no verdict row at all (the agent left, or
 * the sheet is a single-row month like May 2025), so SC_MONTH_NET returns their last
 * scored week. Neither reading is "official" for those — there is no official value
 * to read. They are 0.7% and they are not silently different from before: an average
 * of weeks was not official either.
 *
 * These read the array directly, so no stored data is rewritten and the change is
 * reversible. Correcting the INGEST — a real `official_net` column, `weeks_scored`
 * and best/worst over the real weeks only — is a separate, number-changing job that
 * needs a dry-run and the Director's go before it touches stored rows.
 */
/** The month's result — the last element of weekly_nets. `alias` qualifies the column in a join. */
export const scMonthNet = (alias = '') => {
  const c = alias ? `${alias}.weekly_nets` : 'weekly_nets';
  return `(${c}[array_upper(${c}, 1)])`;
};
export const SC_MONTH_NET = scMonthNet();

/**
 * The REAL weeks — the array WITHOUT its verdict row. A single-element row has no
 * known weeks, so the slice is empty and the aggregates below are NULL rather than
 * a made-up number.
 *
 * `best_net` / `worst_net` / `weeks_scored` as stored all include the verdict row,
 * so "best week" could report the month result and "weeks scored" counted 5 for a
 * 4-week month. These recompute over the weeks alone.
 */
const SC_REAL_WEEKS = 'weekly_nets[1:GREATEST(array_upper(weekly_nets,1) - 1, 0)]';
export const SC_WEEKS_AVG = `(SELECT AVG(x)   FROM unnest(${SC_REAL_WEEKS}) x)`;
export const SC_WEEKS_BEST = `(SELECT MAX(x)   FROM unnest(${SC_REAL_WEEKS}) x)`;
export const SC_WEEKS_WORST = `(SELECT MIN(x)   FROM unnest(${SC_REAL_WEEKS}) x)`;
export const SC_WEEKS_COUNT = `(SELECT COUNT(*) FROM unnest(${SC_REAL_WEEKS}) x)`;
