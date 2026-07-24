/**
 * MONTHLY OVERTIME TRACKER — one live sheet replacing 11 hand-merged workbooks.
 *
 * The Director tracks OT in a separate workbook PER OCCASION (Eid al-Fitr, New
 * Year, Israa wal Miraj, National Day, Ramadan, Arafat & Eid al-Adha, SS April…)
 * — 11 files for 2026 alone, one of them duplicated as "…Final". This builds the
 * same picture from `roster_days`, live, in the shape of his own August template:
 * people down, days across, one cell per person-day, four totals on the right.
 *
 * WHY IT NEEDS NO MERGING: the three OT buckets are already reconciled per person
 * per day and are DISJOINT by rule (BR-OT-001) — `ot_min` is always 0 on an
 * off/holiday row, so a cell can never be two types at once and the month total
 * can never double-count:
 *     ot_min          → N  normal-day overtime
 *     offday_ot_min   → O  weekly-off overtime
 *     holiday_ot_min  → H  public-holiday overtime
 *
 * PAY RATES ARE NOT INVENTED HERE. They are read from the Director's own files:
 * the template's total columns carry `…*1.25`, `…*1.5`, `…*2`, and
 * `Overtime 2026/OV CALCULATION.xlsx` states the base as monthly salary ÷ 26 days
 * ÷ 8 hours. Both are exposed as inputs (see OT_RATES) rather than buried, so a
 * change of policy is a config change and never a silent re-interpretation.
 *
 * READ-ONLY. This service computes and presents; it never writes pay data.
 */
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { payableOtMin } from '@common/ot-review';

/** Multipliers taken verbatim from the Director's tracker formulas. */
export const OT_RATES = { normal: 1.25, offday: 1.5, holiday: 2.0 } as const;
/** Hourly base = monthly salary ÷ WORK_DAYS ÷ DAY_HOURS (OV CALCULATION.xlsx). */
export const OT_BASE = { workDaysPerMonth: 26, hoursPerDay: 8 } as const;

export type OtType = 'N' | 'O' | 'H';

export interface OtCell {
  /** 1-31 */
  day: number;
  /** PAYABLE overtime hours, 2dp — never the money figure. = detected + acknowledged review. */
  hours: number;
  type: OtType;
  /** What the engine measured for this day, before the review decision is applied. */
  detected: number;
  /** Acknowledged before/after-shift minutes added by the review queue (D-2026-07-11 #2). */
  reviewHours: number;
  /** Before/after-shift minutes still PENDING review — shown, never paid. */
  pendingHours: number;
  /** The engine's own data-quality marker for this row, when it set one. */
  flag?: string | null;
}

export interface OtPersonRow {
  personNo: string;
  name: string;
  functionName: string | null;
  cells: OtCell[];
  /** Payable hours per bucket (detected + acknowledged review, per `payableOtMin`). */
  rawNormal: number; rawOffday: number; rawHoliday: number; rawTotal: number;
  /** Rate-multiplied hours — what the Director's four total columns show. */
  paidNormal: number; paidOffday: number; paidHoliday: number; paidTotal: number;
  /** Transparency: what the engine detected, and what review has/has not released. */
  detectedTotal: number; reviewHours: number; pendingHours: number; pendingDays: number;
  /** Rows the engine flagged for review inside this month (never hidden). */
  flaggedDays: number;
}

export interface OtTrackerReport {
  month: string;                   // YYYY-MM
  monthLabel: string;              // e.g. "August 2026"
  daysInMonth: number;
  /** Per-day column headers with weekday, matching the template's date row. */
  days: { day: number; date: string; weekday: string; isWeekend: boolean }[];
  rates: typeof OT_RATES;
  base: typeof OT_BASE;
  people: OtPersonRow[];
  totals: {
    people: number;
    rawNormal: number; rawOffday: number; rawHoliday: number; rawTotal: number;
    paidNormal: number; paidOffday: number; paidHoliday: number; paidTotal: number;
    detectedTotal: number; reviewHours: number; pendingHours: number;
    flaggedDays: number; pendingDays: number;
  };
  /** Where every number came from — shown on the page, never implied. */
  provenance: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class OtTrackerService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Months that actually carry overtime, newest first — the picker never offers an empty month.
   *  The population MUST match `build()`'s (payable OT **or** hours held in review), otherwise the
   *  picker's people-count and the page's own tile disagree on the same screen. */
  async months(tenantId: string): Promise<{ month: string; label: string; people: number; rawHours: number }[]> {
    const rows = await this.ds.query(
      `WITH rv AS (
         SELECT person_no, work_date,
                SUM(minutes) FILTER (WHERE status IN ('acknowledged','pending')) AS rev_min,
                SUM(minutes) FILTER (WHERE status = 'acknowledged')              AS ack_min
           FROM ot_review_flags WHERE tenant_id = $1 GROUP BY person_no, work_date
       )
       SELECT to_char(rd.work_date, 'YYYY-MM')     AS month,
              to_char(rd.work_date, 'FMMonth YYYY') AS label,
              COUNT(DISTINCT rd.person_no)::int     AS people,
              SUM(COALESCE(rd.ot_min,0) + COALESCE(rd.offday_ot_min,0) + COALESCE(rd.holiday_ot_min,0)
                  + COALESCE(rv.ack_min,0)) / 60.0 AS raw_hours
         FROM roster_days rd
         LEFT JOIN rv ON rv.person_no = rd.person_no AND rv.work_date = rd.work_date
        WHERE rd.tenant_id = $1
          AND (COALESCE(rd.ot_min,0) + COALESCE(rd.offday_ot_min,0) + COALESCE(rd.holiday_ot_min,0)
               + COALESCE(rv.rev_min,0)) > 0
        GROUP BY 1, 2
        ORDER BY 1 DESC`,
      [tenantId],
    ).catch(() => []);
    return rows.map((r: any) => ({
      month: r.month, label: String(r.label).trim(), people: r.people, rawHours: r2(Number(r.raw_hours)),
    }));
  }

  async build(tenantId: string, month: string): Promise<OtTrackerReport> {
    // month is validated by the controller; anchor on the first of the month.
    const first = `${month}-01`;

    const [meta] = await this.ds.query(
      `SELECT EXTRACT(DAY FROM (date_trunc('month', $1::date) + INTERVAL '1 month - 1 day'))::int AS dim,
              to_char($1::date, 'FMMonth YYYY') AS label`,
      [first],
    );
    const daysInMonth: number = meta.dim;

    const days = await this.ds.query(
      `SELECT d::date::text AS date,
              EXTRACT(DAY FROM d)::int AS day,
              to_char(d, 'Dy') AS weekday,
              (EXTRACT(ISODOW FROM d) IN (5, 6)) AS is_weekend
         FROM generate_series($1::date, ($1::date + ($2::int - 1)), INTERVAL '1 day') d
        ORDER BY d`,
      [first, daysInMonth],
    );

    /* One row per person-day that actually carries overtime. The three buckets are
       disjoint, so a row contributes to exactly one type — and the CASE below
       makes that explicit rather than assuming it. */
    /* One row per person-day. `ack`/`pend` come from the before/after-shift REVIEW queue:
       only ACKNOWLEDGED minutes are payable (D-2026-07-11 #2) — this is the same
       `payableOtMin` definition the OT & Exceptions report uses, so the two never disagree.
       A day can qualify on review minutes ALONE (bucket 0 but an acknowledged flag), which is
       why the review join is a FULL OUTER-style union rather than a filter on the buckets. */
    const rows = await this.ds.query(
      `WITH rv AS (
         SELECT person_no, work_date,
                SUM(minutes) FILTER (WHERE status = 'acknowledged') AS ack_min,
                SUM(minutes) FILTER (WHERE status = 'pending')      AS pend_min
           FROM ot_review_flags
          WHERE tenant_id = $1
            AND work_date >= $2::date AND work_date < ($2::date + INTERVAL '1 month')
          GROUP BY person_no, work_date
       )
       SELECT rd.person_no,
              MAX(rd.clean_name)     AS name,
              MAX(rd.role_function)  AS function_name,
              EXTRACT(DAY FROM rd.work_date)::int AS day,
              SUM(COALESCE(rd.ot_min, 0))          AS ot_min,
              SUM(COALESCE(rd.offday_ot_min, 0))   AS offday_min,
              SUM(COALESCE(rd.holiday_ot_min, 0))  AS holiday_min,
              MAX(COALESCE(rv.ack_min, 0))         AS ack_min,
              MAX(COALESCE(rv.pend_min, 0))        AS pend_min,
              MAX(NULLIF(rd.data_quality, ''))     AS flag
         FROM roster_days rd
         LEFT JOIN rv ON rv.person_no = rd.person_no AND rv.work_date = rd.work_date
        WHERE rd.tenant_id = $1
          AND rd.work_date >= $2::date
          AND rd.work_date <  ($2::date + INTERVAL '1 month')
          AND (COALESCE(rd.ot_min,0) + COALESCE(rd.offday_ot_min,0) + COALESCE(rd.holiday_ot_min,0)
               + COALESCE(rv.ack_min,0) + COALESCE(rv.pend_min,0)) > 0
        GROUP BY rd.person_no, rd.work_date
        ORDER BY rd.person_no, rd.work_date`,
      [tenantId, first],
    ).catch(() => []);

    const byPerson = new Map<string, OtPersonRow>();
    for (const r of rows) {
      const key = String(r.person_no);
      let p = byPerson.get(key);
      if (!p) {
        p = {
          personNo: key, name: r.name ?? key, functionName: r.function_name ?? null,
          cells: [],
          rawNormal: 0, rawOffday: 0, rawHoliday: 0, rawTotal: 0,
          paidNormal: 0, paidOffday: 0, paidHoliday: 0, paidTotal: 0,
          detectedTotal: 0, reviewHours: 0, pendingHours: 0, pendingDays: 0,
          flaggedDays: 0,
        };
        byPerson.set(key, p);
      }

      const nMin = Number(r.ot_min), oMin = Number(r.offday_min), hMin = Number(r.holiday_min);
      const ack = Number(r.ack_min) || 0, pend = Number(r.pend_min) || 0;
      // Disjoint by rule — the bucket carrying the day's hours also carries its review minutes.
      const type: OtType = hMin > 0 ? 'H' : oMin > 0 ? 'O' : 'N';
      const detectedMin = hMin > 0 ? hMin : oMin > 0 ? oMin : nMin;
      const detected = r2(detectedMin / 60);
      // The ONE payable definition, shared with the OT & Exceptions report.
      const payMin = payableOtMin({ regularMin: nMin, offdayMin: oMin, holidayMin: hMin, ackReviewMin: ack });
      const hours = r2(payMin / 60);
      /* Held hours are counted BEFORE the payable skip: a day whose only overtime is
         still pending has nothing to pay, but it must not disappear from the sheet —
         that is precisely the day someone needs to look at. */
      if (pend > 0) { p.pendingHours += pend / 60; p.pendingDays++; }
      if (hours <= 0) continue;

      p.cells.push({
        day: Number(r.day), hours, type, detected,
        reviewHours: r2(ack / 60), pendingHours: r2(pend / 60), flag: r.flag ?? null,
      });
      if (r.flag) p.flaggedDays++;
      const bump = ack / 60;
      p.rawNormal += nMin / 60 + (type === 'N' ? bump : 0);
      p.rawOffday += oMin / 60 + (type === 'O' ? bump : 0);
      p.rawHoliday += hMin / 60 + (type === 'H' ? bump : 0);
      // Accumulate from exact minutes, never from the rounded cell — otherwise the running
      // total drifts above payable by a few hundredths per cell and reads like a discrepancy.
      p.detectedTotal += detectedMin / 60; p.reviewHours += bump;
    }

    const people = [...byPerson.values()].filter((p) => p.cells.length > 0 || p.pendingHours > 0).map((p) => {
      p.rawNormal = r2(p.rawNormal); p.rawOffday = r2(p.rawOffday); p.rawHoliday = r2(p.rawHoliday);
      p.detectedTotal = r2(p.detectedTotal); p.reviewHours = r2(p.reviewHours); p.pendingHours = r2(p.pendingHours);
      p.rawTotal = r2(p.rawNormal + p.rawOffday + p.rawHoliday);
      p.paidNormal = r2(p.rawNormal * OT_RATES.normal);
      p.paidOffday = r2(p.rawOffday * OT_RATES.offday);
      p.paidHoliday = r2(p.rawHoliday * OT_RATES.holiday);
      p.paidTotal = r2(p.paidNormal + p.paidOffday + p.paidHoliday);
      p.cells.sort((a, b) => a.day - b.day);
      return p;
    }).sort((a, b) => b.paidTotal - a.paidTotal || a.name.localeCompare(b.name));

    const sum = (f: (p: OtPersonRow) => number) => r2(people.reduce((s, p) => s + f(p), 0));

    return {
      month, monthLabel: String(meta.label).trim(), daysInMonth,
      days: days.map((d: any) => ({
        day: d.day, date: d.date, weekday: String(d.weekday).trim(), isWeekend: d.is_weekend,
      })),
      rates: OT_RATES, base: OT_BASE, people,
      totals: {
        people: people.length,
        rawNormal: sum((p) => p.rawNormal), rawOffday: sum((p) => p.rawOffday),
        rawHoliday: sum((p) => p.rawHoliday), rawTotal: sum((p) => p.rawTotal),
        paidNormal: sum((p) => p.paidNormal), paidOffday: sum((p) => p.paidOffday),
        paidHoliday: sum((p) => p.paidHoliday), paidTotal: sum((p) => p.paidTotal),
        detectedTotal: sum((p) => p.detectedTotal), reviewHours: sum((p) => p.reviewHours),
        pendingHours: sum((p) => p.pendingHours),
        flaggedDays: people.reduce((s, p) => s + p.flaggedDays, 0),
        pendingDays: people.reduce((s, p) => s + p.pendingDays, 0),
      },
      provenance:
        'roster_days — the reconciled per-person-per-day spine (Ameyo ∪ Sprinklr ∪ Odoo punch vs schedule). ' +
        'The three OT buckets are disjoint by rule (BR-OT-001), so nothing is double-counted. ' +
        'Hours are PAYABLE OT (`payableOtMin`, D-2026-07-11): the three buckets plus before/after-shift ' +
        'minutes that review has ACKNOWLEDGED — pending minutes are shown but never paid, and a worked ' +
        'OFF day stays non-payable until HR clarifies. ' +
        `Money hours = payable × rate (N ${OT_RATES.normal} · O ${OT_RATES.offday} · H ${OT_RATES.holiday}), ` +
        'rates taken from the Director\'s own tracker formulas and OV CALCULATION.xlsx. Read-only.',
    };
  }
}
