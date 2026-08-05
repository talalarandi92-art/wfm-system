/**
 * Pure WFM calculation helpers — no DB, no I/O — so they are unit-testable and
 * form the single source of truth for the core algorithms used across analytics,
 * skills coverage, shrinkage, and chat. Kept dependency-free.
 */

/**
 * Boutiqaat weekend = THURSDAY (4) + FRIDAY (5) + SATURDAY (6). DOW: 0=Sun … 6=Sat.
 *
 * Director's ruling 2026-08-05, superseding the 2026-07-02 Thu+Fri ruling.
 *
 * The earlier ruling was recorded here as resolving "the old Thu/Fri/Sat vs Fri/Sat drift",
 * and it did not: thirteen call sites moved to DOW IN (4,5) while the OT tracker stayed on
 * ISODOW IN (5,6) — which is FRIDAY + SATURDAY. The platform has been running two different
 * weekends, so the OT tracker tinted Saturday as weekend while fairness counted Thursday.
 * A definition that lives in fifteen SQL literals drifts the moment one is missed.
 *
 * Hence WEEKEND_DOW below. Every consumer — TypeScript and SQL — now reads the same list,
 * and a future change is one edit rather than a search.
 */
export const WEEKEND_DOW = [4, 5, 6] as const;

/** SQL predicate for the weekend, so a query cannot disagree with the code. Takes the date
 *  column, e.g. `weekendSql('r.work_date')` → `EXTRACT(DOW FROM r.work_date) IN (4,5,6)`. */
export const weekendSql = (col: string) => `EXTRACT(DOW FROM ${col}) IN (${WEEKEND_DOW.join(',')})`;

export function isWeekend(dow: number): boolean {
  return (WEEKEND_DOW as readonly number[]).includes(dow);
}

/**
 * Does a shift window [startHour, endHour) cover hour `h`? Cross-midnight aware
 * (e.g. 22→07 covers 23 and 03). When start === end, treated as a full-day shift.
 */
export function shiftCoversHour(startHour: number, endHour: number, h: number): boolean {
  if (startHour === endHour) return true;
  if (startHour < endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour;   // wraps past midnight
}

/** Does a shift window cover an entire gap window [fromH, toH)? Cross-midnight aware. */
export function shiftCoversWindow(startHour: number, endHour: number, fromH: number, toH: number): boolean {
  if (startHour < endHour) return fromH >= startHour && toH <= endHour;
  return fromH >= startHour || toH <= endHour;
}

/** Categorise a working shift by its start hour. */
export function shiftCategory(startHour: number): 'morning' | 'evening' | 'night' | 'midnight' {
  if (startHour >= 5 && startHour <= 11) return 'morning';
  if (startHour >= 12 && startHour <= 16) return 'evening';
  if (startHour >= 17 && startHour <= 21) return 'night';
  return 'midnight';   // 22–23 or 0–4
}

/** Shrinkage % = lost scheduled-work days / scheduled-work days (rounded to 1 dp). */
export function shrinkagePct(scheduledDays: number, lostDays: number): number {
  if (scheduledDays <= 0) return 0;
  return Math.round(1000 * lostDays / scheduledDays) / 10;
}

/** Map an Odoo leave/time-off type to a WFM attendance_marker. */
export function mapLeaveMarker(odooType: string): 'sick' | 'holiday' | 'leave' {
  const t = (odooType || '').toLowerCase();
  if (t.includes('sick') || t.includes('مرض')) return 'sick';
  if (t.includes('holiday') || t.includes('عطلة')) return 'holiday';
  return 'leave';
}

/** Map an upload MIME type to an attachment kind. */
export function mimeToAttachmentType(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('video/')) return 'video';
  if (mime?.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Classify a CSAT/NPS rating value into sentiment. CSAT ≤5 scale, else NPS 0-10. */
export function ratingSentiment(raw: string | null): 'positive' | 'negative' | 'neutral' | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const v = String(raw).toLowerCase();
  const num = parseFloat(v);
  if (!isNaN(num)) {
    if (num <= 5) return num >= 4 ? 'positive' : num <= 2 ? 'negative' : 'neutral';
    return num >= 9 ? 'positive' : num <= 6 ? 'negative' : 'neutral';
  }
  if (['positive', 'good', 'great', 'excellent', 'satisfied', 'happy', 'ممتاز', 'جيد'].some(w => v.includes(w))) return 'positive';
  if (['negative', 'bad', 'poor', 'unsatisfied', 'angry', 'سيء'].some(w => v.includes(w))) return 'negative';
  return 'neutral';
}
