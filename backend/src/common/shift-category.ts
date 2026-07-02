/**
 * THE ONE canonical shift-category mapping — docs/knowledge/WFM_RULES_AND_DECISIONS.md §3.
 *
 *   Morning/Day : M, B, C, AM   (+ M20/B20/C20, M7-3, B7/C7, WFH variants)
 *   Evening     : E, EE20
 *   Night       : N, N20
 *   Midnight    : MD, MN, MDR, MNR
 *
 * Classify by CODE first; fall back to the shift START HOUR only when no code exists.
 * Canonical start times: M 07:00 · B 09:00 · C 11:00 · N 13:00 · E 16:00 · EE20 18:00 · MD 22:00.
 *
 * Every ANALYTIC site (fairness, shift-rate %, rankings, self-service rotation balance)
 * must import from here — this module exists to kill the 6-way drift the 2026-07-01
 * audit verified (a 13:00 shift bucketed as evening in one endpoint and night in another).
 * NOTE: the Schedule grid's VISUAL taxonomy ('between' for B/C colours) and the
 * generator's hour→code derivation are display/behaviour concerns kept separate — see
 * WFM_RULES §16 before touching those.
 */

export type ShiftCategory = 'morning' | 'evening' | 'night' | 'midnight' | 'other';

const RE_MIDNIGHT = /^(MD|MN)/i;
const RE_NIGHT = /^N/i;          // N, N20, N7 (checked after midnight so MN never lands here)
const RE_EVENING = /^(E|EE)/i;   // E, EE20, E20
const RE_MORNING = /^(M|B|C|AM)/i; // M, B, C, AM + 20/7 variants (checked last so MD/MN/N/E won)

/** Canonical category from a shift CODE (WFH prefixes/suffixes stripped). */
export function shiftCategoryFromCode(codeRaw: string | null | undefined): ShiftCategory {
  if (!codeRaw) return 'other';
  const code = String(codeRaw).toUpperCase().replace(/^WFH[-_]?/, '').replace(/[-_]?WFH$/, '').trim();
  if (!code) return 'other';
  if (RE_MIDNIGHT.test(code)) return 'midnight';
  if (RE_NIGHT.test(code)) return 'night';
  if (RE_EVENING.test(code)) return 'evening';
  if (RE_MORNING.test(code)) return 'morning';
  return 'other';
}

/** Canonical fallback from the shift START HOUR (only when no code is available).
 *  5–12 → morning (M/B/C/AM starts) · 13–14 → night (N) · 15–20 → evening (E/EE) ·
 *  ≥21 or <5 → midnight (MD/MN). */
export function shiftCategoryFromHour(h: number | null | undefined): ShiftCategory {
  if (h == null || Number.isNaN(h)) return 'other';
  if (h >= 5 && h <= 12) return 'morning';
  if (h >= 13 && h <= 14) return 'night';
  if (h >= 15 && h <= 20) return 'evening';
  return 'midnight';
}

/** The same code-first mapping as a SQL CASE over the given expression (upper-cased inside). */
export function shiftCategoryCaseSql(expr: string): string {
  const U = `upper(coalesce(${expr},''))`;
  return `CASE WHEN ${U} ~ '^(MD|MN)' THEN 'midnight' WHEN ${U} ~ '^N' THEN 'night' WHEN ${U} ~ '^(E|EE)' THEN 'evening' WHEN ${U} ~ '^(M|B|C|AM)' THEN 'morning' ELSE 'other' END`;
}

/** The hour fallback as SQL over an integer-hour expression. */
export function shiftCategoryHourCaseSql(hourExpr: string): string {
  return `CASE WHEN ${hourExpr} BETWEEN 5 AND 12 THEN 'morning' WHEN ${hourExpr} BETWEEN 13 AND 14 THEN 'night' WHEN ${hourExpr} BETWEEN 15 AND 20 THEN 'evening' WHEN ${hourExpr} IS NULL THEN 'other' ELSE 'midnight' END`;
}
