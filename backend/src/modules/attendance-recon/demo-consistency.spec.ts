import * as fs from 'fs';
import * as path from 'path';

/**
 * DEMO CONSISTENCY GUARDS — static assertions that the presentation surfaces cannot
 * silently drift apart again.
 *
 * These are source-level guards, not DB tests, on purpose: they fail at build time,
 * in the verify gate, the moment someone reintroduces one of the specific mistakes
 * that were found while hardening the system for the Sunday presentation. Each one
 * exists because the mistake was REAL, not hypothetical.
 */
describe('demo consistency guards', () => {
  const be = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8');
  const fe = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', p), 'utf8');

  describe('OT is ONE number across the roster module (dashboard principle P-3)', () => {
    /* Found live: the roster dashboard summed ALL OT (16,440h) while the OT &
       Exceptions report showed payable OT (16,388h) for the identical period.
       Two roster screens, two totals — exactly what P-3 forbids. */
    it('the dashboard summary excludes supervisory record-only OT, like the report', () => {
      const src = be('roster-reports.controller.ts');
      const line = src.split('\n').find((l) => l.includes('ot_total'));
      expect(line).toBeDefined();
      expect(line).toContain('NOT COALESCE(ot_record_only,false)');
    });
    it('the record-only minutes are still returned, so the difference is visible not hidden', () => {
      expect(be('roster-reports.controller.ts')).toContain('ot_record_only_min');
    });
    it('the OT report itself still filters on the same rule', () => {
      const src = be('schedule-ops.controller.ts');
      expect(src).toContain('NOT COALESCE(ot_record_only,false)');
      expect(src).toContain('AND is_active');
    });
  });

  describe('every date-driven screen lands on data that exists', () => {
    /* Found live on 2026-07-24: the roster spine ended 2026-07-03, and the Roster
       page hard-coded a June window while Capacity asked for "today" via
       toISOString. One was frozen, the other opened blank — over 19,295 rows. */
    it('the data-span service exists and reports the real coverage', () => {
      const src = be('data-span.service.ts');
      expect(src).toContain('latestDay');
      expect(src).toContain('latestFullWeek');
      expect(src).toContain('daysBehind');
      expect(src).toContain('FROM roster_days');
    });
    it('no demo page hard-codes a literal date range', () => {
      for (const p of ['pages/Roster.tsx', 'pages/Capacity.tsx']) {
        const src = fe(p);
        const literals = src.match(/useState\(\s*'20\d{2}-\d{2}-\d{2}'\s*\)/g) || [];
        expect(literals).toEqual([]);
      }
    });
    it('Capacity computes "today" with the local-safe helper, never toISOString', () => {
      const src = fe('pages/Capacity.tsx');
      expect(src).toContain('fmtLocalDate(new Date())');
      // BR-TIM-001: toISOString() is UTC and names the wrong day in Kuwait (+03:00)
      expect(src).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
    });
  });

  describe('OT is the same definition on EVERY surface, not just the roster', () => {
    /* Audited live: ot-exceptions, roster-dashboard, control-dashboard and
       reports/overtime all answered 16,388.4h for the same period only after
       these four were repointed. Three of them read attendance_records, whose
       single ot_minutes column structurally cannot reach TRUE_OT (~28% short). */
    const otSurfaces: [string, string][] = [
      ['../reports/reports.controller.ts', 'the exported OT ranking'],
      ['../control-dashboard/control-dashboard.controller.ts', 'the executive OT tile'],
    ];
    it.each(otSurfaces)('%s uses TRUE_OT over roster_days', (rel) => {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      expect(src).toContain('TRUE_OT');
      expect(src).toContain('roster_days');
      // and must not fall back to the thin single-column source for OT
      expect(src).not.toMatch(/SUM\(\s*(ar\.)?ot_minutes\s*\)/);
    });
  });

  describe('tardiness is 7..240 minutes everywhere it can punish someone', () => {
    /* `> 0` meant a ONE-MINUTE lateness counted, and with no upper bound a
       cross-midnight punch read as a four-hour lateness. Measured: 1,710 → 1,149
       late-days, 100 → 89 people. Coaching writes real HR flags off this. */
    const surfaces: [string, string][] = [
      ['../coaching/coaching.service.ts', 'coaching flags + manager notifications'],
      ['../operations-analytics/people-insights.service.ts', 'People 360'],
      ['../reports/reports.controller.ts', 'the exported Late ranking'],
    ];
    it.each(surfaces)('%s never counts a sub-7-minute lateness', (rel) => {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      expect(src).not.toMatch(/punch_late_minutes\s*>\s*0/);
      expect(src).not.toMatch(/punch_early_out_minutes\s*>\s*0/);
    });
  });

  describe('nobody is judged on a score that was never given', () => {
    it('the scorecard guard excludes unscored rows from every aggregate', () => {
      const src = fs.readFileSync(path.join(__dirname, '../scorecard-guard/scorecard-guard.service.ts'), 'utf8');
      // NULL net_points must not become 0 — that put unscored agents in `bottom`
      // and wrote them a real coaching_flags row.
      expect(src).not.toContain('Number(r.net_points ?? 0)');
      expect(src).toContain('rows.filter(r => r.net_points != null)');
      // an unevaluated KPI cannot be someone's "weakest"
      expect(src).toContain('if (r[s.f] == null) continue;');
    });
  });

  describe('an absent input never renders as a measurement', () => {
    /* Found live: Live Monitoring showed "Punched / scheduled: 0 / 0" on a date with
       no published roster — which reads as "the entire team failed to show up". */
    const surfaces = ['pages/rta/CommandCenter.tsx', 'pages/rta/WallboardPanels.tsx', 'pages/rta/StationPanels.tsx'];
    it.each(surfaces)('%s distinguishes "no roster" from "nobody attended"', (p) => {
      const src = fe(p);
      expect(src).toMatch(/no roster|not published/i);
    });
  });
});
