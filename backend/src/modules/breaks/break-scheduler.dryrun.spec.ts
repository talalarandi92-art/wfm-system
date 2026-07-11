/**
 * B5 GATE — the optimizer's generateForDate is a DRY-RUN plan computation:
 *  1. it never issues a mutating SQL statement (SELECT/WITH only), and
 *  2. the same inputs + same scenario produce the identical plan (determinism).
 * The simulation endpoint rides on exactly this function, so this test IS the
 * "simulation writes nothing" assertion at the unit level (the live smoke
 * re-checks it against the real DB by row count).
 */
import { BreakSchedulerService } from './break-scheduler.service';
import { BreakPolicyV2Row } from './break-policy.logic';

const POLICY: BreakPolicyV2Row = {
  id: 'p-default', tenant_id: 't1', function_name: null, shift_type: null, employment_type: null,
  total_daily_minutes: 60, max_sessions: 3, duration_pattern: [15, 30, 15],
  protected_first_min: 60, protected_last_min: 60, min_gap_between_breaks_min: 90,
  min_work_before_first_min: 120, max_delay_min: 45, release_mode: 'hybrid',
  thresholds: {}, active: true,
};

const EMPLOYEES = Array.from({ length: 8 }, (_, i) => ({
  employee_id: `emp-${i}`,
  employee_no: `100${i}`,
  employee_name: `Agent ${i}`,
  gender: i % 2 ? 'female' : 'male',
  function_id: 'fn-cc',
  function_name: 'Customer Care',
  employment_type: 'full_time',
  shift_code: 'M',
  team_manager: `TL-${i % 3}`,
  shift_start: '2026-07-01T08:00:00.000+03:00',
  shift_end: '2026-07-01T17:00:00.000+03:00',
  fairness_score: 0,
}));

function makeScheduler() {
  const executed: string[] = [];
  const query = jest.fn(async (sql: string) => {
    executed.push(sql);
    if (sql.includes('FROM attendance_records')) return EMPLOYEES.map(e => ({ ...e }));
    if (sql.includes('FROM break_types')) return [{ id: 'bt-15', name: 'Short Break', duration_minutes: 15, is_prayer: false }, { id: 'bt-30', name: 'Lunch', duration_minutes: 30, is_prayer: false }];
    if (sql.includes('FROM prayer_times')) return [];
    if (sql.includes('FROM headcount_intervals')) return [];
    if (sql.includes('FROM break_slots')) return [];
    return [];
  });
  const dataSource = { query } as any;
  const policyService = { loadActivePolicies: jest.fn(async () => [{ ...POLICY, thresholds: { ...POLICY.thresholds } }]) } as any;
  const coverageRebuild = { rebuild: jest.fn(async () => undefined) } as any;
  return { svc: new BreakSchedulerService(dataSource, policyService, coverageRebuild), executed };
}

const MUTATING = /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|MERGE)\b/i;

describe('generateForDate — dry-run + simulation determinism', () => {
  it('issues ZERO mutating SQL, with and without a scenario', async () => {
    const { svc, executed } = makeScheduler();
    await svc.generateForDate('t1', '2026-07-01');
    await svc.generateForDate('t1', '2026-07-01', undefined, { absencePct: 30, queueSpike: 'severe', extraStaff: 2 });
    expect(executed.length).toBeGreaterThan(0);
    for (const sql of executed) expect(sql).not.toMatch(MUTATING);
  });

  it('same scenario → byte-identical plan (deterministic absence by employee hash)', async () => {
    const a = await makeScheduler().svc.generateForDate('t1', '2026-07-01', undefined, { absencePct: 40 });
    const b = await makeScheduler().svc.generateForDate('t1', '2026-07-01', undefined, { absencePct: 40 });
    expect(a.slots).toEqual(b.slots);
    expect(a.simulation!.absentEmployees).toEqual(b.simulation!.absentEmployees);
    expect(a.warnings).toEqual(b.warnings);
  });

  it('absencePct 100 → everyone absent, no slots; 0 → nobody absent', async () => {
    const all = await makeScheduler().svc.generateForDate('t1', '2026-07-01', undefined, { absencePct: 100 });
    expect(all.simulation!.absentEmployees).toHaveLength(EMPLOYEES.length);
    expect(all.simulation!.onShiftCount).toBe(0);
    expect(all.slots).toHaveLength(0);

    const none = await makeScheduler().svc.generateForDate('t1', '2026-07-01', undefined, { absencePct: 0 });
    expect(none.simulation!.absentEmployees).toHaveLength(0);
    expect(none.simulation!.onShiftCount).toBe(EMPLOYEES.length);
    expect(none.slots.length).toBeGreaterThan(0);
  });

  it('no scenario → no simulation field (write path untouched)', async () => {
    const res = await makeScheduler().svc.generateForDate('t1', '2026-07-01');
    expect(res.simulation).toBeUndefined();
    expect(res.slots.length).toBeGreaterThan(0);
  });

  it('scenario plan (0% absence, no overrides) equals the non-scenario plan', async () => {
    const plain = await makeScheduler().svc.generateForDate('t1', '2026-07-01');
    const sim = await makeScheduler().svc.generateForDate('t1', '2026-07-01', undefined, { absencePct: 0 });
    expect(sim.slots).toEqual(plain.slots);
  });
});
