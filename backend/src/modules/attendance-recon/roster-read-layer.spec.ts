import * as fs from 'fs';
import * as path from 'path';
import { MATERNITY_7H, TRUE_OT, CRED_LATE, CRED_EARLY } from '@common/wfm-metrics';
import { RosterReportsController } from './roster-reports.controller';
import { monthKpiPoint } from './roster-analytics.controller';

/**
 * Stage-3A roster READ/REPORT-layer correctness spec.
 *  (A) Canonical-metric AUDIT ASSERTIONS — the invariants every roster_days report
 *      must obey (TRUE_OT 3-bucket, credible-tardiness 7..240, maternity exclusion,
 *      reports read roster_days NOT the thin legacy roster_daily).
 *  (B) NEW GET roster-v2/data-quality — flag-taxonomy consistency.
 *  (C) NEW GET roster-v2/trends?months — the per-month KPI point math.
 * DB-free: constants, exported pure helpers, and static source guards only.
 */
describe('Stage-3A roster read-layer', () => {
  const dir = __dirname;
  const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');

  // ── (A) canonical metric audit assertions ────────────────────────────────
  describe('canonical metric constants (audit assertions)', () => {
    it('TRUE_OT sums the THREE disjoint OT buckets (never ot_min alone)', () => {
      expect(TRUE_OT).toContain('ot_min');
      expect(TRUE_OT).toContain('offday_ot_min');
      expect(TRUE_OT).toContain('holiday_ot_min');
    });
    it('CRED_LATE / CRED_EARLY use the 7..240 credible window', () => {
      expect(CRED_LATE).toContain('BETWEEN 7 AND 240');
      expect(CRED_EARLY).toContain('BETWEEN 7 AND 240');
    });
    it('CRED_EARLY excludes the maternity-7h people; MATERNITY_7H is the two ids', () => {
      expect(MATERNITY_7H).toContain('12375');
      expect(MATERNITY_7H).toContain('12434');
      expect(CRED_EARLY).toContain(MATERNITY_7H);
      expect(CRED_EARLY).toContain('NOT IN');
    });
  });

  describe('reports read roster_days, never the thin legacy roster_daily', () => {
    const reportFiles = [
      'roster-reports.controller.ts', 'roster-analytics.controller.ts',
      'roster-hourly.controller.ts', 'schedule-ops.controller.ts',
      'wfh-report.controller.ts', 'roster-fairness.controller.ts',
    ];
    it.each(reportFiles)('%s selects FROM roster_days and not roster_daily', (f) => {
      const src = read(f);
      expect(src).toMatch(/roster_days/);
      expect(src).not.toMatch(/roster_daily/);
    });
    it('the report/analytics controllers import the shared @common/wfm-metrics consts', () => {
      expect(read('roster-reports.controller.ts')).toContain("from '@common/wfm-metrics'");
      expect(read('roster-analytics.controller.ts')).toContain("from '@common/wfm-metrics'");
      expect(read('schedule-ops.controller.ts')).toMatch(/CRED_LATE|CRED_EARLY|wfm-metrics/);
    });
    it('the two new routes exist at the expected paths', () => {
      expect(read('roster-reports.controller.ts')).toContain("@Get('roster-v2/data-quality')");
      expect(read('roster-analytics.controller.ts')).toContain("@Get('roster-v2/trends')");
      expect(read('roster-analytics.controller.ts')).toContain("@Query('months')");
    });
  });

  // ── (B) data-quality flag taxonomy ───────────────────────────────────────
  describe('roster-v2/data-quality taxonomy', () => {
    const meta = (RosterReportsController as any).DQ_META as Record<string, { severity: string; label: string }>;
    const catSql = (RosterReportsController as any).DQ_CAT as string;
    const reviewSet = (RosterReportsController as any).DQ_REVIEW_SET as string;

    it('every category emitted by the CASE has a DQ_META entry', () => {
      const emitted = [...catSql.matchAll(/THEN '([a-z-]+)'/g)].map((m) => m[1]);
      expect(emitted.length).toBeGreaterThan(8);
      for (const c of emitted) expect(meta[c]).toBeDefined();
    });
    it('severity is strictly review | info', () => {
      for (const v of Object.values(meta)) expect(['review', 'info']).toContain(v.severity);
    });
    it('the engine-handled categories are INFO (excluded from the review score)', () => {
      expect(meta['tardiness-bleed-capped'].severity).toBe('info');
      expect(meta['ot-record-only'].severity).toBe('info');
      expect(meta['transfer-marker'].severity).toBe('info');
    });
    it('actionable gaps are REVIEW', () => {
      for (const c of ['missing-punch', 'missing-system', 'missing-both', 'no-show', 'punch-system-mismatch', 'shift-mismatch', 'off-worked-review'])
        expect(meta[c].severity).toBe('review');
    });
    it('DQ_REVIEW_SET exactly matches the review-severity categories', () => {
      const inSet = [...reviewSet.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
      const reviewCats = Object.entries(meta).filter(([, v]) => v.severity === 'review').map(([k]) => k).sort();
      expect(inSet).toEqual(reviewCats);
    });
    it('clean-% uses TRUE_OT for the OT>300 watch and reads roster_days', () => {
      const src = read('roster-reports.controller.ts');
      expect(src).toMatch(/\(\$\{TRUE_OT\}\) > 300|\(\$\{RosterReportsController[^)]*\)/);
      expect(src).toContain('> 300');
    });
  });

  // ── (C) trends month-point math ──────────────────────────────────────────
  describe('roster-v2/trends monthKpiPoint (per-function MoM)', () => {
    const full = { ym: '2026-05', mn: '2026-05-01', mx: '2026-05-31',
      agents: 20, worked: 400, wfh: 100, absent: 8, sick: 12, latedays: 40, tardy_base: 380, ot_hrs: 120.5, conf: 96.3, res_ter: 2, transfers: 0 };

    it('computes percentages from raw counts', () => {
      const pt = monthKpiPoint(full, '2026-07-03');
      expect(pt.wfhPct).toBe(25);                       // 100/400
      expect(pt.tardyPct).toBeCloseTo(10.5, 1);          // 40/380
      expect(pt.absencePct).toBeCloseTo(1.9, 1);         // 8/(400+8+12)
      expect(pt.conformancePct).toBe(96.3);
      expect(pt.otHours).toBe(120.5);
      expect(pt.resTer).toBe(2);
    });
    it('a fully-covered month is not partial', () => {
      expect(monthKpiPoint(full, '2026-07-03').partial).toBe(false);
    });
    it('a month whose data ends before month-end (and before today) is partial', () => {
      const july = { ...full, ym: '2026-07', mn: '2026-07-01', mx: '2026-07-03' };
      expect(monthKpiPoint(july, '2026-07-21').partial).toBe(true);   // Jul data stops on the 3rd, today is the 21st
    });
    it('the latest month is not partial merely because month-end is in the future', () => {
      const july = { ...full, ym: '2026-07', mn: '2026-07-01', mx: '2026-07-03' };
      expect(monthKpiPoint(july, '2026-07-03').partial).toBe(false);  // cap = last data day = mx → fully covered up to cap
    });
    it('a month starting after the 1st is partial', () => {
      const midStart = { ...full, mn: '2026-05-10' };
      expect(monthKpiPoint(midStart, '2026-07-03').partial).toBe(true);
    });
    it('guards divide-by-zero (no worked days → 0%, not NaN)', () => {
      const empty = { ...full, worked: 0, wfh: 0, absent: 0, sick: 0, latedays: 0, tardy_base: 0 };
      const pt = monthKpiPoint(empty, '2026-07-03');
      expect(pt.wfhPct).toBe(0); expect(pt.tardyPct).toBe(0); expect(pt.absencePct).toBe(0);
    });
  });
});
