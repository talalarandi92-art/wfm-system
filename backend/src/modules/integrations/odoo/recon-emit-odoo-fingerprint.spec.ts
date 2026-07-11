export {};
/**
 * Auto-Ingest A2 — recon-emit-odoo-fingerprint.js column correctness + empty-safe.
 * Proves the emitted AOA matches the POSITIONAL columns recon-new-roster.js reads
 * (col0=Code numeric, col1=Date serial, col3=In frac, col4=Out frac, col9=Status).
 */
 
const emit = require('../../../../scripts/recon-emit-odoo-fingerprint');

describe('recon-emit-odoo-fingerprint', () => {
  it('emits header-only + count 0 when no hr.attendance staged', () => {
    const { aoa, count } = emit.buildOdooFingerprint([], 180);
    expect(count).toBe(0);
    expect(aoa).toHaveLength(1);
    expect(aoa[0]).toEqual(['Code', 'Date', 'Day', 'In', 'Out', 'Total', 'Late In', 'Early Out', 'OT', 'Status']);
  });

  it('maps a staged hr.attendance record to a numeric-Code punch row (UTC→local +180m)', () => {
    const staging = [{
      data: {
        id: 42,
        employee_id: [5, '[ 13311 ] AHMED ALI'],
        check_in: '2026-06-10 05:05:00',   // UTC → 08:05 local
        check_out: '2026-06-10 14:10:00',  // UTC → 17:10 local
        worked_hours: 8.5,
      },
    }];
    const { aoa, count } = emit.buildOdooFingerprint(staging, 180);
    expect(count).toBe(1);
    const row = aoa[1];
    expect(typeof row[0]).toBe('number');                  // recon requires typeof number
    expect(row[0]).toBe(13311);                            // Code = employee_no
    expect(row[1]).toBe(emit.isoToSerial('2026-06-10'));   // Date serial
    expect(Math.round(row[3] * 1440)).toBe(8 * 60 + 5);    // In → 485 min local
    expect(Math.round(row[4] * 1440)).toBe(17 * 60 + 10);  // Out → 1030 min local
    expect(row[5]).toBe(8.5);                              // Total (worked hours)
  });

  it('skips records missing an employee_no tag or check_in', () => {
    const { count, skipped } = emit.buildOdooFingerprint([
      { data: { id: 1, employee_id: [5, 'NO TAG NAME'], check_in: '2026-06-10 05:00:00' } },
      { data: { id: 2, employee_id: [6, '[ 12345 ] X'], check_in: null } },
    ], 180);
    expect(count).toBe(0);
    expect(skipped).toBe(2);
  });
});
