export {};
/**
 * Auto-Ingest A2 — recon-emit-odoo-permissions.js column correctness + empty-safe.
 * Proves the emitted AOA matches the POSITIONAL columns recon-new-roster.js reads
 * (col1=ID numeric, col2=Date serial, col3=Type, col4/5=From/To clock, col6=Hours,
 * col7=Status) and that Type/Status text hits recon's regexes (comp / approved).
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const emit = require('../../../../scripts/recon-emit-odoo-permissions');

describe('recon-emit-odoo-permissions', () => {
  it('emits header-only + count 0 when nothing staged', () => {
    const { aoa, count } = emit.buildOdooPermissions([]);
    expect(count).toBe(0);
    expect(aoa).toHaveLength(1);
    expect(aoa[0]).toEqual(['Employee', 'ID', 'Date', 'Permission Type', 'Time From', 'Time To', 'Total Hours', 'Status']);
  });

  it('maps a late-in permission with numeric ID, serial date, clock times, HR-approved status', () => {
    const staging = [{
      model: 'x_permission_request',
      data: {
        id: 7, employee_id: [5, '[ 13311 ] AHMED'],
        date_from: '2026-06-10', permission_type: 'late',
        x_from: '08:00', x_to: '09:00', hours: 1, state: 'validate',
      },
    }];
    const { aoa, count } = emit.buildOdooPermissions(staging);
    expect(count).toBe(1);
    const row = aoa[1];
    expect(typeof row[1]).toBe('number');
    expect(row[1]).toBe(13311);
    expect(row[2]).toBe(emit.isoToSerial('2026-06-10'));
    expect(row[3]).toBe('Late In Permission');      // matches recon covers=/late in/
    expect(row[4]).toBe('08:00');
    expect(row[5]).toBe('09:00');
    expect(row[6]).toBe(1);
    expect(/approved/i.test(row[7])).toBe(true);    // recon approved=/approved/i
  });

  it('labels comp-off models so recon isComp=/comp off/ fires, and float-hours times convert', () => {
    const staging = [{
      model: 'x_comp_off',
      data: { id: 8, employee_id: [6, '[ 12345 ] SARA'], date_from: '2026-06-11', x_from: 15.5, hours: 2, state: 'confirm' },
    }];
    const { aoa } = emit.buildOdooPermissions(staging);
    const row = aoa[1];
    expect(/comp off/i.test(row[3])).toBe(true);
    expect(row[4]).toBe('15:30');                   // 15.5 float-hours → HH:MM
    expect(row[7]).toBe('Pending');                 // state 'confirm' → pending
  });

  it('skips non-request and non-permission staged models', () => {
    const { count, skipped } = emit.buildOdooPermissions([
      { model: 'res.users', data: { id: 1 } },
      { model: 'hr.attendance', data: { id: 2 } },
    ]);
    expect(count).toBe(0);
    expect(skipped).toBe(2);
  });
});
