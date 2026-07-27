/**
 * THE shift-code colour palette — one definition, because a shift code that is
 * violet on one screen and a lighter violet on another is the same drift the
 * platform forbids for numbers (dashboard principle P-3), just in colour.
 *
 * Found on 2026-07-27 while darkening the night codes: `N` was `#8b5cf6` in
 * ShiftRotation and both generator legends, but `#a78bfa` in ScheduleDemand and
 * the Shift Fairness legend. Darkening it in one file would have fixed one screen
 * and widened the gap on the others.
 *
 * NIGHT CODES DARKENED (Director's call, 2026-07-27):
 *   N   violet-500 #8b5cf6 → violet-600 #7c3aed
 *   N2  violet-700 #6d28d9 → violet-900 #4c1d95
 *
 * Why both moved: #8b5cf6 sits in the one luminance band where NEITHER black nor
 * white text reaches AA (4.22:1 either way), so the chip could not be made
 * readable without moving the colour. But darkening N alone to violet-600 would
 * have left it ΔE 6.2 from N2 — two distinct shift codes reading as one colour,
 * an operational problem worse than the contrast one. At violet-600/violet-900
 * the pair sits at ΔE 33.3, a WIDER separation than the 19.7 they had before.
 *
 * Pair every use with `readableOn()` rather than a hardcoded `text-white`: this
 * palette spans #38bdf8 to #1e1b4b, so no single foreground is right for all of it.
 */
export const SHIFT_COLORS: Record<string, string> = {
  M:   '#0ea5e9',   // morning
  B:   '#38bdf8',   // mid-morning
  C:   '#f59e0b',   // midday
  E:   '#f97316',   // evening
  N:   '#7c3aed',   // night
  N2:  '#4c1d95',   // late night
  MD:  '#1e3a5f',   // midnight
  MN:  '#1e1b4b',   // midnight (late)
  OFF: '#475569',
};

/** The colour for a raw shift code, tolerating suffixes (N20, MDR, WFH-N…). */
export function shiftColor(code?: string | null, fallback = '#6366f1'): string {
  if (!code) return fallback;
  const c = code.trim().toUpperCase();
  if (SHIFT_COLORS[c]) return SHIFT_COLORS[c];
  if (/^(MD|MN)/.test(c)) return SHIFT_COLORS.MD;
  if (/^N/.test(c)) return SHIFT_COLORS.N;
  if (/^(M|B|C)/.test(c)) return SHIFT_COLORS.M;
  if (/^E/.test(c)) return SHIFT_COLORS.E;
  if (/^OFF/.test(c)) return SHIFT_COLORS.OFF;
  return fallback;
}
