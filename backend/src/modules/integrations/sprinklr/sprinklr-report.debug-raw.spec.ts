import { SprinklrReportService } from './sprinklr-report.service';

/**
 * TEMP debug-capture (shape discovery) tests. A report with report_type='debug_raw' must be
 * STORED into sprinklr_report_staging as-is and NEVER parsed/promoted — it exists only so we can
 * see the real reportingQuery / label-metadata JSON before fixing the agent_summary parser.
 */
describe('debug_raw — store-only capture (service, mocked DataSource)', () => {
  function mockDs() {
    const calls: { sql: string; params: any[] }[] = [];
    const ds: any = {
      query: jest.fn(async (sql: string, params: any[]) => {
        calls.push({ sql, params });
        // staging INSERT ... RETURNING id → return a row so it counts as staged
        if (/INSERT INTO sprinklr_report_staging/.test(sql)) return [{ id: 1 }];
        return [];
      }),
    };
    return { ds, calls };
  }

  it('stages a debug_raw payload and does NOT promote', async () => {
    const { ds, calls } = mockDs();
    const svc = new SprinklrReportService(ds);

    const res = await svc.ingestReports('tenant-1', [
      { reportType: 'debug_raw', sourceOp: 'queries', url: 'https://x.sprinklr.com/api?op=queries',
        rawPayload: JSON.stringify({ reportingQuery: { foo: 1 } }) },
    ]);

    expect(res.staged).toBe(1);
    expect(res.promoted).toBe(0);
    expect(res.byType).toEqual({ debug_raw: 1 });

    // exactly one staging INSERT, typed debug_raw, row_count 0
    const stagingInserts = calls.filter(c => /INSERT INTO sprinklr_report_staging/.test(c.sql));
    expect(stagingInserts).toHaveLength(1);
    // params: [tenant, source_op, payloadJson, hash, capturedAtOrNull]
    const p = stagingInserts[0].params;
    expect(p[0]).toBe('tenant-1');
    expect(p[1]).toBe('queries');
    expect(JSON.parse(p[2]).rawPayload).toContain('reportingQuery');
    expect(stagingInserts[0].sql).toMatch(/report_type, source_op/);
    expect(stagingInserts[0].sql).toMatch(/ON CONFLICT \(tenant_id, report_type, content_hash\) DO NOTHING/);

    // NO promotion — agent_daily_stats is never touched for debug_raw
    const promotions = calls.filter(c => /INSERT INTO agent_daily_stats/.test(c.sql));
    expect(promotions).toHaveLength(0);
  });

  it('skips a debug_raw report with no rawPayload', async () => {
    const { ds, calls } = mockDs();
    const svc = new SprinklrReportService(ds);

    const res = await svc.ingestReports('tenant-1', [{ reportType: 'debug_raw', sourceOp: 'queries' }]);

    expect(res.staged).toBe(0);
    expect(res.skipped).toBe(1);
    expect(calls.filter(c => /INSERT INTO sprinklr_report_staging/.test(c.sql))).toHaveLength(0);
  });

  it('accepts a debug_raw payload supplied via rawSample (fallback field)', async () => {
    const { ds, calls } = mockDs();
    const svc = new SprinklrReportService(ds);

    const res = await svc.ingestReports('tenant-1', [
      { reportType: 'debug_raw', sourceOp: 'fetchTargetMetric', rawSample: '{"metricLabels":{"M_OFFERED":"Offered"}}' },
    ]);

    expect(res.staged).toBe(1);
    expect(res.promoted).toBe(0);
    const p = calls.find(c => /INSERT INTO sprinklr_report_staging/.test(c.sql))!.params;
    expect(JSON.parse(p[2]).rawPayload).toContain('M_OFFERED');
  });
});
