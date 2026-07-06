import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { HealthGuardService } from '@modules/health-guard/health-guard.service';
import { SecurityGuardService } from '@modules/security-guard/security-guard.service';
import { AnalystService } from '@modules/analyst/analyst.service';
import { SmokeTestService } from '@modules/smoke-test/smoke-test.service';

/**
 * Diagnostics digest — one consolidated, technical list of every problem the
 * guards have discovered (health, security, functional smoke test, schedule-rule
 * violations), detailed enough to hand off for a fix. The bot DETECTS + DESCRIBES;
 * a human applies the fix (the bot never edits/deploys code itself).
 */
@ApiTags('Diagnostics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('audit.view')   // deny-by-default flip 2026-07-06 — exposes security/health posture
@Controller({ path: 'diagnostics', version: '1' })
export class DiagnosticsController {
  constructor(
    private readonly health: HealthGuardService,
    private readonly security: SecurityGuardService,
    private readonly analyst: AnalystService,
    private readonly smoke: SmokeTestService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Consolidated issues report (add ?smoke=1 to also run the functional smoke test)' })
  async report(@CurrentUser() user: any, @Query('smoke') smokeQ?: string, @Query('lang') langQ?: string) {
    const tid = user.tenantId;
    const lang: 'ar' | 'en' = langQ === 'en' ? 'en' : 'ar';
    const L = (en: string, ar: string) => (lang === 'en' ? en : ar);
    const issues: { source: string; area: string; severity: 'fail' | 'warn' | 'info'; title: string; detail: string }[] = [];

    const [h, s, assess] = await Promise.all([
      this.health.run(tid).catch(() => null),
      this.security.run(tid, lang).catch(() => null),
      this.analyst.assess(tid, undefined, lang).catch(() => null),
    ]);

    // Health guard (technical + calculation integrity)
    if (h) for (const c of h.checks.filter(c => c.status === 'fail' || c.status === 'warn'))
      issues.push({ source: L('Health Guard', 'حارس السلامة'), area: c.category, severity: c.status as any, title: lang === 'en' ? c.label : c.labelAr, detail: c.detail + (c.count ? ` (${c.count})` : '') });

    // Security guard
    if (s) for (const c of s.checks.filter(c => c.status === 'fail' || c.status === 'warn'))
      issues.push({ source: L('Security Guard', 'الحارس الأمني'), area: c.category, severity: c.status as any, title: lang === 'en' ? c.label : c.labelAr, detail: c.detail + (c.count ? ` (${c.count})` : '') });

    // Schedule-rule violations from the analyst
    if (assess) for (const f of assess.schedule.findings)
      issues.push({ source: L('Analyst', 'المحلّل'), area: 'schedule', severity: f.status === 'fail' ? 'fail' : 'warn', title: lang === 'en' ? f.label : f.labelAr, detail: `${f.count}: ${f.detail}` });

    // Functional smoke test (only when asked — it runs a real generate)
    let smokeSummary: any = null;
    if (smokeQ === '1') {
      const sm = await this.smoke.run(tid, user.id ?? user.sub).catch(() => null);
      if (sm) {
        smokeSummary = { passed: sm.passed, total: sm.total };
        for (const p of sm.probes.filter(p => !p.ok))
          issues.push({ source: L('Functional smoke test', 'الاختبار الوظيفي'), area: p.area, severity: 'fail', title: (lang === 'en' && (p as any).label) ? (p as any).label : p.labelAr, detail: p.error ?? L('Path failed', 'فشل المسار') });
      }
    }

    const order = { fail: 0, warn: 1, info: 2 };
    issues.sort((a, b) => order[a.severity] - order[b.severity]);

    return {
      generatedAt: new Date().toISOString(),
      counts: { fail: issues.filter(i => i.severity === 'fail').length, warn: issues.filter(i => i.severity === 'warn').length },
      healthScore: h?.score ?? null,
      securityScore: s?.score ?? null,
      smoke: smokeSummary,
      issues,
    };
  }
}
