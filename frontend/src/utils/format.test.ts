/**
 * Smoke tests — pure formatting/business helpers (no DOM needed).
 * These guard REAL rules: the Saturday week start, the local-date
 * (never toISOString) rule, duration/time rendering, and the
 * Arabic mojibake repair.
 */
import { describe, it, expect } from 'vitest';
import {
  fmtLocalDate, weekStartSat, fmtTime, fmtDuration,
  fixEncoding, conformanceGrade,
} from './format';

describe('fmtLocalDate — local YYYY-MM-DD, never UTC-shifted', () => {
  it('formats a local date without timezone shifting', () => {
    // 00:30 local on the 1st: toISOString() in UTC+3 would yield the PREVIOUS day.
    expect(fmtLocalDate(new Date(2026, 6, 1, 0, 30))).toBe('2026-07-01');
  });
  it('zero-pads month and day', () => {
    expect(fmtLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('weekStartSat — workforce week starts Saturday (Sat→Fri)', () => {
  it('maps a Friday to the Saturday 6 days earlier', () => {
    // 2026-07-10 is a Friday → week started Saturday 2026-07-04
    expect(weekStartSat(new Date(2026, 6, 10))).toBe('2026-07-04');
  });
  it('a Saturday is its own week start', () => {
    expect(weekStartSat(new Date(2026, 6, 4))).toBe('2026-07-04');
  });
  it('a Sunday belongs to the Saturday one day before', () => {
    expect(weekStartSat(new Date(2026, 6, 5))).toBe('2026-07-04');
  });
});

describe('fmtTime — 12-hour with AR/EN period markers', () => {
  it('renders PM in English and م in Arabic', () => {
    expect(fmtTime('18:45')).toBe('6:45 PM');
    expect(fmtTime('18:45', true)).toBe('6:45 م');
  });
  it('midnight and noon edge cases', () => {
    expect(fmtTime('00:05')).toBe('12:05 AM');
    expect(fmtTime('12:00')).toBe('12:00 PM');
  });
  it('returns em-dash for empty input', () => {
    expect(fmtTime(null)).toBe('—');
  });
});

describe('fmtDuration — minutes to Xh Ym', () => {
  it('renders hours + minutes in both languages', () => {
    expect(fmtDuration(150)).toBe('2h 30m');
    expect(fmtDuration(150, true)).toBe('2س 30د');
  });
  it('collapses pure hours / pure minutes and dashes zero', () => {
    expect(fmtDuration(120)).toBe('2h');
    expect(fmtDuration(45)).toBe('45m');
    expect(fmtDuration(0)).toBe('—');
  });
});

describe('fixEncoding — repairs W1252-mojibake Arabic', () => {
  it('decodes "Øµ" back to "ص" and leaves clean strings alone', () => {
    expect(fixEncoding('Øµ')).toBe('ص');
    expect(fixEncoding('hello')).toBe('hello');
    expect(fixEncoding('صباح الخير')).toBe('صباح الخير');
  });
});

describe('conformanceGrade — banded letter grades', () => {
  it('applies the documented bands', () => {
    expect(conformanceGrade(99).grade).toBe('A+');
    expect(conformanceGrade(95).grade).toBe('A');
    expect(conformanceGrade(90).grade).toBe('B');
    expect(conformanceGrade(80).grade).toBe('C');
    expect(conformanceGrade(70).grade).toBe('D');
    expect(conformanceGrade(69).grade).toBe('E');
    expect(conformanceGrade(null).grade).toBe('—');
  });
});
