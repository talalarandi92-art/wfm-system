import * as fs from 'fs';
import * as path from 'path';
import { OT_RATES, OT_BASE, OtTrackerService, OtPersonRow } from './ot-tracker.service';
import { payableOtMin } from '@common/ot-review';

/**
 * Monthly OT tracker — the invariants that make this sheet safe to hand to payroll.
 *
 * The rates and the hourly base are NOT ours to invent: they come from the Director's
 * own tracker formulas (`…*1.25`, `*1.5`, `*2`) and `OV CALCULATION.xlsx` (salary ÷ 26 ÷ 8).
 * Pinning them here means a change to a pay multiplier can only ever be deliberate.
 * DB-free: constants, the aggregation shape, and static source guards.
 */
describe('OT tracker', () => {
  const src = fs.readFileSync(path.join(__dirname, 'ot-tracker.service.ts'), 'utf8');

  describe('pay inputs are pinned to the Director\'s own files', () => {
    it('multipliers are N 1.25 / O 1.5 / H 2.0', () => {
      expect(OT_RATES).toEqual({ normal: 1.25, offday: 1.5, holiday: 2.0 });
    });
    it('hourly base is monthly salary / 26 days / 8 hours', () => {
      expect(OT_BASE).toEqual({ workDaysPerMonth: 26, hoursPerDay: 8 });
    });
  });

  describe('it reads the canonical spine and the ONE payable definition', () => {
    it('aggregates roster_days, never the thin legacy roster_daily', () => {
      expect(src).toContain('FROM roster_days');
      expect(src).not.toMatch(/\broster_daily\b/);
    });
    it('sums all THREE disjoint OT buckets (ot_min alone undercounts)', () => {
      for (const c of ['ot_min', 'offday_ot_min', 'holiday_ot_min']) expect(src).toContain(c);
    });
    it('uses payableOtMin rather than re-deriving payable OT locally', () => {
      expect(src).toContain('payableOtMin');
    });
    it('only ACKNOWLEDGED review minutes can become payable; pending is carried separately', () => {
      expect(src).toContain(`FILTER (WHERE status = 'acknowledged')`);
      expect(src).toContain(`FILTER (WHERE status = 'pending')`);
      // pending must never be fed into the payable computation — checked at EVERY call site,
      // so a second grid (the full-year one) cannot quietly adopt a different rule
      const calls = [...src.matchAll(/payableOtMin\(\{[^}]*\}\)/g)].map((m) => m[0]);
      expect(calls.length).toBeGreaterThanOrEqual(2);
      for (const call of calls) {
        expect(call).toContain('ackReviewMin: ack');
        expect(call).not.toContain('pend');
      }
    });
    it('is read-only — it never writes pay data', () => {
      expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s+(INTO\s+)?[a-z_]+/i);
    });
  });

  /* The cell/total arithmetic, exercised through the real service with a stubbed
   * DataSource — no database, but the actual production code path. */
  describe('per-person arithmetic', () => {
    const build = async (rows: any[]) => {
      const ds: any = {
        query: (sql: string) => {
          if (sql.includes('EXTRACT(DAY FROM (date_trunc'))
            return Promise.resolve([{ dim: 31, label: 'May 2026' }]);
          if (sql.includes('generate_series'))
            return Promise.resolve([{ date: '2026-05-01', day: 1, weekday: 'Fri', is_weekend: true }]);
          return Promise.resolve(rows);
        },
      };
      return new OtTrackerService(ds).build('t1', '2026-05');
    };
    const row = (o: Partial<Record<string, any>>) => ({
      person_no: '13830', name: 'A', function_name: 'Inbound', day: 1,
      ot_min: 0, offday_min: 0, holiday_min: 0, ack_min: 0, pend_min: 0, flag: null, ...o,
    });

    it('money hours = payable hours x the bucket rate, per bucket', async () => {
      const r = await build([
        row({ day: 1, ot_min: 120 }), row({ day: 2, offday_min: 60 }), row({ day: 3, holiday_min: 180 }),
      ]);
      const p = r.people[0];
      expect([p.rawNormal, p.rawOffday, p.rawHoliday]).toEqual([2, 1, 3]);
      expect([p.paidNormal, p.paidOffday, p.paidHoliday]).toEqual([2.5, 1.5, 6]);
      expect(p.paidTotal).toBe(10);
      expect(r.totals.paidTotal).toBe(10);
    });

    it('an acknowledged review flag is added to the day\'s own bucket', async () => {
      const r = await build([row({ day: 1, holiday_min: 120, ack_min: 60 })]);
      const p = r.people[0];
      expect(p.cells[0]).toMatchObject({ type: 'H', detected: 2, reviewHours: 1, hours: 3 });
      expect(p.rawHoliday).toBe(3);
      expect(p.paidHoliday).toBe(6);           // 3h x 2.0
      expect(p.rawNormal).toBe(0);             // never leaks into another bucket
    });

    it('PENDING review minutes are shown but never paid', async () => {
      const r = await build([row({ day: 1, ot_min: 60, pend_min: 90 })]);
      const p = r.people[0];
      expect(p.cells[0]).toMatchObject({ hours: 1, pendingHours: 1.5 });
      expect(p.rawTotal).toBe(1);
      expect(p.paidTotal).toBe(1.25);
      expect(r.totals.pendingHours).toBe(1.5);
      expect(r.totals.pendingDays).toBe(1);
    });

    it('a day with ONLY pending minutes pays nothing, yet stays visible for review', async () => {
      const r = await build([row({ day: 1, pend_min: 120 })]);
      expect(r.totals.paidTotal).toBe(0);      // nothing payable
      expect(r.people).toHaveLength(1);        // …but the person is NOT hidden
      expect(r.people[0].cells).toEqual([]);   // no payable cell on the sheet
      expect(r.people[0].pendingHours).toBe(2);
      expect(r.totals.pendingHours).toBe(2);
      expect(r.totals.pendingDays).toBe(1);
    });

    it('the day type is the bucket that carries the hours (H > O > N)', async () => {
      const r = await build([row({ day: 1, holiday_min: 60 }), row({ day: 2, offday_min: 60 }), row({ day: 3, ot_min: 60 })]);
      expect(r.people[0].cells.map((c) => c.type)).toEqual(['H', 'O', 'N']);
    });

    /* Display rounding (Director 2026-07-24: "بدي أرقام ثابتة ما بدي 2.2 وهيك").
       The step is his own workbooks' granularity — half an hour — and it is applied to
       the DAY, with the totals summed from the rounded days, so the sheet visibly adds up. */
    it('every cell is a whole or half hour', async () => {
      const r = await build([
        row({ day: 1, ot_min: 122 }),   // 2.03 h → 2
        row({ day: 2, ot_min: 244 }),   // 4.07 h → 4
        row({ day: 3, ot_min: 759 }),   // 12.65 h → 12.5
        row({ day: 4, ot_min: 18 }),    // 0.3 h → 0.5
      ]);
      expect(r.people[0].cells.map((c) => c.hours)).toEqual([2, 4, 12.5, 0.5]);
      for (const c of r.people[0].cells) expect(c.hours * 2).toBe(Math.round(c.hours * 2));
      expect(r.rounding).toEqual({ stepHours: 0.5, mode: 'nearest' });
    });

    it('rounds to the NEAREST step — never down, which would shave minutes off people daily', async () => {
      const r = await build([row({ day: 1, ot_min: 40 })]);          // 0.667 h
      expect(r.people[0].cells[0].hours).toBe(0.5);                   // nearest, not floor(0)
      const up = await build([row({ day: 1, ot_min: 50 })]);          // 0.833 h
      expect(up.people[0].cells[0].hours).toBe(1);
    });

    it('the totals are summed from the ROUNDED cells, so the sheet reconciles with itself', async () => {
      const r = await build(Array.from({ length: 7 }, (_, i) => row({ day: i + 1, ot_min: 143 })));  // 2.383 h → 2.5
      const p = r.people[0];
      expect(p.cells.every((c) => c.hours === 2.5)).toBe(true);
      expect(p.rawTotal).toBe(17.5);                                  // 7 × 2.5 — what a reader adds up
      expect(p.rawNormal).toBe(17.5);
      expect(p.paidTotal).toBe(21.88);                                // 17.5 × 1.25
      // the exact measurement is still carried, unrounded, for anyone who needs it
      expect(p.detectedTotal).toBeCloseTo(16.68, 1);
    });

    it('carries a year-to-date figure alongside the month', async () => {
      const r = await build([row({ day: 1, ot_min: 120 })]);
      // the stub answers the YTD query with the same single row, so YTD ≥ the month
      expect(r.people[0]).toHaveProperty('ytdHours');
      expect(r.people[0]).toHaveProperty('ytdPaid');
      expect(r.totals).toHaveProperty('ytdHours');
      expect(r.ytdFrom).toBe('2026-01-01');
    });

    it('the engine flag on a person-day is surfaced, never dropped', async () => {
      const r = await build([row({ day: 1, ot_min: 60, flag: 'persistent-session-capped' })]);
      expect(r.people[0].cells[0].flag).toBe('persistent-session-capped');
      expect(r.people[0].flaggedDays).toBe(1);
      expect(r.totals.flaggedDays).toBe(1);
    });

    it('grand totals equal the sum of the person rows', async () => {
      const r = await build([
        row({ person_no: '1', day: 1, ot_min: 100 }), row({ person_no: '2', day: 1, offday_min: 200 }),
        row({ person_no: '2', day: 2, holiday_min: 300, ack_min: 30 }),
      ]);
      const s = (f: (p: OtPersonRow) => number) => Math.round(r.people.reduce((a, p) => a + f(p), 0) * 100) / 100;
      expect(r.totals.paidTotal).toBeCloseTo(s((p) => p.paidTotal), 2);
      expect(r.totals.rawTotal).toBeCloseTo(s((p) => p.rawTotal), 2);
      expect(r.totals.people).toBe(2);
    });

    /* The full-year grid must be the monthly tracker × 12, not a second opinion: same
       payable definition, same rounding, same cells. A year sheet that disagrees with
       the month sheet it was built from is worse than no year sheet. */
    describe('full-year grid', () => {
      const buildYear = async (rows: any[]) => {
        const ds: any = {
          query: (sql: string) => {
            if (sql.includes('generate_series'))
              return Promise.resolve([
                { date: '2026-01-01', day: 1, month: 1, weekday: 'Thu', is_weekend: false },
                { date: '2026-05-24', day: 24, month: 5, weekday: 'Sun', is_weekend: false },
              ]);
            return Promise.resolve(rows);
          },
        };
        return new OtTrackerService(ds).buildYearGrid('t1', 2026);
      };
      const yrow = (o: Partial<Record<string, any>>) => ({
        person_no: '13830', name: 'A', function_name: 'Inbound', work_date: '2026-01-01',
        ot_min: 0, offday_min: 0, holiday_min: 0, ack_min: 0, pend_min: 0, flag: null, ...o,
      });

      it('uses the SAME rounding and payable rules as the month sheet', async () => {
        const r = await buildYear([yrow({ ot_min: 143 })]);          // 2.383 h → 2.5
        expect(r.people[0].cells['2026-01-01']).toMatchObject({ hours: 2.5, type: 'N' });
        expect(r.rounding).toEqual({ stepHours: 0.5, mode: 'nearest' });
        expect(r.people[0].paidTotal).toBe(3.13);                    // 2.5 × 1.25
      });

      it('places each day in its own month column and totals the year', async () => {
        const r = await buildYear([
          yrow({ work_date: '2026-01-01', holiday_min: 480 }),
          yrow({ work_date: '2026-05-24', ot_min: 120 }),
        ]);
        const p = r.people[0];
        expect(p.monthHours[0]).toBe(8);
        expect(p.monthHours[4]).toBe(2);
        expect(p.monthHours.reduce((a, b) => a + b, 0)).toBeCloseTo(p.rawTotal, 2);
        expect(p.rawHoliday).toBe(8);
        expect(p.rawNormal).toBe(2);
        expect(p.paidTotal).toBe(18.5);                              // 8×2 + 2×1.25
        expect(p.days).toBe(2);
      });

      it('pending-only behaves exactly as it does on the month sheet: no cell, still visible', async () => {
        const r = await buildYear([yrow({ pend_min: 120 })]);
        expect(r.totals.paidTotal).toBe(0);                          // nothing payable
        expect(r.people).toHaveLength(1);                            // …but not hidden
        expect(Object.keys(r.people[0].cells)).toEqual([]);
        expect(r.people[0].pendingHours).toBe(2);
        expect(r.totals.pendingHours).toBe(2);
      });

      it('grand totals equal the sum of the employee rows', async () => {
        const r = await buildYear([
          yrow({ person_no: '1', name: 'A', ot_min: 120 }),
          yrow({ person_no: '2', name: 'B', work_date: '2026-05-24', offday_min: 240 }),
        ]);
        expect(r.totals.people).toBe(2);
        expect(r.totals.rawTotal).toBeCloseTo(r.people.reduce((a, p) => a + p.rawTotal, 0), 2);
        expect(r.totals.monthHours.reduce((a, b) => a + b, 0)).toBeCloseTo(r.totals.rawTotal, 2);
      });
    });

    it('agrees with payableOtMin for the same inputs', async () => {
      const r = await build([row({ day: 1, ot_min: 95, ack_min: 25 })]);
      const expected = payableOtMin({ regularMin: 95, offdayMin: 0, holidayMin: 0, ackReviewMin: 25 }) / 60;
      expect(r.people[0].rawTotal).toBeCloseTo(expected, 2);
    });
  });
});
