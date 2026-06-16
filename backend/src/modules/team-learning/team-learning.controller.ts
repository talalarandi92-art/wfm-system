import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';

/**
 * Team Learning report — what each guard LEARNED over time, and the experiences /
 * knowledge they handed to EACH OTHER. Learnings are pulled from the real adaptive
 * stores (analyst thresholds, decisions, auto-mode actions, coaching flags); the
 * exchanges are the live collaboration edges between guards, with real evidence
 * counts where we have them.
 */
@ApiTags('Team Learning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'team-learning', version: '1' })
export class TeamLearningController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'What each guard learned + experiences exchanged between guards' })
  async report(@CurrentUser() u: any) {
    const tid = u.tenantId;
    const one = async (sql: string): Promise<any> => this.ds.query(sql, [tid]).then(r => r[0] ?? {}).catch(() => ({}));
    const many = async (sql: string): Promise<any[]> => this.ds.query(sql, [tid]).catch(() => []);

    const thresholds = await many(`SELECT key, value::float v, samples FROM analyst_thresholds WHERE tenant_id = $1`);
    const decided = await one(`SELECT COUNT(*)::int n FROM analyst_recommendations WHERE tenant_id = $1 AND decision <> 'pending'`);
    const am = await one(`SELECT COUNT(*) FILTER (WHERE decision='approve' AND NOT reverted)::int approved,
                                  COUNT(*) FILTER (WHERE decision='reject' AND NOT reverted)::int rejected,
                                  COUNT(*) FILTER (WHERE decision='hold')::int held FROM automode_decisions WHERE tenant_id = $1`);
    const flags = await many(`SELECT trigger_type, COUNT(*)::int n FROM coaching_flags WHERE tenant_id = $1 GROUP BY trigger_type`);
    const reports = await one(`SELECT COUNT(*)::int n FROM report_runs WHERE tenant_id = $1`);

    const flagOf = (t: string) => flags.find(f => f.trigger_type === t)?.n ?? 0;
    const scoreFlags = flagOf('low_scorecard');
    const attendanceFlags = flagOf('repeated_late') + flagOf('repeated_early_out') + flagOf('missing_punch');
    const samples = thresholds.reduce((s, t) => s + (t.samples || 0), 0);
    const surplus = thresholds.find(t => t.key === 'surplus_safe');

    // ── What each guard learned ───────────────────────────────────────────────
    const learnings = [
      {
        guard: 'المحلّل', guardEn: 'Analyst', icon: 'brain',
        learned: 'يضبط عتبة الفائض الآمن من قبولك/رفضك لتوصياته',
        metric: surplus ? `عتبة الفائض الآمن = ${surplus.v} (تعلّم من ${surplus.samples} قرار)` : 'العتبة الافتراضية = 2 (ما عدّلها بعد)',
        more: `${decided.n ?? 0} توصية راجعتها وتغذّى منها`,
        ready: !surplus,
      },
      {
        guard: 'الوضع التلقائي', guardEn: 'Auto Mode', icon: 'zap',
        learned: 'يوافق فقط عند الفائض الآمن ويحتجز الباقي للمراجعة',
        metric: `${am.approved ?? 0} موافقة · ${am.rejected ?? 0} رفض · ${am.held ?? 0} احتجاز (سلوك محافظ)`,
        more: 'كل قرار مُسجّل وقابل للتراجع',
      },
      {
        guard: 'حارس السكور كارد', guardEn: 'Scorecard Guard', icon: 'award',
        learned: 'يحدّد مين تحت متوسّط قسمه ويحوّله لكوتشينج',
        metric: `${scoreFlags} موظف مرشّح للكوتشينج`,
        more: 'يربط الأداء الضعيف بالتطوير تلقائياً',
      },
      {
        guard: 'محرّك الكوتشينج', guardEn: 'Coaching', icon: 'grad',
        learned: 'يكتشف أنماط الحضور المتكرّرة',
        metric: `${flagOf('repeated_late')} تأخّر · ${flagOf('repeated_early_out')} خروج مبكّر · ${flagOf('missing_punch')} بصمة ناقصة`,
        more: `${attendanceFlags} نمط مكتشف إجمالاً`,
      },
      {
        guard: 'السلامة + الأمني', guardEn: 'Health + Security', icon: 'shield',
        learned: 'يتتبّعان خط الأساس الطبيعي ليميّزا الضجيج عن المشكلة',
        metric: 'فحوصات قطعية + اتجاه زمني (بلا ML — تكيّف بالعتبات)',
        more: 'ينبّهان عند الانحراف عن الطبيعي',
      },
    ];

    // ── Experiences/knowledge handed between guards ───────────────────────────
    const exchanges = [
      { from: 'حارس السلامة', to: 'المحلّل', knowledge: 'فحوصات سلامة الجدول (إناث/راحة/سياسة الفنكشن)', evidence: null },
      { from: 'المحلّل', to: 'الوضع التلقائي', knowledge: 'أحكام التغطية لكل فنكشن — قادت القرارات الآلية', evidence: `${(am.approved ?? 0) + (am.rejected ?? 0) + (am.held ?? 0)} قرار` },
      { from: 'المحلّل', to: 'الناشر', knowledge: 'تقييم التغطية/الكيوز/الالتزام', evidence: `${reports.n ?? 0} تقرير` },
      { from: 'المحلّل', to: 'الرئيس + المستشار + الخبير', knowledge: 'السياق اللحظي للعمليات', evidence: null },
      { from: 'حارس السكور كارد', to: 'محرّك الكوتشينج', knowledge: 'مرشّحو الكوتشينج (تحت الهدف)', evidence: `${scoreFlags} مرشّح` },
      { from: 'الباحث', to: 'المستشار + الرئيس', knowledge: 'فجوات مقابل أفضل ممارسات الصناعة', evidence: null },
      { from: 'كل الحرّاس', to: 'الرئيس', knowledge: 'الوضع العام والأولويات الموحّدة', evidence: null },
    ];

    return {
      summary: {
        learnedSamples: samples,
        decisionsReviewed: decided.n ?? 0,
        autoActed: (am.approved ?? 0) + (am.rejected ?? 0) + (am.held ?? 0),
        coachingHandedOver: scoreFlags + attendanceFlags,
        reports: reports.n ?? 0,
      },
      learnings,
      exchanges,
    };
  }
}
