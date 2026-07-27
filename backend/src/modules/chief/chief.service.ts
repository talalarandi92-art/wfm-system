import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LlmService } from '@modules/llm/llm.service';
import { HealthGuardService } from '@modules/health-guard/health-guard.service';
import { AnalystService } from '@modules/analyst/analyst.service';
import { SecurityGuardService } from '@modules/security-guard/security-guard.service';
import { ReporterService } from '@modules/reporter/reporter.service';
import { AdvisorService } from '@modules/advisor/advisor.service';
import { AutoModeService } from '@modules/automode/automode.service';
import { ScorecardGuardService } from '@modules/scorecard-guard/scorecard-guard.service';
import { kwToday } from '@common/kw-date';

/**
 * The Chief — sits above the whole team. It reads every guard (health, analyst,
 * security, reporter) plus the analyst's accumulated learning, then synthesizes a
 * single executive posture + a cross-cutting, prioritized directive list. It is
 * the one place a leader looks to know "what matters right now, across everything".
 * Deterministic synthesis today; full LLM narration when a key is set.
 */

type Sev = 'risk' | 'caution' | 'ok' | 'info';
type Lang = 'ar' | 'en';
const RANK: Record<Sev, number> = { risk: 0, caution: 1, info: 2, ok: 3 };

@Injectable()
export class ChiefService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly llm: LlmService,
    private readonly health: HealthGuardService,
    private readonly analyst: AnalystService,
    private readonly security: SecurityGuardService,
    private readonly reporter: ReporterService,
    private readonly advisor: AdvisorService,
    private readonly automode: AutoModeService,
    private readonly scorecard: ScorecardGuardService,
  ) {}

  // Lightweight self-test: confirm each guard service responds (feature health).
  async selfTest(tid: string) {
    const probes: { name: string; ok: boolean }[] = [];
    const run = async (name: string, fn: () => Promise<any>) => { try { await fn(); probes.push({ name, ok: true }); } catch { probes.push({ name, ok: false }); } };
    await run('health', () => this.health.run(tid));
    await run('analyst', () => this.analyst.assess(tid));
    await run('security', () => this.security.run(tid));
    await run('reporter', () => this.reporter.listRuns(tid, 1));
    await run('automode', () => this.automode.summary(tid));
    await run('scorecard', () => this.scorecard.summary(tid));
    const passed = probes.filter(p => p.ok).length;
    return { passed, total: probes.length, probes };
  }

  async briefing(tid: string, date?: string, lang: Lang = 'ar') {
    const L = (en: string, ar: string) => (lang === 'en' ? en : ar);
    const [health, assess, sec, runs] = await Promise.all([
      this.health.run(tid).catch(() => null),
      this.analyst.assess(tid, date).catch(() => null),
      this.security.run(tid, lang).catch(() => null),
      this.reporter.listRuns(tid, 1).catch(() => []),
    ]);

    const learnedSamples = await this.ds.query(
      `SELECT COALESCE(SUM(samples),0)::int n FROM analyst_thresholds WHERE tenant_id = $1`, [tid],
    ).then((r: any) => r?.[0]?.n ?? 0).catch(() => 0);
    const decided = await this.ds.query(
      `SELECT COUNT(*)::int n FROM analyst_recommendations WHERE tenant_id = $1 AND decision <> 'pending'`, [tid],
    ).then((r: any) => r?.[0]?.n ?? 0).catch(() => 0);

    // ── Domains (each guard's one-line posture) ───────────────────────────────
    const healthSev: Sev = health ? (health.status === 'fail' ? 'risk' : health.status === 'warn' ? 'caution' : 'ok') : 'info';
    const analystSev: Sev = (assess?.headline as Sev) ?? 'info';
    const secSev: Sev = sec ? (sec.status === 'fail' ? 'risk' : sec.status === 'warn' ? 'caution' : 'ok') : 'info';
    const noData = L('No data', 'لا بيانات');
    const domains = [
      { key: 'operations', label: L('Operations', 'العمليات'), sev: analystSev, line: assess ? this.opsLine(assess, lang) : noData },
      { key: 'security', label: L('Security', 'الأمن'), sev: secSev, line: sec ? L(`Score ${sec.score}% · ${sec.counts.fail} risk · ${sec.counts.warn} warning`, `درجة ${sec.score}% · ${sec.counts.fail} خطر · ${sec.counts.warn} تنبيه`) : noData },
      { key: 'system', label: L('System', 'سلامة النظام'), sev: healthSev, line: health ? L(`Score ${health.score}% · ${health.counts.fail} fail`, `درجة ${health.score}% · ${health.counts.fail} فشل`) : noData },
    ];

    // ── Cross-cutting prioritized directives ──────────────────────────────────
    const priorities: { sev: Sev; domain: string; title: string; action: string }[] = [];
    if (assess) {
      for (const f of assess.coverage.functions.filter((x: any) => x.verdict === 'danger'))
        priorities.push({ sev: 'risk', domain: L('Operations', 'العمليات'), title: L(`Coverage shortfall: ${f.functionName}`, `نقص تغطية: ${f.functionName}`), action: L(`Cover ${-f.bottleneck.gap} at ${pad(f.bottleneck.hour)} with overtime/cross-skill and don't approve leave.`, `غطِّ ${-f.bottleneck.gap} عند ${pad(f.bottleneck.hour)} بأوفرتايم/cross-skill ولا توافق إجازات.`) });
      for (const q of assess.queues.queues.slice(0, 3))
        priorities.push({ sev: q.sla < 50 ? 'risk' : 'caution', domain: L('Queues', 'الكيوز'), title: L(`Struggling queue: ${q.name}`, `كيو متعثّر: ${q.name}`), action: L(`SLA ${q.sla}% — route available agents or cut breaks.`, `SLA ${q.sla}% — وجّه المتاحين أو قلّل البريكات.`) });
      if (assess.compliance.offenders.length)
        priorities.push({ sev: 'caution', domain: L('Compliance', 'الالتزام'), title: L(`${assess.compliance.offenders.length} non-compliant today`, `${assess.compliance.offenders.length} غير ملتزم اليوم`), action: L('Warn the latest; repeat offenders → coaching incident.', 'نبّه الأعلى تأخيراً؛ المتكرّرون → إنسيدنت كوتشينج.') });
      for (const c of assess.schedule.findings.filter((x: any) => x.status === 'fail'))
        priorities.push({ sev: 'risk', domain: L('Schedule', 'الجدول'), title: lang === 'en' ? c.label : c.labelAr, action: L('Hard-rule violation — fix before publishing.', 'مخالفة قاعدة صارمة — عدّل قبل النشر.') });
    }
    if (sec) for (const c of sec.checks.filter(c => c.status === 'fail'))
      priorities.push({ sev: 'risk', domain: L('Security', 'الأمن'), title: lang === 'en' ? c.label : c.labelAr, action: c.detail });
    if (health) for (const c of health.checks.filter(c => c.status === 'fail'))
      priorities.push({ sev: 'risk', domain: L('System', 'النظام'), title: lang === 'en' ? c.label : c.labelAr, action: c.detail });
    const reqs = await this.overdueRequests(tid);
    if (reqs > 0) priorities.push({ sev: reqs > 5 ? 'risk' : 'caution', domain: L('Requests', 'الطلبات'), title: L(`${reqs} request(s) past SLA`, `${reqs} طلب متأخّر عن الـ SLA`), action: L('Review and escalate overdue requests now.', 'راجع وصعّد الطلبات المتأخّرة فوراً.') });
    const score = await this.scorecard.summary(tid).catch(() => null);
    if (score && score.belowTarget > 0) priorities.push({ sev: score.belowTarget > 10 ? 'caution' : 'info', domain: L('Performance', 'الأداء'), title: L(`${score.belowTarget} staff below their function average (${score.week})`, `${score.belowTarget} موظف تحت متوسّط قسمه (${score.week})`), action: L(`Weakest function: ${score.worstFunction ?? '—'} — coach the candidates.`, `أضعف قسم: ${score.worstFunction ?? '—'} — وجّه كوتشينج للمرشّحين.`) });

    priorities.sort((a, b) => RANK[a.sev] - RANK[b.sev]);
    const top = priorities.slice(0, 8);

    // ── Overall posture + single directive ────────────────────────────────────
    const posture: Sev = [analystSev, secSev, healthSev].sort((a, b) => RANK[a] - RANK[b])[0];
    const directive = top[0]
      ? L(`Priority #1: ${top[0].title} — ${top[0].action}`, `أولوية رقم 1: ${top[0].title} — ${top[0].action}`)
      : L('No notable risks — keep monitoring.', 'لا مخاطر بارزة — استمرّ بالمراقبة.');

    const [autoMode, selfTest, scorecard] = await Promise.all([
      this.automode.summary(tid).catch(() => null),
      this.selfTest(tid).catch(() => null),
      this.scorecard.summary(tid).catch(() => null),
    ]);

    const base = {
      date: assess?.date ?? date ?? kwToday(),
      posture, directive, domains, priorities: top,
      learning: { learnedSamples, decisionsLogged: decided },
      autoMode, selfTest, scorecard,
      lastReport: (runs as any[])[0] ?? null,
    };

    // LLM executive narration when available.
    if (this.llm.isConfigured()) {
      const sys = lang === 'en'
        ? 'You are the COO of Boutiqaat contact-center operations. Write a short executive brief (3-4 lines) then the single most important decision, in English, in a decisive, numbers-driven leadership tone.'
        : 'أنت الرئيس التنفيذي لعمليات مركز اتصال Boutiqaat. اكتب موجزاً تنفيذياً قصيراً (3-4 أسطر) ثم أهم قرار واحد، بالعربي، بنبرة قيادية حاسمة مرتكزة على الأرقام.';
      const ctx = lang === 'en'
        ? `Overall posture: ${posture}.\nPriorities:\n${top.map((p, i) => `${i + 1}. [${p.domain}] ${p.title} — ${p.action}`).join('\n')}`
        : `الوضع العام: ${posture}.\nالأولويات:\n${top.map((p, i) => `${i + 1}. [${p.domain}] ${p.title} — ${p.action}`).join('\n')}`;
      const text = await this.llm.chat(sys, [{ role: 'user', content: ctx }], 500);
      if (text) return { ...base, llm: true, executiveBrief: text };
    }
    return { ...base, llm: false, executiveBrief: this.templateBrief(posture, top, lang) };
  }

  private opsLine(a: any, lang: Lang = 'ar'): string {
    const danger = a.coverage.functions.filter((f: any) => f.verdict === 'danger').length;
    const q = a.queues.queues.length;
    const off = a.compliance.offenders.length;
    return lang === 'en'
      ? `${danger} function(s) at coverage risk · ${q} queue(s) struggling · ${off} non-compliant`
      : `${danger} قسم بخطر تغطية · ${q} كيو متعثّر · ${off} غير ملتزم`;
  }
  private templateBrief(posture: Sev, top: any[], lang: Lang = 'ar'): string {
    const head = lang === 'en'
      ? (posture === 'risk' ? 'Overall posture: Risk — needs intervention now.' : posture === 'caution' ? 'Overall posture: Caution — watch closely.' : 'Overall posture: Stable.')
      : (posture === 'risk' ? 'الوضع العام: خطر — يتطلّب تدخّلاً الآن.' : posture === 'caution' ? 'الوضع العام: انتباه — راقب عن قرب.' : 'الوضع العام: مستقرّ.');
    const items = top.slice(0, 3).map((p, i) => `${i + 1}. ${p.title} — ${p.action}`);
    const tail = lang === 'en' ? '(Enable the LLM key for a polished executive brief.)' : '(فعّل مفتاح LLM لموجز تنفيذي مصاغ.)';
    return [head, ...items, tail].join('\n');
  }
  private async overdueRequests(tid: string): Promise<number> {
    const [r] = await this.ds.query(
      `SELECT COUNT(*)::int n FROM requests WHERE tenant_id = $1 AND status IN ('pending','peer_pending') AND sla_due_at < NOW()`, [tid],
    ).catch(() => [{ n: 0 }]);
    return r?.n ?? 0;
  }
}

function pad(h: number) { return `${String(h).padStart(2, '0')}:00`; }
