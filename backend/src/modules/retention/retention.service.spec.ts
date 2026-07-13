import { RetentionService } from './retention.service';
import { FORBIDDEN_TABLES, retentionPlan } from './retention.plan';

/**
 * A minimal fake DataSource that records every SQL it is asked to run and returns
 * shape-correct responses for the advisory lock, the batch DELETEs, and the status reads.
 * No real database is touched.
 */
class FakeDs {
  calls: { sql: string; params: any[] }[] = [];
  lockHeld = true;
  /** per-DELETE affected counts, consumed in order; falls back to 0 (loop terminates). */
  deleteCounts: number[] = [];
  private deleteIdx = 0;

  query = async (sql: string, params: any[] = []) => {
    this.calls.push({ sql, params });
    if (sql.includes('pg_try_advisory_lock')) return [{ ok: this.lockHeld }];
    if (sql.includes('pg_advisory_unlock')) return [{}];
    if (sql.trimStart().startsWith('DELETE')) {
      const n = this.deleteCounts[this.deleteIdx++] ?? 0;
      // DELETE … RETURNING → TypeORM returns a [rows[], affectedCount] tuple
      return [Array.from({ length: n }, () => ({ '?column?': 1 })), n];
    }
    if (sql.includes('MIN(')) return [{ oldest: '2020-01-01T00:00:00.000Z' }];
    if (sql.includes('COUNT(*)') && sql.includes('WHERE')) return [{ n: '5' }]; // preview
    if (sql.includes('COUNT(*)')) return [{ n: '100' }]; // total
    return [];
  };

  deletes() {
    return this.calls.filter((c) => c.sql.trimStart().startsWith('DELETE'));
  }
}

const makeSvc = (ds: FakeDs) => new RetentionService(ds as any);

describe('RetentionService', () => {
  const ALLOWED = new Set(retentionPlan({}).map((e) => e.table));

  it('runOnce prunes ONLY allow-listed tables and never a forbidden one', async () => {
    const ds = new FakeDs();
    const res = await makeSvc(ds).runOnce();
    expect(res).not.toBeNull();

    const deletes = ds.deletes();
    expect(deletes.length).toBe(ALLOWED.size); // one DELETE per planned table (each returns 0 → single batch)

    for (const d of deletes) {
      // extract the target table from "DELETE FROM <table> WHERE …"
      const m = d.sql.match(/DELETE FROM (\w+)/);
      expect(m).not.toBeNull();
      const table = m![1];
      expect(ALLOWED.has(table)).toBe(true);
      for (const forbidden of FORBIDDEN_TABLES) {
        expect(new RegExp(`\\b${forbidden}\\b`).test(d.sql)).toBe(false);
      }
    }
  });

  it('runOnce respects the cutoff — every DELETE binds an ISO timestamp strictly in the past', async () => {
    const ds = new FakeDs();
    const before = Date.now();
    await makeSvc(ds).runOnce(new Date(before));
    for (const d of ds.deletes()) {
      const cutoff = d.params[0];
      expect(typeof cutoff).toBe('string');
      const t = Date.parse(cutoff);
      expect(Number.isNaN(t)).toBe(false);
      expect(t).toBeLessThan(before); // older than "now"
      // batch size is the second bound param
      expect(typeof d.params[1]).toBe('number');
      expect(d.params[1]).toBeGreaterThan(0);
    }
  });

  it('acquires the advisory lock and releases it', async () => {
    const ds = new FakeDs();
    await makeSvc(ds).runOnce();
    expect(ds.calls.some((c) => c.sql.includes('pg_try_advisory_lock'))).toBe(true);
    expect(ds.calls.some((c) => c.sql.includes('pg_advisory_unlock'))).toBe(true);
  });

  it('when another instance holds the lock, runOnce returns null and deletes NOTHING', async () => {
    const ds = new FakeDs();
    ds.lockHeld = false;
    const res = await makeSvc(ds).runOnce();
    expect(res).toBeNull();
    expect(ds.deletes().length).toBe(0);
  });

  it('deletes in bounded batches and sums the counts until a partial batch', async () => {
    const prev = process.env.RETENTION_BATCH_SIZE;
    process.env.RETENTION_BATCH_SIZE = '10';
    try {
      const ds = new FakeDs();
      // agent_events (first planned table): full batch (10) then partial (3) → stops; total 13.
      ds.deleteCounts = [10, 3];
      const res = await makeSvc(ds).runOnce();
      expect(res).not.toBeNull();
      const agentEvents = res!.tables.find((t) => t.table === 'agent_events')!;
      expect(agentEvents.pruned).toBe(13);
      // exactly two DELETEs were needed for that table before the partial batch stopped it
      const aeDeletes = ds.deletes().filter((d) => /DELETE FROM agent_events\b/.test(d.sql));
      expect(aeDeletes.length).toBe(2);
    } finally {
      if (prev === undefined) delete process.env.RETENTION_BATCH_SIZE;
      else process.env.RETENTION_BATCH_SIZE = prev;
    }
  });

  it('status() is a dry preview — returns per-table shape and issues NO delete', async () => {
    const ds = new FakeDs();
    const out = await makeSvc(ds).status();
    expect(ds.deletes().length).toBe(0);
    expect(out.enabled).toBe(true);
    expect(out.tables.length).toBe(ALLOWED.size);
    for (const t of out.tables) {
      expect(ALLOWED.has(t.table)).toBe(true);
      expect(t.totalRows).toBe(100);
      expect(t.wouldPrune).toBe(5);
      expect(t.oldestRow).toBe('2020-01-01T00:00:00.000Z');
      expect(typeof t.cutoff).toBe('string');
      expect(t.retentionDays).toBeGreaterThan(0);
    }
  });
});
