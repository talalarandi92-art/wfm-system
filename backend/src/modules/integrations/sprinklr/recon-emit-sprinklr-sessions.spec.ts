export {};
/**
 * Auto-Ingest A1 — recon-emit-sprinklr-sessions.js column correctness + empty-safe.
 * Tests the PURE builder (no DB): proves the emitted AOA has the exact columns
 * recon-new-roster.js reads (ID/Login Date/Login Time/Logout Date/Logout Time),
 * with dates as Excel serials and times as day fractions, plus a normalized row.
 */
 
const emit = require('../../../../scripts/recon-emit-sprinklr-sessions');

describe('recon-emit-sprinklr-sessions', () => {
  it('emits header-only + count 0 when staging is empty (awaiting live capture)', () => {
    const { aoa, count } = emit.buildSprinklrSessions([]);
    expect(count).toBe(0);
    expect(aoa).toHaveLength(1);
    expect(aoa[0]).toEqual(['ID', 'Login Date', 'Login Time', 'Logout Date', 'Logout Time']);
  });

  it('normalizes a staged login/logout row into recon columns (serial date + fraction time)', () => {
    const staging = [{
      agent_email: 'a.wahab@boutiqaat.com', day: '2026-06-10',
      payload: {
        rows: [{
          dims: {
            AgentEmail: 'a.wahab@boutiqaat.com',
            Date: '2026-06-10',
            Login: '2026-06-10 08:05',
            Logout: '2026-06-10 17:12',
          },
          measures: {},
        }],
      },
    }];
    const { aoa, count } = emit.buildSprinklrSessions(staging);
    expect(count).toBe(1);
    const [, row] = aoa;
    expect(row[0]).toBe('a.wahab@boutiqaat.com');
    expect(row[1]).toBe(emit.isoToSerial('2026-06-10'));   // Login Date serial
    expect(Math.round(row[2] * 1440)).toBe(8 * 60 + 5);    // Login Time fraction → 485 min
    expect(row[3]).toBe(emit.isoToSerial('2026-06-10'));   // Logout Date serial
    expect(Math.round(row[4] * 1440)).toBe(17 * 60 + 12);  // Logout Time fraction → 1032 min
  });

  it('rolls the logout date forward one day when the session crosses midnight', () => {
    const staging = [{
      agent_email: 'm.abdulbaqi@boutiqaat.com', day: '2026-06-10',
      payload: { rows: [{ dims: { e: 'm.abdulbaqi@boutiqaat.com', d: '2026-06-10', a: '2026-06-10 22:00', b: '2026-06-10 06:30' }, measures: {} }] },
    }];
    const { aoa } = emit.buildSprinklrSessions(staging);
    const row = aoa[1];
    expect(row[1]).toBe(emit.isoToSerial('2026-06-10'));   // login day
    expect(row[3]).toBe(emit.isoToSerial('2026-06-11'));   // logout rolled to next day
  });
});
