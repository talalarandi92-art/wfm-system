/**
 * YEAR-TO-DATE OVERTIME — every employee, every month, every day, from the
 * Director's OWN approved overtime workbooks (`ot_source_rows`, filled by
 * `scripts/ot-source-ingest.js` from `Desktop/Overtime 2026`).
 *
 * THE PROBLEM THIS SOLVES, stated plainly: those workbooks overlap by design.
 * One event file carries `Details` + `All New+ Old` + `New`; Ramadan carries
 * `FULL SYSTEM` + `Normal Days` + `Day OFF`; two End-Of-Year files nearly repeat
 * each other. Stacking every row gives 22,734 hours. The truth is 13,295 —
 * **a 9,439-hour (+71%) double count** that no amount of careful copy-paste
 * would have caught by eye.
 *
 * SO: one value per person-day, resolved HERE and not at ingest, by a rule that
 * is written down rather than implied —
 *   1. the same person-day appearing in several sheets is ONE day, not many;
 *   2. where the sheets AGREE (2,070 of 2,116 repeated days) the value is taken;
 *   3. where they DISAGREE (46 days) the LARGEST value is shown — never the
 *      smallest, because an employee must not lose hours to a bookkeeping
 *      artefact — and every such day is listed in `conflicts` with all its
 *      candidates and their source sheets, for the Director to rule on.
 *
 * Undated rows (Israa Wal Miraj gives no date column at all) are carried at
 * MONTH precision in a separate bucket. A day is never invented for them.
 *
 * READ-ONLY.
 */
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface OtYearDay { date: string; hours: number; occasion: string; shiftCode: string | null; conflict: boolean }

export interface OtYearPerson {
  personNo: string;
  name: string;
  functionName: string | null;
  /** 12 slots, index 0 = January. Hours from dated rows only. */
  months: number[];
  /** Hours the sources could only place in a month, keyed YYYY-MM. */
  undatedByMonth: Record<string, number>;
  undatedTotal: number;
  /** Dated + undated — the number the Director asked for. */
  total: number;
  days: OtYearDay[];
  daysCount: number;
  conflictDays: number;
  /** The same period measured by the platform's own engine, for comparison only. */
  engineHours: number;
}

export interface OtYearReport {
  year: number;
  monthLabels: string[];
  people: OtYearPerson[];
  totals: {
    people: number; total: number; dated: number; undated: number;
    months: number[]; engineHours: number; conflictDays: number; daysCount: number;
  };
  conflicts: {
    personNo: string; name: string; date: string; chosen: number;
    candidates: { hours: number; sheet: string; file: string }[];
  }[];
  sources: { file: string; occasion: string; rows: number; people: number; stackedHours: number; undated: number; flagged: number }[];
  dataQuality: { personNo: string; name: string; date: string | null; note: string; file: string; sheet: string }[];
  /** Hours if someone stacked the sheets, vs the truth — the headline of this page. */
  dedup: { stacked: number; deduped: number; avoided: number; personDays: number; agreed: number; disagreed: number };
  ingestedAt: string | null;
  provenance: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

@Injectable()
export class OtYearService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Years present in the ledger, newest first. */
  async years(tenantId: string): Promise<number[]> {
    const rows = await this.ds.query(
      `SELECT DISTINCT LEFT(period_month, 4)::int AS y FROM ot_source_rows WHERE tenant_id = $1 ORDER BY y DESC`,
      [tenantId],
    ).catch(() => []);
    return rows.map((r: any) => r.y);
  }

  async build(tenantId: string, year: number): Promise<OtYearReport> {
    const from = `${year}-01-01`, to = `${year}-12-31`;

    /* Every ledger row for the year, dated or not. Deduplication happens below in
       code rather than in SQL so the losing candidates survive into `conflicts`. */
    const raw = await this.ds.query(
      `SELECT person_no, employee_name, work_date::text AS work_date, date_precision, period_month,
              hours::float AS hours, shift_code, occasion, source_file, source_sheet, data_quality
         FROM ot_source_rows
        WHERE tenant_id = $1 AND LEFT(period_month, 4) = $2
        ORDER BY person_no, work_date NULLS LAST, hours DESC`,
      [tenantId, String(year)],
    ).catch(() => []);

    // Function + a canonical display name come from the roster spine, not the workbooks,
    // so a person is labelled the same way here as everywhere else in the platform.
    const idents = await this.ds.query(
      `SELECT rd.person_no, MAX(rd.clean_name) AS name, MAX(rd.role_function) AS fn,
              SUM(COALESCE(rd.ot_min,0) + COALESCE(rd.offday_ot_min,0) + COALESCE(rd.holiday_ot_min,0)) / 60.0 AS engine_hours
         FROM roster_days rd
        WHERE rd.tenant_id = $1 AND rd.work_date BETWEEN $2::date AND $3::date
        GROUP BY rd.person_no`,
      [tenantId, from, to],
    ).catch(() => []);
    const ident = new Map<string, { name: string; fn: string | null; engine: number }>();
    for (const i of idents) ident.set(String(i.person_no), { name: i.name, fn: i.fn ?? null, engine: Number(i.engine_hours) || 0 });

    /* ── group by person-day (or person-month for undated rows) ───────────── */
    type Cand = { hours: number; sheet: string; file: string; occasion: string; shift: string | null };
    const groups = new Map<string, { personNo: string; name: string; date: string | null; month: string; cands: Cand[] }>();
    const sources = new Map<string, { file: string; occasion: string; rows: number; people: Set<string>; hours: number; undated: number; flagged: number }>();
    const dataQuality: OtYearReport['dataQuality'] = [];

    for (const r of raw) {
      const personNo = String(r.person_no);
      const key = `${personNo}|${r.work_date || r.period_month}`;
      let g = groups.get(key);
      if (!g) { g = { personNo, name: r.employee_name || personNo, date: r.work_date, month: r.period_month, cands: [] }; groups.set(key, g); }
      g.cands.push({ hours: Number(r.hours), sheet: r.source_sheet, file: r.source_file, occasion: r.occasion, shift: r.shift_code });

      let s = sources.get(r.source_file);
      if (!s) { s = { file: r.source_file, occasion: r.occasion, rows: 0, people: new Set(), hours: 0, undated: 0, flagged: 0 }; sources.set(r.source_file, s); }
      s.rows++; s.people.add(personNo); s.hours += Number(r.hours);
      if (r.date_precision === 'month') s.undated++;
      if (r.data_quality) {
        s.flagged++;
        dataQuality.push({ personNo, name: r.employee_name || personNo, date: r.work_date, note: r.data_quality, file: r.source_file, sheet: r.source_sheet });
      }
    }

    /* ── resolve each group to ONE value, keeping the losers for review ───── */
    const byPerson = new Map<string, OtYearPerson>();
    const conflicts: OtYearReport['conflicts'] = [];
    let stacked = 0, deduped = 0, agreed = 0, disagreed = 0;

    for (const g of groups.values()) {
      const distinct = new Set(g.cands.map((c) => Math.round(c.hours * 100)));
      const chosen = Math.max(...g.cands.map((c) => c.hours));
      const isConflict = distinct.size > 1;
      if (g.cands.length > 1) (isConflict ? disagreed++ : agreed++);
      stacked += g.cands.reduce((a, c) => a + c.hours, 0);
      deduped += chosen;

      const id = ident.get(g.personNo);
      let p = byPerson.get(g.personNo);
      if (!p) {
        p = {
          personNo: g.personNo, name: id?.name || g.name, functionName: id?.fn ?? null,
          months: Array(12).fill(0), undatedByMonth: {}, undatedTotal: 0, total: 0,
          days: [], daysCount: 0, conflictDays: 0, engineHours: r2(id?.engine || 0),
        };
        byPerson.set(g.personNo, p);
      }

      if (g.date) {
        const mi = Number(g.date.slice(5, 7)) - 1;
        p.months[mi] += chosen;
        const win = g.cands.find((c) => Math.abs(c.hours - chosen) < 1e-9)!;
        p.days.push({ date: g.date, hours: r2(chosen), occasion: win.occasion, shiftCode: win.shift, conflict: isConflict });
      } else {
        p.undatedByMonth[g.month] = r2((p.undatedByMonth[g.month] || 0) + chosen);
        p.undatedTotal += chosen;
      }
      if (isConflict) {
        p.conflictDays++;
        conflicts.push({
          personNo: g.personNo, name: p.name, date: g.date || `${g.month} (undated)`, chosen: r2(chosen),
          candidates: g.cands.map((c) => ({ hours: r2(c.hours), sheet: c.sheet, file: c.file }))
            .sort((a, b) => b.hours - a.hours),
        });
      }
    }

    const people = [...byPerson.values()].map((p) => {
      p.months = p.months.map(r2);
      p.undatedTotal = r2(p.undatedTotal);
      p.total = r2(p.months.reduce((a, b) => a + b, 0) + p.undatedTotal);
      p.days.sort((a, b) => a.date.localeCompare(b.date));
      p.daysCount = p.days.length;
      return p;
    }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    const monthTotals = Array(12).fill(0);
    for (const p of people) p.months.forEach((h, i) => { monthTotals[i] += h; });

    const [ing] = await this.ds.query(
      `SELECT MAX(ingested_at)::text AS at FROM ot_source_rows WHERE tenant_id = $1`, [tenantId],
    ).catch(() => [{ at: null }]);

    return {
      year,
      monthLabels: MONTHS,
      people,
      totals: {
        people: people.length,
        total: r2(people.reduce((a, p) => a + p.total, 0)),
        dated: r2(monthTotals.reduce((a, b) => a + b, 0)),
        undated: r2(people.reduce((a, p) => a + p.undatedTotal, 0)),
        months: monthTotals.map(r2),
        engineHours: r2(people.reduce((a, p) => a + p.engineHours, 0)),
        conflictDays: conflicts.length,
        daysCount: people.reduce((a, p) => a + p.daysCount, 0),
      },
      conflicts: conflicts.sort((a, b) =>
        Math.max(...b.candidates.map((c) => c.hours)) - Math.min(...b.candidates.map((c) => c.hours)) -
        (Math.max(...a.candidates.map((c) => c.hours)) - Math.min(...a.candidates.map((c) => c.hours)))),
      sources: [...sources.values()]
        .map((s) => ({ file: s.file, occasion: s.occasion, rows: s.rows, people: s.people.size, stackedHours: r2(s.hours), undated: s.undated, flagged: s.flagged }))
        .sort((a, b) => b.stackedHours - a.stackedHours),
      dataQuality,
      dedup: { stacked: r2(stacked), deduped: r2(deduped), avoided: r2(stacked - deduped), personDays: groups.size, agreed, disagreed },
      ingestedAt: ing?.at ?? null,
      provenance:
        'The Director\'s own overtime workbooks (Desktop/Overtime 2026), ingested row-by-row into ot_source_rows ' +
        'with file/sheet/row provenance. The sheets overlap deliberately, so ONE value per person-day is resolved at ' +
        'read time: where sheets agree the value is taken; where they disagree the largest is shown and the day is ' +
        'listed under Conflicts with every candidate. Rows whose workbook gives no date are carried at month ' +
        'precision — a day is never invented. The engine column is the platform\'s own measurement over roster_days, ' +
        'shown for comparison only; it is a different thing (detection, not approval) and the two are not expected to match.',
    };
  }
}
