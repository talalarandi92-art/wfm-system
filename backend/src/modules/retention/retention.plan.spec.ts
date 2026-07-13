import {
  FORBIDDEN_TABLES,
  FORBIDDEN_PREFIXES,
  retentionPlan,
  assertPlanSafe,
  isForbidden,
  whereClause,
  buildPruneSql,
  buildPreviewSql,
  cutoffIso,
  RetentionEntry,
} from './retention.plan';

describe('retention.plan — safety & SQL shape', () => {
  it('default plan covers exactly the four non-canonical high-growth tables', () => {
    const plan = retentionPlan({});
    expect(plan.map((e) => e.table).sort()).toEqual(
      ['agent_events', 'integration_snapshots', 'notifications', 'sprinklr_report_staging'].sort(),
    );
  });

  it('default windows: 90 / 30 / 7 / 120 days', () => {
    const byTable = Object.fromEntries(retentionPlan({}).map((e) => [e.table, e.days]));
    expect(byTable['agent_events']).toBe(90);
    expect(byTable['integration_snapshots']).toBe(30);
    expect(byTable['sprinklr_report_staging']).toBe(7);
    expect(byTable['notifications']).toBe(120);
  });

  it('env overrides the windows (positive integers only)', () => {
    const plan = retentionPlan({
      RETENTION_AGENT_EVENTS_DAYS: '45',
      RETENTION_SNAPSHOTS_DAYS: '10',
      RETENTION_DEBUG_RAW_DAYS: '3',
      RETENTION_NOTIFICATIONS_DAYS: '60',
    } as any);
    const byTable = Object.fromEntries(plan.map((e) => [e.table, e.days]));
    expect(byTable).toEqual({
      agent_events: 45,
      integration_snapshots: 10,
      sprinklr_report_staging: 3,
      notifications: 60,
    });
  });

  it('bad/negative/zero env values fall back to the defaults', () => {
    const plan = retentionPlan({
      RETENTION_AGENT_EVENTS_DAYS: '0',
      RETENTION_SNAPSHOTS_DAYS: '-5',
      RETENTION_DEBUG_RAW_DAYS: 'abc',
      RETENTION_NOTIFICATIONS_DAYS: '',
    } as any);
    const byTable = Object.fromEntries(plan.map((e) => [e.table, e.days]));
    expect(byTable).toEqual({
      agent_events: 90,
      integration_snapshots: 30,
      sprinklr_report_staging: 7,
      notifications: 120,
    });
  });

  it('the default plan is SAFE — no protected table, valid identifiers', () => {
    expect(() => assertPlanSafe(retentionPlan({}))).not.toThrow();
  });

  it('never targets a canonical / pay / HR / audit / scorecard table', () => {
    const targets = retentionPlan({}).map((e) => e.table.toLowerCase());
    for (const forbidden of FORBIDDEN_TABLES) {
      expect(targets).not.toContain(forbidden.toLowerCase());
    }
    // and none of the targets fall under a forbidden prefix
    for (const t of targets) {
      expect(FORBIDDEN_PREFIXES.some((p) => t.startsWith(p))).toBe(false);
      expect(isForbidden(t)).toBe(false);
    }
  });

  it('assertPlanSafe THROWS if a protected table ever sneaks into a plan', () => {
    const bad: RetentionEntry[] = [
      { table: 'roster_days', tsCol: 'created_at', days: 30, extraWhere: '', label: 'x' },
    ];
    expect(() => assertPlanSafe(bad)).toThrow(/protected table/);
  });

  it('assertPlanSafe THROWS on a scorecard_* prefixed table', () => {
    const bad: RetentionEntry[] = [
      { table: 'scorecard_monthly', tsCol: 'created_at', days: 30, extraWhere: '', label: 'x' },
    ];
    expect(() => assertPlanSafe(bad)).toThrow(/protected table/);
  });

  it('assertPlanSafe THROWS on an injection-shaped identifier', () => {
    const bad: RetentionEntry[] = [
      { table: 'agent_events; DROP TABLE users', tsCol: 'created_at', days: 30, extraWhere: '', label: 'x' },
    ];
    expect(() => assertPlanSafe(bad)).toThrow(/unsafe identifier/);
  });

  it('assertPlanSafe THROWS on a non-positive window', () => {
    const bad: RetentionEntry[] = [
      { table: 'agent_events', tsCol: 'created_at', days: 0, extraWhere: '', label: 'x' },
    ];
    expect(() => assertPlanSafe(bad)).toThrow(/non-positive/);
  });

  it('prune SQL always parameterises the cutoff ($1) and batch ($2), never inlines a date', () => {
    for (const e of retentionPlan({})) {
      const sql = buildPruneSql(e);
      expect(sql).toContain(`DELETE FROM ${e.table} `);
      expect(sql).toContain('$1::timestamptz'); // age cutoff bound, not inlined
      expect(sql).toContain('LIMIT $2'); // bounded batch
      expect(sql).toContain('RETURNING 1'); // countable
      // the DELETE only ever names its own table
      expect(sql).toContain(e.table);
    }
  });

  it('debug_raw + notifications carry their extra predicate in every generated clause', () => {
    const staging = retentionPlan({}).find((e) => e.table === 'sprinklr_report_staging')!;
    expect(whereClause(staging)).toContain("report_type = 'debug_raw'");
    expect(buildPruneSql(staging)).toContain("report_type = 'debug_raw'");
    expect(buildPreviewSql(staging)).toContain("report_type = 'debug_raw'");

    const notif = retentionPlan({}).find((e) => e.table === 'notifications')!;
    expect(whereClause(notif)).toContain('is_read = TRUE');
    expect(buildPreviewSql(notif)).toContain('is_read = TRUE');
  });

  it('no generated SQL (prune or preview) ever references a forbidden table name', () => {
    for (const e of retentionPlan({})) {
      const sqls = [buildPruneSql(e), buildPreviewSql(e)];
      for (const sql of sqls) {
        for (const forbidden of FORBIDDEN_TABLES) {
          // word-boundary check so e.g. "users" never appears as a target
          expect(new RegExp(`\\b${forbidden}\\b`).test(sql)).toBe(false);
        }
      }
    }
  });

  it('cutoffIso respects the window — older than exactly N days from now', () => {
    const now = new Date('2026-07-13T00:00:00.000Z');
    const e: RetentionEntry = { table: 'agent_events', tsCol: 'created_at', days: 90, extraWhere: '', label: 'x' };
    expect(cutoffIso(e, now)).toBe('2026-04-14T00:00:00.000Z'); // 90 days earlier
  });
});
