import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { HealthGuardService } from '@modules/health-guard/health-guard.service';
import { AnalystService } from '@modules/analyst/analyst.service';
import { ReporterService } from '@modules/reporter/reporter.service';
import { AdvisorService } from '@modules/advisor/advisor.service';
import { SecurityGuardService } from '@modules/security-guard/security-guard.service';
import { ExpertService } from '@modules/expert/expert.service';
import { ScorecardGuardService } from '@modules/scorecard-guard/scorecard-guard.service';
import { ResearcherService } from '@modules/researcher/researcher.service';

/**
 * Bots Hub — the unified "team" view over the four guards. One call returns each
 * guard's live status plus a merged recent-activity feed, so the operator manages
 * the whole team from one place.
 */
@ApiTags('Bots Hub')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'bots', version: '1' })
export class BotsController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly health: HealthGuardService,
    private readonly analyst: AnalystService,
    private readonly reporter: ReporterService,
    private readonly advisor: AdvisorService,
    private readonly security: SecurityGuardService,
    private readonly expert: ExpertService,
    private readonly scorecard: ScorecardGuardService,
    private readonly researcher: ResearcherService,
  ) {}

  @Get('team')
  @ApiOperation({ summary: 'Status of all guards + merged activity feed' })
  async team(@CurrentUser() u: any) {
    const tid = u.tenantId;

    const [health, assess, runs, recipes, sec] = await Promise.all([
      this.health.run(tid).catch(() => null),
      this.analyst.assess(tid).catch(() => null),
      this.reporter.listRuns(tid, 1).catch(() => []),
      this.reporter.listRecipes(tid).catch(() => []),
      this.security.run(tid).catch(() => null),
    ]);

    const pendingRecs = await this.ds.query(
      `SELECT COUNT(*)::int n FROM analyst_recommendations WHERE tenant_id = $1 AND decision = 'pending'`, [tid],
    ).then((r: any) => r?.[0]?.n ?? 0).catch(() => 0);
    const learnedSamples = await this.ds.query(
      `SELECT COALESCE(SUM(samples),0)::int n FROM analyst_thresholds WHERE tenant_id = $1`, [tid],
    ).then((r: any) => r?.[0]?.n ?? 0).catch(() => 0);

    const scheduled = (recipes as any[]).filter(r => r.enabled && r.schedule_time);
    const advisorStatus = this.advisor.status();
    const advisorEnabled = advisorStatus.configured;
    const expertStatus = this.expert.status();
    const [scoreSummary, researchStatus] = await Promise.all([
      this.scorecard.summary(tid).catch(() => null),
      Promise.resolve(this.researcher.status()),
    ]);

    const guards = [
      {
        key: 'health', name: 'حارس السلامة والصحّة', nameEn: 'Health & Integrity', route: '/system-health',
        status: health ? health.status : 'skip', enabled: true,
        metrics: health ? { score: health.score, pass: health.counts.pass, warn: health.counts.warn, fail: health.counts.fail } : null,
        line: health ? `درجة ${health.score}% · ${health.counts.fail} فشل · ${health.counts.warn} تحذير` : 'غير متاح',
      },
      {
        key: 'analyst', name: 'المحلّل الذكي', nameEn: 'WFM/RTA Analyst', route: '/analyst',
        status: assess ? assess.headline : 'skip', enabled: true,
        metrics: assess ? { pendingRecs, learnedSamples, surplusSafe: assess.thresholds.surplusSafe } : null,
        line: assess ? `الوضع ${sevAr(assess.headline)} · ${pendingRecs} توصية معلّقة · تعلّم ${learnedSamples} مرة` : 'غير متاح',
      },
      {
        key: 'reporter', name: 'الناشر', nameEn: 'Reporting Bot', route: '/reports-bot',
        status: (runs as any[]).length ? 'ok' : 'info', enabled: true,
        metrics: { lastRun: (runs as any[])[0] ?? null, recipes: (recipes as any[]).length, scheduled: scheduled.length },
        line: (runs as any[]).length ? `آخر تقرير: ${(runs as any[])[0].summary}` : 'لا تقارير بعد',
      },
      {
        key: 'security', name: 'الحارس الأمني', nameEn: 'Security Guard', route: '/security-guard',
        status: sec ? sec.status : 'skip', enabled: true,
        metrics: sec ? { score: sec.score, pass: sec.counts.pass, warn: sec.counts.warn, fail: sec.counts.fail } : null,
        line: sec ? `درجة ${sec.score}% · ${sec.counts.fail} خطر · ${sec.counts.warn} تنبيه` : 'غير متاح',
      },
      {
        key: 'scorecard', name: 'حارس السكور كارد', nameEn: 'Scorecard Guard', route: '/scorecard-guard',
        status: scoreSummary && scoreSummary.belowTarget > 0 ? 'caution' : 'ok', enabled: true,
        metrics: scoreSummary,
        line: scoreSummary?.week ? `${scoreSummary.week} · متوسّط ${scoreSummary.avg} · ${scoreSummary.belowTarget} تحت الهدف` : 'لا بيانات سكور كارد',
      },
      {
        key: 'researcher', name: 'الباحث', nameEn: 'Researcher', route: '/researcher',
        status: 'info', enabled: true,
        metrics: { items: researchStatus.items, gaps: researchStatus.gaps, llm: researchStatus.configured },
        line: `${researchStatus.items} بحث · ${researchStatus.gaps} فجوة مقابل الصناعة` + (researchStatus.configured ? '' : ' · بحث منسّق'),
      },
      {
        key: 'expert', name: 'المستشار الخبير', nameEn: 'Expert Advisor', route: '/expert',
        status: 'ok', enabled: true,
        metrics: { topics: expertStatus.topics, llm: expertStatus.configured },
        line: `قاعدة معرفة ${expertStatus.topics} موضوع` + (expertStatus.configured ? ` · ${expertStatus.model}` : ' · وضع معرفي'),
      },
      {
        key: 'advisor', name: 'المستشار', nameEn: 'LLM Advisor', route: '/advisor',
        status: advisorEnabled ? 'ok' : 'skip', enabled: advisorEnabled,
        metrics: { needsKey: !advisorEnabled, model: advisorStatus.model },
        line: advisorEnabled ? `جاهز · ${advisorStatus.model}` : 'يحتاج مفتاح LLM — يعمل بوضع مبسّط',
      },
    ];

    const feed = await this.ds.query(
      `SELECT notification_type AS type, COALESCE(title_ar, title) AS title, COALESCE(body_ar, body) AS body,
              action_url, created_at
         FROM notifications
        WHERE tenant_id = $1 AND notification_type IN ('health_guard','security_guard','report_ready','sla_escalation','coaching')
        ORDER BY created_at DESC LIMIT 15`, [tid]).catch(() => []);

    return { guards, feed };
  }
}

function sevAr(s: string) {
  return s === 'risk' ? 'خطر' : s === 'caution' ? 'انتباه' : s === 'ok' ? 'سليم' : 'معلومة';
}
