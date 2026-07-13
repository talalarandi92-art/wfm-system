import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AgentRunner } from '@common/agent-runner';
import {
  RetentionEntry,
  retentionPlan,
  assertPlanSafe,
  buildPruneSql,
  buildPreviewSql,
  cutoffIso,
} from './retention.plan';

/**
 * RETENTION / PRUNING JOB (deep-study scale tail).
 *
 * High-growth, NON-CANONICAL tables (agent_events, integration_snapshots, the temporary
 * sprinklr debug_raw staging, read notifications) grow unbounded. This service prunes rows
 * older than a configurable window on a daily loop. It:
 *   • is DISABLED with RETENTION_ENABLED=0 (default on),
 *   • runs its tick through AgentRunner.runExclusive (pg advisory lock) so a multi-instance
 *     deploy never double-prunes (same pattern as the staffing-observer),
 *   • deletes in bounded batches (RETENTION_BATCH_SIZE, default 5000) so a huge backlog never
 *     locks a table or blows the statement timeout, and is idempotent (re-running prunes nothing
 *     once caught up),
 *   • refuses — via {@link assertPlanSafe} — to ever touch a canonical/pay/HR/audit/scorecard table.
 *
 * GET /retention/status gives an admin a dry preview (row counts, oldest row, what the next run
 * would prune) without deleting anything.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private readonly runner: AgentRunner;
  private readonly batchSize: number;
  private readonly intervalMs = 24 * 60 * 60 * 1000; // daily
  private bootTimer?: NodeJS.Timeout;
  private timer?: NodeJS.Timeout;

  constructor(@InjectDataSource() private readonly ds: DataSource) {
    this.runner = new AgentRunner(this.ds, 'retention-pruner');
    const b = parseInt(process.env.RETENTION_BATCH_SIZE ?? '5000', 10);
    this.batchSize = Number.isFinite(b) && b > 0 ? Math.min(b, 50_000) : 5000;
  }

  onModuleInit() {
    if ((process.env.RETENTION_ENABLED ?? '1') === '0') {
      this.logger.log('Retention pruner DISABLED (RETENTION_ENABLED=0)');
      return;
    }
    // First pass a few minutes after boot, then daily — advisory-lock exclusive.
    this.bootTimer = setTimeout(() => this.tick(), 5 * 60_000);
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.logger.log(`Retention pruner armed — daily, batch ${this.batchSize}`);
  }

  onModuleDestroy() {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  private tick() {
    this.runOnce()
      .then((r) => {
        if (r) {
          const touched = r.tables.filter((t) => t.pruned > 0).length;
          this.logger.log(`retention run: pruned ${r.totalPruned} row(s) across ${touched} table(s)`);
        }
      })
      .catch((e) => this.logger.warn(`retention run skipped: ${e.message}`));
  }

  /**
   * One prune pass, guarded by a pg advisory lock so multi-instance deploys never double-prune.
   * Returns null when another instance holds the lock. Logs a per-table summary.
   */
  async runOnce(
    now: Date = new Date(),
  ): Promise<{ totalPruned: number; tables: { table: string; days: number; pruned: number }[] } | null> {
    return this.runner.runExclusive(async () => {
      const plan = retentionPlan();
      assertPlanSafe(plan); // hard stop before any SQL if the plan ever drifts onto a protected table
      const tables: { table: string; days: number; pruned: number }[] = [];
      let totalPruned = 0;
      for (const e of plan) {
        const pruned = await this.pruneTable(e, now).catch((err) => {
          this.logger.warn(`prune ${e.table} failed: ${err.message}`);
          return 0;
        });
        totalPruned += pruned;
        tables.push({ table: e.table, days: e.days, pruned });
      }
      return { totalPruned, tables };
    });
  }

  /** Delete eligible rows for one table in bounded batches. Idempotent + safe. */
  private async pruneTable(e: RetentionEntry, now: Date): Promise<number> {
    const cutoff = cutoffIso(e, now);
    const sql = buildPruneSql(e);
    let pruned = 0;
    // Hard iteration cap so a runaway condition can never loop forever.
    for (let i = 0; i < 10_000; i++) {
      const res = await this.ds.query(sql, [cutoff, this.batchSize]);
      const n = this.affectedOf(res);
      pruned += n;
      if (n < this.batchSize) break; // last (partial) batch — nothing more to prune
    }
    if (pruned) this.logger.log(`pruned ${pruned} row(s) from ${e.table} (older than ${e.days}d)`);
    return pruned;
  }

  /**
   * Read-only status for an admin: per-table row count, oldest row, and what the next run WOULD
   * prune (dry preview — never deletes).
   */
  async status(now: Date = new Date()) {
    const plan = retentionPlan();
    assertPlanSafe(plan);
    const tables: {
      table: string;
      label: string;
      retentionDays: number;
      tsColumn: string;
      extraFilter: string | null;
      totalRows: number | null;
      oldestRow: unknown;
      wouldPrune: number | null;
      cutoff: string;
    }[] = [];
    for (const e of plan) {
      const cutoff = cutoffIso(e, now);
      const [tot] = await this.ds
        .query(`SELECT COUNT(*)::bigint AS n FROM ${e.table}`)
        .catch(() => [{ n: null }]);
      const [old] = await this.ds
        .query(`SELECT MIN(${e.tsCol}) AS oldest FROM ${e.table}`)
        .catch(() => [{ oldest: null }]);
      const [pv] = await this.ds.query(buildPreviewSql(e), [cutoff]).catch(() => [{ n: null }]);
      tables.push({
        table: e.table,
        label: e.label,
        retentionDays: e.days,
        tsColumn: e.tsCol,
        extraFilter: e.extraWhere || null,
        totalRows: tot?.n != null ? Number(tot.n) : null,
        oldestRow: old?.oldest ?? null,
        wouldPrune: pv?.n != null ? Number(pv.n) : null,
        cutoff,
      });
    }
    return {
      enabled: (process.env.RETENTION_ENABLED ?? '1') !== '0',
      batchSize: this.batchSize,
      intervalHours: this.intervalMs / 3_600_000,
      generatedAt: now.toISOString(),
      tables,
    };
  }

  /**
   * Extract the affected-row count from a raw TypeORM ds.query result. INSERT…RETURNING returns a
   * flat rows array; DELETE…RETURNING returns a [rows[], affectedCount] tuple (see the
   * typeorm-rawquery-gotchas note) — handle both shapes.
   */
  private affectedOf(res: any): number {
    if (Array.isArray(res)) {
      if (typeof res[1] === 'number') return res[1];
      if (Array.isArray(res[0])) return res[0].length;
      return res.length;
    }
    return res?.rowCount ?? 0;
  }
}
