/**
 * KUWAIT-LOCAL CALENDAR DATES — one helper, because getting this wrong is silent.
 *
 * `new Date().toISOString().slice(0,10)` is a UTC calendar date. Kuwait is UTC+03:00
 * with no DST, so between 00:00 and 02:59 local it names YESTERDAY. Audited across
 * this codebase on 2026-07-25, that single expression was producing:
 *
 *   · the executive month-to-date bundle reporting the whole PREVIOUS month, because
 *     the window start derives from it and rolls back on the 1st of a month;
 *   · the intraday break screen opening on yesterday's breaks;
 *   · the calendar highlighting the wrong cell as "today" and pre-filling yesterday;
 *   · a campaign that starts today reporting "upcoming" — and the blackout check
 *     that decides whether a request is restricted using the same wrong day;
 *   · "who can cover right now?" querying yesterday's roster;
 *   · a cross-skill dispatch window created in the past.
 *
 * None of these throw. They are simply wrong for three hours a day, which is why
 * they survived: the person who would notice is asleep.
 *
 * BR-TIM-001 bans `toISOString()` for a local date. These functions are the
 * sanctioned replacement on the server; the browser uses `utils/format.fmtLocalDate`.
 */

/** Kuwait is UTC+03:00 year-round — no daylight saving to track. */
const KW_OFFSET_MS = 3 * 3600_000;

/** The current Kuwait wall-clock instant, as a Date whose UTC fields read local. */
export function kwNow(): Date {
  return new Date(Date.now() + KW_OFFSET_MS);
}

/** Today in Kuwait as `YYYY-MM-DD`. */
export function kwToday(): string {
  return kwNow().toISOString().slice(0, 10);
}

/** Kuwait wall-clock hour, 0-23. Pairs with kwToday() so date and hour agree. */
export function kwHour(): number {
  return kwNow().getUTCHours();
}

/** `YYYY-MM` for the current Kuwait month. */
export function kwMonth(): string {
  return kwToday().slice(0, 7);
}

/** First day of the current Kuwait month, `YYYY-MM-01`. */
export function kwMonthStart(): string {
  return `${kwMonth()}-01`;
}

/**
 * Format a Date (or a pg `date` already parsed to local midnight) as a LOCAL
 * `YYYY-MM-DD`. node-postgres parses a `date` column into a JS Date at LOCAL
 * midnight, so `.toISOString()` on it shifts the day backwards in any positive
 * offset — which is how several `MAX(attendance_date)` defaults silently dropped
 * the newest day of data. Reads the local fields instead of re-projecting to UTC.
 */
export function fmtLocalDate(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Shift a `YYYY-MM-DD` by whole days without crossing a timezone. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
