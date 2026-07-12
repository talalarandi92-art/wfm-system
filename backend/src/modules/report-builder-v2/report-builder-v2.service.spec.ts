/**
 * BUILDER v2 · BLD-5 — SAVED LIBRARY service GATE.
 *
 * Covers the library-management surface with a mocked DataSource (no live DB):
 *   • duplicate  — own OR shared → a fresh PRIVATE copy owned by the caller
 *   • rename     — owner-only (via updateReport/updateDashboard, name-only body)
 *   • share/unshare — owner-only toggle (shared-only body)
 * plus the RBAC guards (a teammate cannot rename/share/delete a shared item).
 */
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { ReportBuilderV2Service } from './report-builder-v2.service';

const TID = 'a0000000-0000-0000-0000-000000000001';
const OWNER = { id: 'u-owner', tenantId: TID, email: 'owner@x.com' };
const OTHER = { id: 'u-other', tenantId: TID, email: 'other@x.com' };

/** a DataSource whose .query is a jest mock we queue results onto (in call order). */
function makeSvc() {
  const query = jest.fn();
  const svc = new ReportBuilderV2Service({ query } as any);
  return { svc, query };
}

describe('ReportBuilderV2Service — saved library (BLD-5)', () => {
  /* ── DUPLICATE REPORT ─────────────────────────────────────────────── */
  it('duplicates a report into a fresh private copy named "… (copy)"', async () => {
    const { svc, query } = makeSvc();
    query
      .mockResolvedValueOnce([{ name: 'My Report', description: 'd', source_key: 'overtime', config: { metrics: ['trueOtMin'] }, viz: 'bar' }]) // SELECT
      .mockResolvedValueOnce([{ id: 'new-rep' }]) // INSERT … RETURNING
      .mockResolvedValueOnce([]);                 // audit
    const out = await svc.duplicateReport(OWNER, 'rep-1');
    expect(out).toEqual({ id: 'new-rep' });
    const insert = query.mock.calls[1];
    expect(insert[0]).toMatch(/INSERT INTO rb_saved_reports/);
    expect(insert[0]).toMatch(/,false\)/);            // copy is always private
    expect(insert[1][2]).toBe('My Report (copy)');    // name param
    expect(insert[1][1]).toBe(OWNER.id);              // owned by the caller
    expect(insert[1][4]).toBe('overtime');            // source preserved
  });

  it('a teammate may duplicate a SHARED report (own-or-shared visibility)', async () => {
    const { svc, query } = makeSvc();
    query
      .mockResolvedValueOnce([{ name: 'Team KPI', description: null, source_key: 'scorecard', config: {}, viz: 'table' }])
      .mockResolvedValueOnce([{ id: 'copy-x' }])
      .mockResolvedValueOnce([]);
    const out = await svc.duplicateReport(OTHER, 'rep-shared');
    expect(out).toEqual({ id: 'copy-x' });
    // the visibility SELECT is scoped to own-or-shared for THIS caller
    expect(query.mock.calls[0][0]).toMatch(/owner_user=\$3 OR shared/);
    expect(query.mock.calls[0][1]).toEqual([TID, 'rep-shared', OTHER.id]);
  });

  it('duplicateReport throws when the report is not visible', async () => {
    const { svc, query } = makeSvc();
    query.mockResolvedValueOnce([]); // SELECT finds nothing
    await expect(svc.duplicateReport(OTHER, 'nope')).rejects.toBeInstanceOf(BadRequestException);
    expect(query).toHaveBeenCalledTimes(1); // never reached INSERT
  });

  /* ── DUPLICATE DASHBOARD ──────────────────────────────────────────── */
  it('duplicates a dashboard into a fresh private copy', async () => {
    const { svc, query } = makeSvc();
    query
      .mockResolvedValueOnce([{ name: 'Ops Board', description: null, sections: [{ id: 's1', name: 'A', widgets: [] }], date_range: null, filters: [] }])
      .mockResolvedValueOnce([{ id: 'new-dash' }])
      .mockResolvedValueOnce([]);
    const out = await svc.duplicateDashboard(OWNER, 'dash-1');
    expect(out).toEqual({ id: 'new-dash' });
    const insert = query.mock.calls[1];
    expect(insert[0]).toMatch(/INSERT INTO rb_saved_dashboards/);
    expect(insert[0]).toMatch(/,false\)/);
    expect(insert[1][2]).toBe('Ops Board (copy)');
    expect(insert[1][1]).toBe(OWNER.id);
  });

  it('duplicateDashboard throws when the dashboard is not visible', async () => {
    const { svc, query } = makeSvc();
    query.mockResolvedValueOnce([]);
    await expect(svc.duplicateDashboard(OTHER, 'nope')).rejects.toBeInstanceOf(BadRequestException);
  });

  /* ── RENAME (owner-only, via updateReport name-only body) ─────────── */
  it('owner can rename a report', async () => {
    const { svc, query } = makeSvc();
    query
      .mockResolvedValueOnce([{ owner_user: OWNER.id }]) // ownership check
      .mockResolvedValueOnce([])                          // UPDATE
      .mockResolvedValueOnce([]);                         // audit
    const out = await svc.updateReport(OWNER, 'rep-1', { name: 'Renamed' });
    expect(out).toEqual({ ok: true });
    const upd = query.mock.calls[1];
    expect(upd[0]).toMatch(/UPDATE rb_saved_reports SET name=COALESCE/);
    expect(upd[1][2]).toBe('Renamed'); // name param
  });

  it('a teammate cannot rename an owner’s report', async () => {
    const { svc, query } = makeSvc();
    query.mockResolvedValueOnce([{ owner_user: OWNER.id }]); // owner != caller
    await expect(svc.updateReport(OTHER, 'rep-1', { name: 'Hijack' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).toHaveBeenCalledTimes(1); // never reached UPDATE
  });

  /* ── SHARE / UNSHARE (owner-only toggle) ──────────────────────────── */
  it('owner can share a report (shared=true persisted)', async () => {
    const { svc, query } = makeSvc();
    query.mockResolvedValueOnce([{ owner_user: OWNER.id }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await svc.updateReport(OWNER, 'rep-1', { shared: true });
    expect(query.mock.calls[1][1][6]).toBe(true); // shared param
  });

  it('owner can unshare a report (shared=false, not treated as “unchanged”)', async () => {
    const { svc, query } = makeSvc();
    query.mockResolvedValueOnce([{ owner_user: OWNER.id }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await svc.updateReport(OWNER, 'rep-1', { shared: false });
    expect(query.mock.calls[1][1][6]).toBe(false); // explicit false reaches SQL (COALESCE-safe)
  });

  it('a teammate cannot share an owner’s dashboard', async () => {
    const { svc, query } = makeSvc();
    query.mockResolvedValueOnce([{ owner_user: OWNER.id }]);
    await expect(svc.updateDashboard(OTHER, 'dash-1', { shared: true })).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('owner can rename a dashboard', async () => {
    const { svc, query } = makeSvc();
    query.mockResolvedValueOnce([{ owner_user: OWNER.id }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const out = await svc.updateDashboard(OWNER, 'dash-1', { name: 'Board 2' });
    expect(out).toEqual({ ok: true });
    expect(query.mock.calls[1][1][2]).toBe('Board 2');
  });
});
