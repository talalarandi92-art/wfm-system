/**
 * Guards the identity-backfill rule (2026-07-23).
 *
 * The stats upsert fills employee_id with `COALESCE(EXCLUDED.employee_id, existing)`,
 * which only fires when the SAME (tenant, stat_date, agent) row is written again.
 * Historical days are never rewritten, so an identity resolved today used to leave
 * every earlier day orphaned forever — proven live: 65 orphan rows across 35 real
 * employees, every one dated strictly BEFORE that agent's first linked day.
 *
 * These tests pin the two properties that make the fix safe:
 *   • resolving a link heals the agent's NULL history;
 *   • it only ever fills BLANKS — an existing attribution is never overwritten.
 */
import { SprinklrService } from './sprinklr.service';

type Q = { sql: string; params: unknown[] };

function harness() {
  const calls: Q[] = [];
  const ds = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (/RETURNING 1/.test(sql)) return [1, 1, 1];   // pretend 3 rows healed
      return [];
    }),
  };
  const svc = Object.create(SprinklrService.prototype) as any;
  svc.dataSource = ds;
  svc.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return { svc, ds, calls };
}

describe('persistAgentLink — a resolved identity reaches the history', () => {
  it('updates the map AND backfills the agent historical stat rows', async () => {
    const { svc, calls } = harness();
    await svc.persistAgentLink('t1', 'agent-9', 'emp-42');

    const map = calls.find(c => /UPDATE sprinklr_agent_map/.test(c.sql));
    expect(map).toBeTruthy();
    expect(map!.params).toEqual(['t1', 'agent-9', 'emp-42']);

    const heal = calls.find(c => /UPDATE agent_daily_stats/.test(c.sql));
    expect(heal).toBeTruthy();
    expect(heal!.params).toEqual(['t1', 'agent-9', 'emp-42']);
  });

  it('ONLY fills blanks — it can never overwrite an existing attribution', async () => {
    const { svc, calls } = harness();
    await svc.persistAgentLink('t1', 'agent-9', 'emp-42');
    const heal = calls.find(c => /UPDATE agent_daily_stats/.test(c.sql))!;
    // the guard that makes this safe to run on live data
    expect(heal.sql).toMatch(/employee_id IS NULL/);
    expect(heal.sql).not.toMatch(/employee_id\s*=\s*\$3\s*WHERE[\s\S]*employee_id IS NOT NULL/);
  });

  it('is scoped to ONE agent and ONE tenant — never a blanket update', async () => {
    const { svc, calls } = harness();
    await svc.persistAgentLink('t1', 'agent-9', 'emp-42');
    const heal = calls.find(c => /UPDATE agent_daily_stats/.test(c.sql))!;
    expect(heal.sql).toMatch(/tenant_id = \$1/);
    expect(heal.sql).toMatch(/sprinklr_agent_id = \$2/);
  });

  it('reports how many historical rows it healed (silent repairs hide drift)', async () => {
    const { svc } = harness();
    await svc.persistAgentLink('t1', 'agent-9', 'emp-42');
    expect(svc.logger.log).toHaveBeenCalledWith(expect.stringContaining('healed 3 historical stat row'));
  });

  it('survives a DB error without breaking the ingest run', async () => {
    const { svc } = harness();
    svc.dataSource.query = jest.fn(async () => { throw new Error('connection lost'); });
    await expect(svc.persistAgentLink('t1', 'agent-9', 'emp-42')).resolves.toBeUndefined();
  });
});
