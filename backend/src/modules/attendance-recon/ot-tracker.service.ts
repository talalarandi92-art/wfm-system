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

/**
 * DISPLAY ROUNDING (Director 2026-07-24: "بدي أرقام ثابتة ما بدي 2.2 وهيك").
 *
 * The engine measures to the minute, which produces cells like 2.03 / 4.07 / 12.65 —
 * unreadable on a sheet meant to be scanned. His own workbooks are already quantised:
 * of 1,541 hand-entered OV values, 1,380 are whole hours and 161 are half hours, and
 * NOT ONE is finer. So the step is his own, not invented: **nearest half hour**.
 *
 * NEAREST, never floor — rounding down would quietly shave minutes off people every
 * single day. And the cells are rounded FIRST, with the totals summed from the rounded
 * cells, so the sheet visibly adds up; a sheet whose columns don't reconcile with its
 * own cells is worse than one with ugly decimals.
 */
export const OT_ROUNDING = { stepHours: 0.5, mode: 'nearest' as const };
export const roundHours = (h: number): number => {
  const s = OT_ROUNDING.stepHours;
  return Math.round((Math.round(h / s) * s) * 100) / 100;
};

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
  /** 1 Jan of this year → the end of this month, same payable definition. */
  ytdHours: number; ytdPaid: number; ytdDays: number;
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
    ytdHours: number; ytdPaid: number; ytdDays: number;
    /** Days too short to survive the rounding step — reported, not silently dropped. */
    roundedOutDays: number; roundedOutHours: number;
  };
  /** How the cells were rounded — stated on the page, never silent. */
  rounding: { stepHours: number; mode: string };
  /** The window the YTD columns cover. */
  ytdFrom: string;
  /** Where every number came from — shown on the page, never implied. */
  provenance: string;
}

/** The whole year as ONE day grid — the monthly tracker × 12, same cells, same rules. */
export interface OtYearGridDay { date: string; day: number; month: number; weekday: string; isWeekend: boolean }
export interface OtYearGridPerson {
  personNo: string; name: string; functionName: string | null;
  /** keyed by ISO date — sparse, only days that carry payable overtime */
  cells: Record<string, { hours: number; type: OtType; pendingHours: number; flag?: string | null }>;
  /** 12 slots, index 0 = January */
  monthHours: number[];
  rawNormal: number; rawOffday: number; rawHoliday: number; rawTotal: number;
  paidNormal: number; paidOffday: number; paidHoliday: number; paidTotal: number;
  days: number; pendingHours: number;
}
export interface OtYearGrid {
  year: number;
  days: OtYearGridDay[];
  monthLabels: string[];
  people: OtYearGridPerson[];
  rates: typeof OT_RATES;
  base: typeof OT_BASE;
  rounding: { stepHours: number; mode: string };
  totals: {
    people: number; monthHours: number[];
    rawNormal: number; rawOffday: number; rawHoliday: number; rawTotal: number;
    paidNormal: number; paidOffday: number; paidHoliday: number; paidTotal: number;
    days: number; pendingHours: number; roundedOutDays: number; roundedOutHours: number;
  };
  provenance: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

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

  /**
   * THE WHOLE YEAR IN ONE GRID — every employee down, all 365 days across.
   *
   * Deliberately the same engine, cells and rounding as the monthly tracker, just
   * over twelve months instead of one: the same day in the January sheet and in
   * this grid must read identically, or the two sheets start arguing. Sparse by
   * design — a person-day with no payable overtime has no cell at all.
   */
  async buildYearGrid(tenantId: string, year: number): Promise<OtYearGrid> {
    const from = `${year}-01-01`, to = `${year}-12-31`;

    const days: OtYearGridDay[] = (await this.ds.query(
      `SELECT d::date::text AS date, EXTRACT(DAY FROM d)::int AS day,
              EXTRACT(MONTH FROM d)::int AS month, to_char(d, 'Dy') AS weekday,
              (EXTRACT(ISODOW FROM d) IN (5, 6)) AS is_weekend
         FROM generate_series($1::date, $2::date, INTERVAL '1 day') d ORDER BY d`,
      [from, to],
    )).map((r: any) => ({ date: r.date, day: r.day, month: r.month, weekday: String(r.weekday).trim(), isWeekend: r.is_weekend }));

    const rows = await this.ds.query(
      `WITH rv AS (
         SELECT person_no, work_date,
                SUM(minutes) FILTER (WHERE status = 'acknowledged') AS ack_min,
                SUM(minutes) FILTER (WHERE status = 'pending')      AS pend_min
           FROM ot_review_flags
          WHERE tenant_id = $1 AND work_date BETWEEN $2::date AND $3::date
          GROUP BY person_no, work_date
       )
       SELECT rd.person_no, rd.work_date::text AS work_date,
              MAX(rd.clean_name)     AS name,
              MAX(rd.role_function)  AS function_name,
              SUM(COALESCE(rd.ot_min, 0))          AS ot_min,
              SUM(COALESCE(rd.offday_ot_min, 0))   AS offday_min,
              SUM(COALESCE(rd.holiday_ot_min, 0))  AS holiday_min,
              MAX(COALESCE(rv.ack_min, 0))         AS ack_min,
              MAX(COALESCE(rv.pend_min, 0))        AS pend_min,
              MAX(NULLIF(rd.data_quality, ''))     AS flag
         FROM roster_days rd
         LEFT JOIN rv ON rv.person_no = rd.person_no AND rv.work_date = rd.work_date
        WHERE rd.tenant_id = $1 AND rd.work_date BETWEEN $2::date AND $3::date
          AND (COALESCE(rd.ot_min,0) + COALESCE(rd.offday_ot_min,0) + COALESCE(rd.holiday_ot_min,0)
               + COALESCE(rv.ack_min,0)) > 0
        GROUP BY rd.person_no, rd.work_date
        ORDER BY rd.person_no, rd.work_date`,
      [tenantId, from, to],
    ).catch(() => []);

    const byPerson = new Map<string, OtYearGridPerson>();
    let roundedOutDays = 0, roundedOutMin = 0;
    for (const r of rows) {
      const key = String(r.person_no);
      let p = byPerson.get(key);
      if (!p) {
        p = {
          personNo: key, name: r.name ?? key, functionName: r.function_name ?? null,
          cells: {}, monthHours: Array(12).fill(0),
          rawNormal: 0, rawOffday: 0, rawHoliday: 0, rawTotal: 0,
          paidNormal: 0, paidOffday: 0, paidHoliday: 0, paidTotal: 0,
          days: 0, pendingHours: 0,
        };
        byPerson.set(key, p);
      }
      const nMin = Number(r.ot_min), oMin = Number(r.offday_min), hMin = Number(r.holiday_min);
      const ack = Number(r.ack_min) || 0, pend = Number(r.pend_min) || 0;
      const type: OtType = hMin > 0 ? 'H' : oMin > 0 ? 'O' : 'N';
      const payMin = payableOtMin({ regularMin: nMin, offdayMin: oMin, holidayMin: hMin, ackReviewMin: ack });
      const hours = roundHours(payMin / 60);
      if (pend > 0) p.pendingHours += pend / 60;
      if (hours <= 0) { if (payMin > 0) { roundedOutDays++; roundedOutMin += payMin; } continue; }

      p.cells[r.work_date] = { hours, type, pendingHours: r2(pend / 60), flag: r.flag ?? null };
      p.monthHours[Number(r.work_date.slice(5, 7)) - 1] += hours;
      if (type === 'N') p.rawNormal += hours; else if (type === 'O') p.rawOffday += hours; else p.rawHoliday += hours;
      p.days++;
    }

    /* Same rule as the monthly sheet: a person stays only if they have a payable day
       or hours held in review. A row that rounded away to nothing must not sit there
       as 365 empty columns. */
    const people = [...byPerson.values()].filter((p) => p.days > 0 || p.pendingHours > 0).map((p) => {
      p.monthHours = p.monthHours.map(r2);
      p.rawNormal = r2(p.rawNormal); p.rawOffday = r2(p.rawOffday); p.rawHoliday = r2(p.rawHoliday);
      p.rawTotal = r2(p.rawNormal + p.rawOffday + p.rawHoliday);
      p.paidNormal = r2(p.rawNormal * OT_RATES.normal);
      p.paidOffday = r2(p.rawOffday * OT_RATES.offday);
      p.paidHoliday = r2(p.rawHoliday * OT_RATES.holiday);
      p.paidTotal = r2(p.paidNormal + p.paidOffday + p.paidHoliday);
      p.pendingHours = r2(p.pendingHours);
      return p;
    }).sort((a, b) => b.rawTotal - a.rawTotal || a.name.localeCompare(b.name));

    const sum = (f: (p: OtYearGridPerson) => number) => r2(people.reduce((s, p) => s + f(p), 0));
    const monthHours = Array(12).fill(0);
    for (const p of people) p.monthHours.forEach((h, i) => { monthHours[i] += h; });

    return {
      year, days, monthLabels: MONTH_NAMES, people,
      rates: OT_RATES, base: OT_BASE, rounding: { stepHours: OT_ROUNDING.stepHours, mode: OT_ROUNDING.mode },
      totals: {
        people: people.length, monthHours: monthHours.map(r2),
        rawNormal: sum((p) => p.rawNormal), rawOffday: sum((p) => p.rawOffday),
        rawHoliday: sum((p) => p.rawHoliday), rawTotal: sum((p) => p.rawTotal),
        paidNormal: sum((p) => p.paidNormal), paidOffday: sum((p) => p.paidOffday),
        paidHoliday: sum((p) => p.paidHoliday), paidTotal: sum((p) => p.paidTotal),
        days: people.reduce((s, p) => s + p.days, 0), pendingHours: sum((p) => p.pendingHours),
        roundedOutDays, roundedOutHours: r2(roundedOutMin / 60),
      },
      provenance:
        `Every day of ${year} from roster_days, on exactly the same rules as the monthly tracker: ` +
        'payable OT (three disjoint buckets + acknowledged review minutes only), each day rounded to the ' +
        `nearest ${OT_ROUNDING.stepHours} h, totals summed from the rounded days. A day with no payable ` +
        'overtime has no cell. Read-only.',
    };
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
    let roundedOutDays = 0, roundedOutMin = 0;
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
          ytdHours: 0, ytdPaid: 0, ytdDays: 0,
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
      const hours = roundHours(payMin / 60);
      /* Held hours are counted BEFORE the payable skip: a day whose only overtime is
         still pending has nothing to pay, but it must not disappear from the sheet —
         that is precisely the day someone needs to look at. */
      if (pend > 0) { p.pendingHours += pend / 60; p.pendingDays++; }
      /* A day under a quarter hour rounds to zero and leaves the sheet. That is the
         cost of readable numbers — so it is COUNTED and reported, never just dropped. */
      if (hours <= 0) { if (payMin > 0) { roundedOutDays++; roundedOutMin += payMin; } continue; }

      p.cells.push({
        day: Number(r.day), hours, type, detected: roundHours(detected),
        reviewHours: roundHours(ack / 60), pendingHours: roundHours(pend / 60), flag: r.flag ?? null,
      });
      if (r.flag) p.flaggedDays++;
      /* The bucket totals are summed from the ROUNDED cells, not from the raw minutes,
         so the four total columns always reconcile with the cells a reader can see.
         The three buckets are disjoint, so a day belongs wholly to its own type. */
      if (type === 'N') p.rawNormal += hours;
      else if (type === 'O') p.rawOffday += hours;
      else p.rawHoliday += hours;
      p.detectedTotal += detectedMin / 60; p.reviewHours += ack / 60;
    }

    /* ── YEAR TO DATE: 1 January → the end of this month, per person.
       Same payable definition and the SAME per-day rounding as the cells above, so a
       reader can add up twelve monthly sheets and land on this number. Computed here
       rather than by summing the months, because a month the user has not opened must
       still be included. */
    const ytdRows = await this.ds.query(
      `WITH rv AS (
         SELECT person_no, work_date, SUM(minutes) FILTER (WHERE status = 'acknowledged') AS ack_min
           FROM ot_review_flags
          WHERE tenant_id = $1 AND work_date >= $2::date AND work_date < ($3::date + INTERVAL '1 month')
          GROUP BY person_no, work_date
       )
       SELECT rd.person_no,
              SUM(COALESCE(rd.ot_min,0))         AS n_min,
              SUM(COALESCE(rd.offday_ot_min,0))  AS o_min,
              SUM(COALESCE(rd.holiday_ot_min,0)) AS h_min,
              MAX(COALESCE(rv.ack_min, 0))       AS ack_min
         FROM roster_days rd
         LEFT JOIN rv ON rv.person_no = rd.person_no AND rv.work_date = rd.work_date
        WHERE rd.tenant_id = $1
          AND rd.work_date >= $2::date AND rd.work_date < ($3::date + INTERVAL '1 month')
        GROUP BY rd.person_no, rd.work_date
       HAVING (SUM(COALESCE(rd.ot_min,0)) + SUM(COALESCE(rd.offday_ot_min,0))
               + SUM(COALESCE(rd.holiday_ot_min,0)) + MAX(COALESCE(rv.ack_min,0))) > 0`,
      [tenantId, `${month.slice(0, 4)}-01-01`, first],
    ).catch(() => []);
    const ytd = new Map<string, { hours: number; paid: number; days: number }>();
    for (const r of ytdRows) {
      const nM = Number(r.n_min), oM = Number(r.o_min), hM = Number(r.h_min), ack = Number(r.ack_min) || 0;
      // round each DAY then accumulate — identical treatment to the grid, so the figures agree
      const hrs = roundHours(payableOtMin({ regularMin: nM, offdayMin: oM, holidayMin: hM, ackReviewMin: ack }) / 60);
      if (hrs <= 0) continue;
      const rate = hM > 0 ? OT_RATES.holiday : oM > 0 ? OT_RATES.offday : OT_RATES.normal;
      const key = String(r.person_no);
      const cur = ytd.get(key) || { hours: 0, paid: 0, days: 0 };
      cur.hours += hrs; cur.paid += hrs * rate; cur.days++;
      ytd.set(key, cur);
    }

    const people = [...byPerson.values()].filter((p) => p.cells.length > 0 || p.pendingHours > 0).map((p) => {
      p.rawNormal = r2(p.rawNormal); p.rawOffday = r2(p.rawOffday); p.rawHoliday = r2(p.rawHoliday);
      p.detectedTotal = r2(p.detectedTotal); p.reviewHours = r2(p.reviewHours); p.pendingHours = r2(p.pendingHours);
      p.rawTotal = r2(p.rawNormal + p.rawOffday + p.rawHoliday);
      p.paidNormal = r2(p.rawNormal * OT_RATES.normal);
      p.paidOffday = r2(p.rawOffday * OT_RATES.offday);
      p.paidHoliday = r2(p.rawHoliday * OT_RATES.holiday);
      p.paidTotal = r2(p.paidNormal + p.paidOffday + p.paidHoliday);
      const y = ytd.get(p.personNo);
      p.ytdHours = r2(y?.hours || 0); p.ytdPaid = r2(y?.paid || 0); p.ytdDays = y?.days || 0;
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
        ytdHours: sum((p) => p.ytdHours), ytdPaid: sum((p) => p.ytdPaid),
        ytdDays: people.reduce((s, p) => s + p.ytdDays, 0),
        roundedOutDays, roundedOutHours: r2(roundedOutMin / 60),
      },
      rounding: { stepHours: OT_ROUNDING.stepHours, mode: OT_ROUNDING.mode },
      ytdFrom: `${month.slice(0, 4)}-01-01`,
      provenance:
        'roster_days — the reconciled per-person-per-day spine (Ameyo ∪ Sprinklr ∪ Odoo punch vs schedule). ' +
        'The three OT buckets are disjoint by rule (BR-OT-001), so nothing is double-counted. ' +
        'Hours are PAYABLE OT (`payableOtMin`, D-2026-07-11): the three buckets plus before/after-shift ' +
        'minutes that review has ACKNOWLEDGED — pending minutes are shown but never paid, and a worked ' +
        'OFF day stays non-payable until HR clarifies. ' +
        `Each day is rounded to the nearest ${OT_ROUNDING.stepHours} h (the granularity of the Director's own ` +
        'workbooks) and the totals are summed from those rounded days, so the sheet reconciles with its own cells. ' +
        `Money hours = payable × rate (N ${OT_RATES.normal} · O ${OT_RATES.offday} · H ${OT_RATES.holiday}), ` +
        'rates taken from the Director\'s own tracker formulas and OV CALCULATION.xlsx. Read-only.',
    };
  }
}
