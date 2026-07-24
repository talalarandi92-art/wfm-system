import * as fs from 'fs';
import * as path from 'path';
import { OtYearService } from './ot-year.service';

/**
 * Year-to-date overtime — the dedup rule is the whole point of this service, so it
 * is pinned here. The Director's workbooks overlap deliberately (Details + All New+
 * Old + New; FULL SYSTEM + Normal Days + Day OFF; two End-Of-Year files); stacking
 * their rows over-counts the real year by ~8,940 hours. These tests assert that a
 * repeated person-day collapses to ONE value, that a contested day is never resolved
 * silently, and that a day is never invented for an undated source row.
 */
describe('OT year-to-date', () => {
  const src = fs.readFileSync(path.join(__dirname, 'ot-year.service.ts'), 'utf8');

  const build = async (rows: any[], engine: any[] = []) => {
    const ds: any = {
      query: (sql: string) => {
        if (sql.includes('FROM ot_source_rows') && sql.includes('DISTINCT')) return Promise.resolve([{ y: 2026 }]);
        if (sql.includes('MAX(ingested_at)')) return Promise.resolve([{ at: '2026-07-24T10:00:00Z' }]);
        if (sql.includes('FROM ot_source_rows')) return Promise.resolve(rows);
        if (sql.includes('FROM roster_days')) return Promise.resolve(engine);
        return Promise.resolve([]);
      },
    };
    return new OtYearService(ds).build('t1', 2026);
  };
  const row = (o: Partial<Record<string, any>>) => ({
    person_no: '13019', employee_name: 'Moatazz Fayed', work_date: '2026-03-05', date_precision: 'day',
    period_month: '2026-03', hours: 7, shift_code: 'M', occasion: 'Ramadan 26', source_file: 'Ramadan.xlsx',
    source_sheet: 'FULL SYSTEM', data_quality: null, ...o,
  });

  describe('the ledger is read, never mutated', () => {
    it('reads ot_source_rows and writes nothing', () => {
      expect(src).toContain('FROM ot_source_rows');
      expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s+(INTO\s+)?[a-z_]+/i);
    });
    it('deduplicates in code, not in SQL — the losing candidates must survive for review', () => {
      expect(src).not.toMatch(/SELECT[^;]*MAX\(hours\)[^;]*GROUP BY[^;]*person_no/is);
      expect(src).toContain('conflicts');
    });
  });

  describe('one value per person-day', () => {
    it('the same day repeated across sheets counts ONCE', async () => {
      const r = await build([
        row({ source_sheet: 'FULL SYSTEM' }), row({ source_sheet: 'Normal Days OV Details' }), row({ source_sheet: 'Day OFF OV Details' }),
      ]);
      expect(r.totals.total).toBe(7);              // not 21
      expect(r.dedup.stacked).toBe(21);
      expect(r.dedup.avoided).toBe(14);
      expect(r.dedup.personDays).toBe(1);
      expect(r.dedup.agreed).toBe(1);
      expect(r.dedup.disagreed).toBe(0);
      expect(r.conflicts).toEqual([]);             // agreement is not a conflict
      expect(r.people[0].days).toHaveLength(1);
    });

    it('when the sheets DISAGREE the largest is shown and the day is reported, not silently resolved', async () => {
      const r = await build([
        row({ hours: 2, source_sheet: 'Normal Days OV Details' }),
        row({ hours: 9, source_sheet: 'Day OFF OV Details' }),
      ]);
      expect(r.totals.total).toBe(9);              // never the smaller — a bookkeeping artefact must not cost hours
      expect(r.dedup.disagreed).toBe(1);
      expect(r.conflicts).toHaveLength(1);
      expect(r.conflicts[0].chosen).toBe(9);
      expect(r.conflicts[0].candidates.map((c) => c.hours)).toEqual([9, 2]);   // every candidate kept
      expect(r.people[0].conflictDays).toBe(1);
      expect(r.people[0].days[0].conflict).toBe(true);
    });

    it('different days of the same person both count', async () => {
      const r = await build([row({ work_date: '2026-03-05', hours: 7 }), row({ work_date: '2026-03-06', hours: 3 })]);
      expect(r.totals.total).toBe(10);
      expect(r.people[0].daysCount).toBe(2);
      expect(r.people[0].months[2]).toBe(10);      // March
    });
  });

  describe('months and totals', () => {
    it('hours land in the month of their date', async () => {
      const r = await build([
        row({ work_date: '2026-01-04', period_month: '2026-01', hours: 8 }),
        row({ work_date: '2026-05-24', period_month: '2026-05', hours: 11 }),
      ]);
      const p = r.people[0];
      expect(p.months[0]).toBe(8);
      expect(p.months[4]).toBe(11);
      expect(p.months.filter((x) => x > 0)).toHaveLength(2);
      expect(p.total).toBe(19);
    });

    it('grand totals equal the sum of the employee rows', async () => {
      const r = await build([
        row({ person_no: '1', employee_name: 'A', hours: 5 }),
        row({ person_no: '2', employee_name: 'B', hours: 6, work_date: '2026-04-02', period_month: '2026-04' }),
      ]);
      expect(r.totals.people).toBe(2);
      expect(r.totals.total).toBe(11);
      expect(r.totals.total).toBeCloseTo(r.people.reduce((a, p) => a + p.total, 0), 2);
      expect(r.totals.months.reduce((a, b) => a + b, 0)).toBeCloseTo(r.totals.dated, 2);
    });
  });

  describe('a date the file never stated', () => {
    /* `Israa Wal Miraj Jan CC Overtime 2026` gives no date column. The ingester resolves it
       from the file's own weekday header plus the roster's holiday evidence and marks it
       'derived'. Here: a derived date behaves as a real day, but must never be passed off
       as one the workbook stated. */
    it('a derived date lands on its day, is marked, and is reported separately from defects', async () => {
      const r = await build([
        row({ work_date: '2026-01-18', date_precision: 'derived', period_month: '2026-01', hours: 8,
              occasion: 'Israa Wal Miraj Jan 2026', source_file: 'Israa.xlsx',
              data_quality: 'date derived from evidence: it names weekday "Sun" …' }),
      ]);
      const p = r.people[0];
      expect(p.months[0]).toBe(8);                 // counted in January like any other day
      expect(p.days[0].derived).toBe(true);        // …but flagged as resolved, not stated
      expect(r.totals.undated).toBe(0);
      expect(r.derivedDates).toHaveLength(1);
      expect(r.derivedDates[0]).toMatchObject({ date: '2026-01-18', rows: 1, hours: 8 });
      expect(r.derivedDates[0].why).toContain('derived');
      // provenance, not a defect — it must not pollute the data-quality list
      expect(r.dataQuality).toEqual([]);
    });

    it('several derived rows on one day roll up to a single entry', async () => {
      const rows = Array.from({ length: 5 }, (_, i) => row({
        person_no: String(100 + i), employee_name: `P${i}`, work_date: '2026-01-18',
        date_precision: 'derived', period_month: '2026-01', hours: 8,
        source_file: 'Israa.xlsx', data_quality: 'date derived from evidence …',
      }));
      const r = await build(rows);
      expect(r.derivedDates).toHaveLength(1);
      expect(r.derivedDates[0].rows).toBe(5);
      expect(r.derivedDates[0].hours).toBe(40);
      expect(r.totals.total).toBe(40);
    });
  });

  describe('a day is never invented', () => {
    it('undated rows are carried at MONTH level and kept out of the day grid', async () => {
      const r = await build([row({ work_date: null, date_precision: 'month', period_month: '2026-01', hours: 8 })]);
      const p = r.people[0];
      expect(p.days).toEqual([]);                  // no day fabricated
      expect(p.undatedTotal).toBe(8);
      expect(p.undatedByMonth['2026-01']).toBe(8);
      expect(p.months.every((x) => x === 0)).toBe(true);
      expect(p.total).toBe(8);                     // …but the hours still count toward the year
      expect(r.totals.undated).toBe(8);
      expect(r.totals.dated).toBe(0);
    });
  });

  describe('identity and comparison come from the roster spine', () => {
    it('name and function are taken from roster_days, and the engine figure is carried separately', async () => {
      const r = await build(
        [row({ employee_name: 'moatazz f' })],
        [{ person_no: '13019', name: 'Moatazz Fayed', fn: 'CH - WA', engine_hours: 303 }],
      );
      expect(r.people[0].name).toBe('Moatazz Fayed');
      expect(r.people[0].functionName).toBe('CH - WA');
      expect(r.people[0].engineHours).toBe(303);
      expect(r.people[0].total).toBe(7);           // the engine figure never alters the sheet total
    });
  });

  describe('provenance', () => {
    it('reports which workbook contributed what, and surfaces the files\' own quality notes', async () => {
      const r = await build([
        row({ source_file: 'Ramadan.xlsx', data_quality: 'day-name-mismatch: file says Wed, 2026-03-05 is Thursday' }),
        row({ person_no: '2', employee_name: 'B', source_file: 'Eid.xlsx', source_sheet: 'Details', work_date: '2026-03-21', period_month: '2026-03', hours: 8 }),
      ]);
      expect(r.sources.map((s) => s.file).sort()).toEqual(['Eid.xlsx', 'Ramadan.xlsx']);
      expect(r.dataQuality).toHaveLength(1);
      expect(r.dataQuality[0].note).toContain('day-name-mismatch');
      expect(r.ingestedAt).toBeTruthy();
    });
  });
});
