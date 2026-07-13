/**
 * RETENTION PLAN — pure, DB-free description of what the pruning job may touch.
 *
 * Deliberately isolated from NestJS/TypeORM so it is trivially unit-testable and so the
 * safety guarantees (allow-list only, never a canonical/pay/HR/audit table, strict
 * identifier grammar, age cutoff always parameterised) are asserted without a database.
 *
 * Scope decision (deep-study scale tail): only HIGH-GROWTH, NON-CANONICAL tables are ever
 * pruned. Everything a report, payslip, scorecard, audit, or roster could ever read again
 * is on the FORBIDDEN list and the plan refuses to run if it ever collides with one.
 */

export interface RetentionEntry {
  /** target table — must match the strict identifier grammar and never be FORBIDDEN */
  table: string;
  /** timestamptz/timestamp column used for the age cutoff */
  tsCol: string;
  /** keep this many days; rows strictly older than the cutoff are eligible */
  days: number;
  /** optional extra predicate (static literals only) ANDed with the age cutoff */
  extraWhere: string;
  /** human label for /retention/status */
  label: string;
}

/**
 * Tables that must NEVER be pruned — canonical roster, attendance, identity, pay/HR,
 * audit, scorecard, requests, leave. Matching is case-insensitive and also covers the
 * scorecard_* family via a prefix check in {@link assertPlanSafe}.
 */
export const FORBIDDEN_TABLES: readonly string[] = [
  'roster_days',
  'roster_daily',
  'attendance_records',
  'employees',
  'users',
  'audit_logs',
  'audit_log',
  'requests',
  'request_permissions',
  'leave_balances',
  'leave_ledger',
  'payroll',
  'salaries',
  'schema_migrations',
];

/** Any table whose name starts with one of these prefixes is also protected. */
export const FORBIDDEN_PREFIXES: readonly string[] = ['scorecard_', 'payroll_', 'salary_'];

const IDENT = /^[a-z_][a-z0-9_]*$/;

const num = (v: string | undefined, d: number): number => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

/**
 * Build the retention plan from env (pure — deterministic given env). Windows:
 *   RETENTION_AGENT_EVENTS_DAYS   (default 90)  — agent_events (AI bus, append-only, non-canonical)
 *   RETENTION_SNAPSHOTS_DAYS      (default 30)  — integration_snapshots (Sprinklr/Ameyo live, 68/2h churn)
 *   RETENTION_DEBUG_RAW_DAYS      (default 7)   — sprinklr_report_staging WHERE report_type='debug_raw'
 *   RETENTION_NOTIFICATIONS_DAYS  (default 120) — notifications that are already read (is_read)
 */
export function retentionPlan(env: NodeJS.ProcessEnv = process.env): RetentionEntry[] {
  return [
    {
      table: 'agent_events',
      tsCol: 'created_at',
      days: num(env.RETENTION_AGENT_EVENTS_DAYS, 90),
      extraWhere: '',
      label: 'Agent events (AI workforce bus)',
    },
    {
      table: 'integration_snapshots',
      tsCol: 'captured_at',
      days: num(env.RETENTION_SNAPSHOTS_DAYS, 30),
      extraWhere: '',
      label: 'Integration snapshots (Sprinklr/Ameyo live)',
    },
    {
      table: 'sprinklr_report_staging',
      tsCol: 'captured_at',
      days: num(env.RETENTION_DEBUG_RAW_DAYS, 7),
      // temporary debug capture only — the canonical agent_perf rows are never touched
      extraWhere: "report_type = 'debug_raw'",
      label: 'Sprinklr debug_raw staging (temporary)',
    },
    {
      table: 'notifications',
      tsCol: 'created_at',
      days: num(env.RETENTION_NOTIFICATIONS_DAYS, 120),
      extraWhere: 'is_read = TRUE',
      label: 'Read notifications',
    },
  ];
}

/** True when a table name is protected (forbidden exact match or forbidden prefix). */
export function isForbidden(table: string): boolean {
  const t = table.toLowerCase();
  if (FORBIDDEN_TABLES.some((f) => f.toLowerCase() === t)) return true;
  return FORBIDDEN_PREFIXES.some((p) => t.startsWith(p));
}

/**
 * Assert every planned entry is safe: valid identifiers and NOT a protected table.
 * Throws before any SQL is built — the job never runs against a canonical table.
 */
export function assertPlanSafe(plan: RetentionEntry[]): void {
  for (const e of plan) {
    if (!IDENT.test(e.table) || !IDENT.test(e.tsCol)) {
      throw new Error(`RetentionService: unsafe identifier in plan (${e.table}/${e.tsCol})`);
    }
    if (isForbidden(e.table)) {
      throw new Error(`RetentionService refuses to prune protected table "${e.table}"`);
    }
    if (!(e.days > 0)) {
      throw new Error(`RetentionService: non-positive retention window for "${e.table}"`);
    }
  }
}

/** WHERE body (no WHERE keyword) selecting rows older than the cutoff. Cutoff is always $1. */
export function whereClause(e: RetentionEntry): string {
  const age = `${e.tsCol} < $1::timestamptz`;
  return e.extraWhere ? `(${e.extraWhere}) AND ${age}` : age;
}

/** Bounded-batch DELETE SQL. $1 = cutoff ISO, $2 = batch size. RETURNING 1 so we can count deleted rows. */
export function buildPruneSql(e: RetentionEntry): string {
  return (
    `DELETE FROM ${e.table} ` +
    `WHERE ctid IN (SELECT ctid FROM ${e.table} WHERE ${whereClause(e)} LIMIT $2) ` +
    `RETURNING 1`
  );
}

/** Dry-preview count SQL — how many rows the next run WOULD prune. $1 = cutoff ISO. No delete. */
export function buildPreviewSql(e: RetentionEntry): string {
  return `SELECT COUNT(*)::bigint AS n FROM ${e.table} WHERE ${whereClause(e)}`;
}

/** ISO cutoff for an entry given "now" (rows strictly older than this are pruned). */
export function cutoffIso(e: RetentionEntry, now: Date = new Date()): string {
  return new Date(now.getTime() - e.days * 86_400_000).toISOString();
}
