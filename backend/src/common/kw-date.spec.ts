import { kwToday, kwHour, kwMonth, kwMonthStart, fmtLocalDate, addDays } from './kw-date';

/**
 * Kuwait-local dates. These exist because `new Date().toISOString().slice(0,10)`
 * is a UTC calendar date, and Kuwait is UTC+03:00 — so for three hours of every
 * day it silently names YESTERDAY. Seventeen places in this codebase carried that
 * expression; none of them threw, they were just wrong before 03:00 local.
 */
describe('kw-date', () => {
  const realNow = Date.now;
  afterEach(() => { Date.now = realNow; });

  /* Freeze the clock. NOTE: stubbing Date.now() does not affect a bare `new Date()`
     — V8 reads its internal clock for that — so the "old expression" below is written
     as `new Date(Date.now())` to make the comparison honest. That is the same instant
     the real code saw; only the plumbing differs. */
  const at = (iso: string) => { const t = new Date(iso).getTime(); Date.now = () => t; };
  const utcTodayOldWay = () => new Date(Date.now()).toISOString().slice(0, 10);

  describe('the bug these replace: 00:00-02:59 Kuwait is still yesterday in UTC', () => {
    it('01:30 Kuwait on the 1st is the 1st, not the last day of the previous month', () => {
      at('2026-06-30T22:30:00Z');                 // = 2026-07-01 01:30 in Kuwait
      expect(utcTodayOldWay()).toBe('2026-06-30');                        // the old expression
      expect(kwToday()).toBe('2026-07-01');                              // the correct answer
      // this is the case that rolled the executive month-to-date back a whole month
      expect(kwMonthStart()).toBe('2026-07-01');
      expect(kwMonth()).toBe('2026-07');
    });

    it('02:59 Kuwait still resolves to today', () => {
      at('2026-07-24T23:59:00Z');                 // = 2026-07-25 02:59 Kuwait
      expect(kwToday()).toBe('2026-07-25');
    });

    it('03:00 Kuwait onward the two agree (the window closes)', () => {
      at('2026-07-25T00:00:00Z');                 // = 03:00 Kuwait
      expect(kwToday()).toBe('2026-07-25');
      expect(utcTodayOldWay()).toBe('2026-07-25');
    });
  });

  describe('the hour must come from the same clock as the date', () => {
    it('kwHour is the Kuwait wall-clock hour, not the server hour', () => {
      at('2026-07-25T11:15:00Z');                 // 14:15 Kuwait
      expect(kwHour()).toBe(14);
      expect(kwToday()).toBe('2026-07-25');
    });
    it('pairs correctly across the midnight boundary', () => {
      at('2026-07-24T21:30:00Z');                 // 2026-07-25 00:30 Kuwait
      expect(kwToday()).toBe('2026-07-25');
      expect(kwHour()).toBe(0);                   // a coverage-gap check must not aim at 21:00 of the wrong day
    });
  });

  describe('fmtLocalDate — for a pg `date` parsed to LOCAL midnight', () => {
    it('reads the local fields instead of re-projecting through UTC', () => {
      // node-postgres gives a `date` column back as local midnight; toISOString()
      // on that shifts the day backwards in any positive offset, which is how
      // several MAX(attendance_date) defaults dropped the newest day of data.
      const d = new Date(2026, 6, 25);            // local 2026-07-25 00:00
      expect(fmtLocalDate(d)).toBe('2026-07-25');
    });
    it('passes a string through untouched and tolerates null', () => {
      expect(fmtLocalDate('2026-07-25')).toBe('2026-07-25');
      expect(fmtLocalDate('2026-07-25T00:00:00Z')).toBe('2026-07-25');
      expect(fmtLocalDate(null)).toBeNull();
      expect(fmtLocalDate(new Date('nonsense'))).toBeNull();
    });
  });

  describe('addDays never crosses a timezone', () => {
    it('adds and subtracts whole days', () => {
      expect(addDays('2026-07-25', 1)).toBe('2026-07-26');
      expect(addDays('2026-07-25', -7)).toBe('2026-07-18');
    });
    it('crosses month and year boundaries', () => {
      expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
      expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
      expect(addDays('2026-02-28', 1)).toBe('2026-03-01');   // 2026 is not a leap year
    });
  });
});
