/* ── COVERAGE CORE (R2.1, 2026-07-10) ─────────────────────────────────────────
 * THE canonical hourly-headcount bucketing kernel. The same "does a shift window
 * cover hour/interval X, cross-midnight aware" math was implemented ~6 times
 * across coverage / roster-hourly / schedule-ops (IA audit R2.1). Every helper
 * below was lifted VERBATIM from its crowned implementation — the generated SQL
 * strings and TS results are byte-identical to what each call site produced
 * before, so all endpoint responses are unchanged (byte-diff-gated).
 *
 * Conventions (see docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md):
 *  - minutes-of-day 0..1439; cross-midnight shifts either wrap (se<ss, e.g. MD
 *    1320→420) or store a canonical end >1440 — each helper states which form
 *    it expects.
 *  - SQL builders reference the hour CTE alias `h.hh` (or `b.bi`/`b.hh` for the
 *    absolute 7×24 week grid) — keep those aliases at the call site.
 */

/** SQL predicate: window [start, start+len) — start normalized into 0..1439,
 *  wrap spills into the SAME hour grid (hour-of-day view) — covers hour `h.hh`.
 *  Crowned from roster-v2/hourly (audit 2026-07-03 cross-midnight fix). */
export const covHourSql = (start: string, len: string): string => {
  const a0 = `(((${start})%1440+1440)%1440)`, b0 = `(${a0}+(${len}))`;
  return `((${a0} < h.hh*60+60 AND LEAST(${b0},1440) > h.hh*60) OR (${b0}>1440 AND (${b0}-1440) > h.hh*60))`;
};

/** SQL expression: overlap MINUTES of window [start, start+len) with hour
 *  `h.hh`'s bucket — exact "how many OT/permission minutes landed in this hour"
 *  (wrap handled as two segments). From roster-v2/hourly. */
export const covMinSql = (start: string, len: string): string => {
  const a0 = `(((${start})%1440+1440)%1440)`, e = `(${a0}+(${len}))`, h0 = `h.hh*60`, h1 = `(h.hh*60+60)`;
  const s1 = `GREATEST(0, LEAST(LEAST(${e},1440), ${h1}) - GREATEST(${a0}, ${h0}))`;
  const s2 = `(CASE WHEN ${e}>1440 THEN GREATEST(0, LEAST(${e}-1440, ${h1}) - ${h0}) ELSE 0 END)`;
  return `(${s1} + ${s2})`;
};

/** SQL predicate on the ABSOLUTE 7×24 week grid (minutes-from-week-start): a
 *  cross-midnight tail lands on the NEXT calendar day's buckets (audit
 *  2026-07-03 finding #2). Expects `b.bi` (day offset 0-6) + `b.hh`.
 *  From roster-v2/week-forecast. */
export const covAbsSql = (s: string, l: string): string =>
  `((${s}) < b.bi*1440 + b.hh*60 + 60 AND ((${s})+(${l})) > b.bi*1440 + b.hh*60)`;

/** SQL predicate: hour-of-day coverage when the end is ALREADY canonical
 *  (seC > ss, possibly >1440) — len = seC-ss, no %1440 normalization of ss.
 *  From gap-remedies / permission-coverage-check. */
export const covHhSql = (ss: string, seC: string): string => {
  const len = `(${seC}-${ss})`;
  return `((${ss} < h.hh*60+60 AND LEAST(${ss}+${len},1440) > h.hh*60) OR ((${ss}+${len})>1440 AND ((${ss}+${len})-1440) > h.hh*60))`;
};

/** TS predicate: does shift [ss,se) (raw minutes; wrap allowed se<=ss) cover
 *  hour h of the hour-of-day grid? From roster-v2/on-seat (covJs). */
export const coversHourJs = (ss: number, se: number, h: number): boolean => {
  const len = (se <= ss ? se + 1440 - ss : se - ss); const b0 = ss + len;
  return (ss < h * 60 + 60 && Math.min(b0, 1440) > h * 60) || (b0 > 1440 && b0 - 1440 > h * 60);
};

/** TS: which hours [0..23] does a shift ss→se ('HH:MM' strings) cover —
 *  hour-granular (start hour inclusive, end hour exclusive; b===a ⇒ [a]).
 *  From coverage/hourly (attendance_records spine). */
export const hoursCoveredHH = (ss?: string | null, se?: string | null): number[] => {
  if (!ss || !se) return [];
  const a = parseInt(String(ss).slice(0, 2), 10);
  const b = parseInt(String(se).slice(0, 2), 10);
  if (isNaN(a) || isNaN(b)) return [];
  const out: number[] = [];
  if (b > a) { for (let h = a; h < b; h++) out.push(h); }
  else if (b === a) { out.push(a); }
  else { for (let h = a; h < 24; h++) out.push(h); for (let h = 0; h < b; h++) out.push(h); }
  return out;
};

/** TS predicate for a step-interval grid on a target date: does the interval
 *  starting at minute i0 (on targetDate) fall inside window [lo,hi) that lives
 *  on rowDate? hi is CANONICAL (>1440 = crosses midnight); a previous-day row
 *  reaches targetDate only via its overnight tail. From interval-headcount. */
export const coversIntervalOnDate = (rowDate: string, targetDate: string, lo: number, hi: number, i0: number): boolean => {
  if (lo == null || hi == null) return false;
  if (rowDate === targetDate) return i0 >= lo && i0 < Math.min(hi, 1440);
  return hi > 1440 && i0 < (hi - 1440);
};

/** TS: avg-concurrent sampling — 30-min samples of each shift [ss,se) (wrap
 *  corrected) accumulated into per-hour minute totals mins[0..23].
 *  From schedule-analysis's hourly headcount. */
export const sampledHourlyMinutes = (shifts: Array<{ ss: any; se: any }>): number[] => {
  const mins = new Array(24).fill(0);
  for (const sh of shifts) {
    const ss = Number(sh.ss); let se = Number(sh.se); if (se <= ss) se += 1440;
    for (let m = ss; m < se; m += 30) { mins[Math.floor((((m % 1440) + 1440) % 1440)) / 60 | 0] += 30; }
  }
  return mins;
};

/** Canonical shift-dictionary fallback times (minutes) for suffix/marker rows
 *  that carry no timing (June suffix rows) — BR-SHF-005: a suffix keeps the
 *  base shift + timing. From roster-v2/hourly. */
export const STD_SHIFT_START_SQL = `CASE regexp_replace(upper(COALESCE(attendance_code,shift_code,'')),'([SA])$','')
      WHEN 'M' THEN 420 WHEN 'AM' THEN 420 WHEN 'M20' THEN 480 WHEN 'B' THEN 540 WHEN 'B20' THEN 600
      WHEN 'C' THEN 660 WHEN 'C20' THEN 720 WHEN 'N' THEN 780 WHEN 'N20' THEN 840 WHEN 'E' THEN 960
      WHEN 'EE' THEN 1080 WHEN 'EE20' THEN 1080 WHEN 'MD' THEN 1320 WHEN 'MN' THEN 1380 END`;
export const STD_SHIFT_END_SQL = `CASE regexp_replace(upper(COALESCE(attendance_code,shift_code,'')),'([SA])$','')
      WHEN 'M' THEN 960 WHEN 'AM' THEN 900 WHEN 'M20' THEN 960 WHEN 'B' THEN 1080 WHEN 'B20' THEN 1080
      WHEN 'C' THEN 1200 WHEN 'C20' THEN 1200 WHEN 'N' THEN 1320 WHEN 'N20' THEN 1320 WHEN 'E' THEN 1500
      WHEN 'EE' THEN 1560 WHEN 'EE20' THEN 1620 WHEN 'MD' THEN 1860 WHEN 'MN' THEN 1920 END`;
