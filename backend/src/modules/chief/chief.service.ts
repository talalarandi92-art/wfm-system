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

/**
 * The Chief — sits above the whole team. It reads every guard (health, analyst,
 * security, reporter) plus the analyst's accumulated learning, then synthesizes a
 * single executive posture + a cross-cutting, prioritized directive list. It is
 * the one place a leader looks to know "what matters right now, across everything".
 * Deterministic synthesis today; full LLM narration when a key is set.
 */

type Sev = 'risk' | 'caution' | 'ok' | 'info';
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

  async briefing(tid: string, date?: string) {
    const [health, assess, sec, runs] = await Promise.all([
      this.health.run(tid).catch(() => null),
      this.analyst.assess(tid, date).catch(() => null),
      this.security.run(tid).catch(() => null),
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
    const domains = [
      { key: 'operations', labelAr: 'العمليات', sev: analystSev, line: assess ? this.opsLine(assess) : 'لا بيانات' },
      { key: 'security', labelAr: 'الأمن', sev: secSev, line: sec ? `درجة ${sec.score}% · ${sec.counts.fail} خطر · ${sec.counts.warn} تنبيه` : 'لا بيانات' },
      { key: 'system', labelAr: 'سلامة النظام', sev: healthSev, line: health ? `درجة ${health.score}% · ${health.counts.fail} فشل` : 'لا بيانات' },
    ];

    // ── Cross-cutting prioritized directives ──────────────────────────────────
    const priorities: { sev: Sev; domain: string; title: string; action: string }[] = [];
    if (assess) {
      for (const f of assess.coverage.functions.filter((x: any) => x.verdict === 'danger'))
        priorities.push({ sev: 'risk', domain: 'العمليات', title: `نقص تغطية: ${f.functionName}`, action: `غطِّ ${-f.bottleneck.gap} عند ${pad(f.bottleneck.hour)} بأوفرتايم/cross-skill ولا توافق إجازات.` });
      for (const q of assess.queues.queues.slice(0, 3))
        priorities.push({ sev: q.sla < 50 ? 'risk' : 'caution', domain: 'الكيوز', title: `كيو متعثّر: ${q.name}`, action: `SLA ${q.sla}% — وجّه المتاحين أو قلّل البريكات.` });
      if (assess.compliance.offenders.length)
        priorities.push({ sev: 'caution', domain: 'الالتزام', title: `${assess.compliance.offenders.length} غير ملتزم اليوم`, action: 'نبّه الأعلى تأخيراً؛ المتكرّرون → إنسيدنت كوتشينج.' });
      for (const c of assess.schedule.findings.filter((x: any) => x.status === 'fail'))
        priorities.push({ sev: 'risk', domain: 'الجدول', title: c.labelAr, action: 'مخالفة قاعدة صارمة — عدّل قبل النشر.' });
    }
    if (sec) for (const c of sec.checks.filter(c => c.status === 'fail'))
      priorities.push({ sev: 'risk', domain: 'الأمن', title: c.labelAr, action: c.detail });
    if (health) for (const c of health.checks.filter(c => c.status === 'fail'))
      priorities.push({ sev: 'risk', domain: 'النظام', title: c.labelAr, action: c.detail });
    const reqs = await this.overdueRequests(tid);
    if (reqs > 0) priorities.push({ sev: reqs > 5 ? 'risk' : 'caution', domain: 'الطلبات', title: `${reqs} طلب متأخّر عن الـ SLA`, action: 'راجع وصعّد الطلبات المتأخّرة فوراً.' });
    const score = await this.scorecard.summary(tid).catch(() => null);
    if (score && score.belowTarget > 0) priorities.push({ sev: score.belowTarget > 10 ? 'caution' : 'info', domain: 'الأداء', title: `${score.belowTarget} موظف تحت متوسّط قسمه (${score.week})`, action: `أضعف قسم: ${score.worstFunction ?? '—'} — وجّه كوتشينج للمرشّحين.` });

    priorities.sort((a, b) => RANK[a.sev] - RANK[b.sev]);
    const top = priorities.slice(0, 8);

    // ── Overall posture + single directive ────────────────────────────────────
    const posture: Sev = [analystSev, secSev, healthSev].sort((a, b) => RANK[a] - RANK[b])[0];
    const directive = top[0]
      ? `أولوية رقم 1: ${top[0].title} — ${top[0].action}`
      : 'لا مخاطر بارزة — استمرّ بالمراقبة.';

    const [autoMode, selfTest, scorecard] = await Promise.all([
      this.automode.summary(tid).catch(() => null),
      this.selfTest(tid).catch(() => null),
      this.scorecard.summary(tid).catch(() => null),
    ]);

    const base = {
      date: assess?.date ?? date ?? new Date().toISOString().slice(0, 10),
      posture, directive, domains, priorities: top,
      learning: { learnedSamples, decisionsLogged: decided },
      autoMode, selfTest, scorecard,
      lastReport: (runs as any[])[0] ?? null,
    };

    // LLM executive narration when available.
    if (this.llm.isConfigured()) {
      const sys = 'أنت الرئيس التنفيذي لعمليات مركز اتصال Boutiqaat. اكتب موجزاً تنفيذياً قصيراً (3-4 أسطر) ثم أهم قرار واحد، بالعربي، بنبرة قيادية حاسمة مرتكزة على الأرقام.';
      const ctx = `الوضع العام: ${posture}.\nالأولويات:\n${top.map((p, i) => `${i + 1}. [${p.domain}] ${p.title} — ${p.action}`).join('\n')}`;
      const text = await this.llm.chat(sys, [{ role: 'user', content: ctx }], 500);
      if (text) return { ...base, llm: true, executiveBrief: text };
    }
    return { ...base, llm: false, executiveBrief: this.templateBrief(posture, top) };
  }

  private opsLine(a: any): string {
    const danger = a.coverage.functions.filter((f: any) => f.verdict === 'danger').length;
    const q = a.queues.queues.length;
    return `${danger} قسم بخطر تغطية · ${q} كيو متعثّر · ${a.compliance.offenders.length} غير ملتزم`;
  }
  private templateBrief(posture: Sev, top: any[]): string {
    const head = posture === 'risk' ? 'الوضع العام: خطر — يتطلّب تدخّلاً الآن.' : posture === 'caution' ? 'الوضع العام: انتباه — راقب عن قرب.' : 'الوضع العام: مستقرّ.';
    const items = top.slice(0, 3).map((p, i) => `${i + 1}. ${p.title} — ${p.action}`);
    return [head, ...items, '(فعّل مفتاح LLM لموجز تنفيذي مصاغ.)'].join('\n');
  }
  private async overdueRequests(tid: string): Promise<number> {
    const [r] = await this.ds.query(
      `SELECT COUNT(*)::int n FROM requests WHERE tenant_id = $1 AND status IN ('pending','peer_pending') AND sla_due_at < NOW()`, [tid],
    ).catch(() => [{ n: 0 }]);
    return r?.n ?? 0;
  }
}

function pad(h: number) { return `${String(h).padStart(2, '0')}:00`; }
