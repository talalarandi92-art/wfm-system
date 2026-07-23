/**
 * IDOR REGRESSION — scorecard batch export must respect row-level scope.
 *
 * exportBatch() was the only scorecard read with NO scope filter: an agent
 * (holds scorecard.view_own, employee_id NULL) could download every person's
 * scores. This proves the fix: an agent-scoped caller (empNos=[]) gets ZERO
 * data rows in the exported workbook, while an admin (scorecard.view_all)
 * gets ALL rows — with the SQL scope filter honoured exactly like real Postgres.
 */
import { Readable } from 'stream';
import * as XLSX from 'xlsx';
import { ScorecardController } from './scorecard.controller';

/** Two people, two different employees, one batch/Final week. */
const FIXTURE = [
  { function_name: 'Customer Care', employee_name: 'Alice', employee_no: '10001', user_id_login: 'alice', team_leader: 'TL1', function_rank: 1, net_points: 90, working_days_pct: 1 },
  { function_name: 'Customer Care', employee_name: 'Bob',   employee_no: '10002', user_id_login: 'bob',   team_leader: 'TL1', function_rank: 2, net_points: 80, working_days_pct: 1 },
];

/** Mock DataSource that faithfully simulates Postgres `employee_no = ANY($n)` scoping. */
function makeDs() {
  return {
    query: jest.fn(async (sql: string, params: any[]) => {
      if (/FROM scorecard_batches/.test(sql)) return [{ period_name: 'May 2026' }];
      if (/FROM employees/.test(sql)) return [];               // resolveScope team lookup (unused here)
      if (/FROM scorecard_entries/.test(sql)) {
        if (/se\.employee_no = ANY/.test(sql)) {
          const empNos = params[params.length - 1] as string[]; // scope param is pushed last
          return FIXTURE.filter((r) => empNos.includes(r.employee_no));
        }
        return FIXTURE;
      }
      return [];
    }),
  };
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** Data-row count (excluding the header row) inside the exported workbook. */
async function exportedDataRowCount(sf: any): Promise<number> {
  const buf = await streamToBuffer(sf.getStream());
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
  return aoa.length - 1; // minus the header
}

describe('ScorecardController.exportBatch — row-level scope (IDOR)', () => {
  const batchId = 'b-1';
  const res = { set: jest.fn() };

  it('agent-scoped caller (empNos=[]) exports ZERO rows', async () => {
    const ds = makeDs();
    const c = new ScorecardController(ds as any, {} as any, {} as any, {} as any);
    // Agent: view_own only, no linked employee → resolveScope returns empNos=[]
    const agent = { tenantId: 't1', employeeId: null, permissionCodes: ['scorecard.view_own'] };
    const sf = await c.exportBatch(batchId, agent, 'Final', res as any);
    expect(await exportedDataRowCount(sf)).toBe(0);
    // The entries query MUST have carried the scope filter.
    const entriesCall = ds.query.mock.calls.find((c: any[]) => /FROM scorecard_entries/.test(c[0]));
    expect(entriesCall![0]).toMatch(/se\.employee_no = ANY/);
  });

  it('admin (scorecard.view_all) exports ALL rows, no scope filter', async () => {
    const ds = makeDs();
    const c = new ScorecardController(ds as any, {} as any, {} as any, {} as any);
    const admin = { tenantId: 't1', employeeId: 'e-admin', permissionCodes: ['scorecard.view_all'] };
    const sf = await c.exportBatch(batchId, admin, 'Final', res as any);
    expect(await exportedDataRowCount(sf)).toBe(FIXTURE.length);
    const entriesCall = ds.query.mock.calls.find((c: any[]) => /FROM scorecard_entries/.test(c[0]));
    expect(entriesCall![0]).not.toMatch(/se\.employee_no = ANY/);
  });
});
