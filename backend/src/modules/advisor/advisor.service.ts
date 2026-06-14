import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LlmService } from '@modules/llm/llm.service';
import { AnalystService } from '@modules/analyst/analyst.service';
import { HealthGuardService } from '@modules/health-guard/health-guard.service';

/**
 * LLM Advisor — the fourth guard. A senior WFM/RTA expert that narrates the
 * situation, answers questions in Arabic, and proposes concrete system / design /
 * process improvements — grounded in our codified rules + the live assessment.
 * Activates when an LLM key is set; otherwise returns a deterministic fallback.
 */

// The knowledge we agreed on — handed to the model so it reasons within our rules.
const WFM_KNOWLEDGE = `أنت مستشار WFM/RTA خبير لمركز اتصال Boutiqaat (أومني-تشانل، 24/7). اعمل ضمن هذه القواعد المعتمدة:
- الأسبوع يبدأ السبت وينتهي الجمعة.
- وردية الموكل العادية 9 ساعات (تشمل ساعة بريك)؛ ورديات المسؤول/المشرف "20" = 8 ساعات.
- أوقات الورديات الثابتة: M 07-16 · B 09-18 · C 11-20 · N 13-22 · E 16-01 · EE 18-02 · MD 22-07 · MN 23-08. لا توجد ورديات بأوقات مخترعة.
- قاعدة الإناث: حتى C (تنتهي 20:00)؛ N فقط عند الضرورة وكاستثناء لكل فنكشن؛ ممنوع منتصف الليل (E/EE/MD/MN) نهائياً.
- سياسة الفنكشن: Outbound/OMT = B و N فقط؛ Refund = M,B,C,N,E,EE (بلا منتصف ليل).
- الراحة ≥ 10 ساعات بين ورديتين (مع احتساب عبور منتصف الليل).
- توزيع الأوف عادل، عدد صحيح أسبوعياً، بلا 3 متتالية، والويك-إند (خميس/جمعة/سبت) يتوزّع بعدل.
- السعة: Erlang-C للصوت؛ التزامن 4 للشات/واتساب؛ نموذج باكلوج للإيميل؛ إنتاجية المتدرّب ~70%.
- SLA الطلبات 30 دقيقة للإنترا داي؛ لا موافقة تلقائية؛ نقص HC حرج = تحذير+إشعار مش حظر صارم.
أجب بإيجاز عملي وبالعربي، وارتكز على الأرقام المعطاة. إذا كان القرار خطر على التغطية فاذكره صراحة.`;

@Injectable()
export class AdvisorService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly llm: LlmService,
    private readonly analyst: AnalystService,
    private readonly health: HealthGuardService,
  ) {}

  status() { return { configured: this.llm.isConfigured(), model: this.llm.isConfigured() ? this.llm.modelName : null }; }

  // Compact live snapshot the model reasons over.
  private async context(tid: string, date?: string): Promise<{ text: string; assess: any; health: any }> {
    const [assess, health] = await Promise.all([
      this.analyst.assess(tid, date).catch(() => null),
      this.health.run(tid).catch(() => null),
    ]);
    const lines: string[] = [];
    if (assess) {
      lines.push(`التاريخ: ${assess.date}. الوضع العام: ${assess.headline}. عتبة الفائض الآمن: ${assess.thresholds.surplusSafe}.`);
      const cov = assess.coverage.functions;
      const danger = cov.filter((f: any) => f.verdict === 'danger').map((f: any) => `${f.functionName} (ناقص ${-f.bottleneck.gap} @${f.bottleneck.hour}:00)`);
      const approve = cov.filter((f: any) => f.verdict === 'approve').map((f: any) => `${f.functionName} (فائض ${f.bottleneck.gap})`);
      if (danger.length) lines.push(`أقسام بخطر تغطية: ${danger.join('، ')}.`);
      if (approve.length) lines.push(`أقسام بفائض آمن: ${approve.join('، ')}.`);
      if (assess.queues.queues.length) lines.push(`كيوز متعثّرة: ${assess.queues.queues.map((q: any) => `${q.name} SLA ${q.sla}% باكلوج ${q.backlog}`).join('، ')}.`);
      if (assess.compliance.offenders.length) lines.push(`غير ملتزمين اليوم: ${assess.compliance.offenders.length}.`);
      if (assess.schedule.findings.length) lines.push(`ملاحظات جدول: ${assess.schedule.findings.map((c: any) => `${c.labelAr} (${c.count})`).join('، ')}.`);
    }
    if (health) lines.push(`صحّة النظام: ${health.score}% (${health.counts.fail} فشل، ${health.counts.warn} تحذير).`);
    return { text: lines.join('\n') || 'لا توجد بيانات كافية لهذا اليوم.', assess, health };
  }

  // ── Narrate the current situation ───────────────────────────────────────────
  async brief(tid: string, date?: string) {
    const ctx = await this.context(tid, date);
    if (this.llm.isConfigured()) {
      const text = await this.llm.chat(WFM_KNOWLEDGE,
        [{ role: 'user', content: `لخّص وضع العمليات الآن بفقرة موجزة لمدير الـ WFM، ثم 2-3 أولويات. البيانات:\n${ctx.text}` }], 700);
      if (text) return { llm: true, brief: text, context: ctx.text };
    }
    // Fallback: templated from the data.
    return { llm: false, brief: this.templateBrief(ctx), context: ctx.text };
  }

  private templateBrief(ctx: { text: string; assess: any; health: any }): string {
    const a = ctx.assess; if (!a) return 'لا توجد بيانات كافية.';
    const parts: string[] = [`الوضع العام: ${a.headline === 'risk' ? 'خطر' : a.headline === 'caution' ? 'انتباه' : 'سليم'}.`];
    const danger = a.coverage.functions.filter((f: any) => f.verdict === 'danger');
    if (danger.length) parts.push(`أولوية: ${danger.length} قسم بخطر تغطية — غطِّ بأوفرتايم/cross-skill ولا توافق إجازات.`);
    if (a.queues.queues.length) parts.push(`الكيوز: ${a.queues.queues.length} متعثّرة — وجّه المتاحين أو قلّل البريكات.`);
    if (ctx.health) parts.push(`صحّة النظام ${ctx.health.score}%.`);
    parts.push('(فعّل مفتاح LLM لسرد وتحليل أعمق.)');
    return parts.join(' ');
  }

  // ── Free-form question ──────────────────────────────────────────────────────
  async ask(tid: string, question: string, date?: string) {
    const ctx = await this.context(tid, date);
    if (this.llm.isConfigured()) {
      const text = await this.llm.chat(WFM_KNOWLEDGE,
        [{ role: 'user', content: `سؤال المدير: «${question}»\n\nالوضع الحالي:\n${ctx.text}\n\nأجب بدقّة وبالعربي مرتكزاً على الأرقام والقواعد.` }], 1000);
      if (text) return { llm: true, answer: text };
    }
    return { llm: false, answer: `لتفعيل الإجابة الذكية على الأسئلة الحرّة، اضبط مفتاح LLM (ANTHROPIC_API_KEY). الوضع الحالي باختصار:\n${this.templateBrief(ctx)}` };
  }

  // ── Improvement proposals (system / design / process) ───────────────────────
  async improvements(tid: string) {
    const ctx = await this.context(tid);
    if (this.llm.isConfigured()) {
      const text = await this.llm.chat(WFM_KNOWLEDGE,
        [{ role: 'user', content: `أنت مستشار تطوير لمنصة WFM مبنية على هذه الموديولات: الجدولة والمولّد، الحضور والأدهيرنس، السعة/Erlang، تأثير HC والتغطية بالساعة، الطلبات والموافقات وSLA، الأعطال والمشاكل التقنية، السكور كارد والكوتشينج، المهارات، التقارير، وحرّاس ذكيون (سلامة/محلّل/ناشر).\nاقترح أهم 6-8 تحسينات ملموسة (نظام · ديزاين/UX · عمليات) مرتّبة بالأولوية، كل واحد بسطر: العنوان ثم الفائدة. ارتكز على الوضع الحالي:\n${ctx.text}` }], 1200);
      if (text) return { llm: true, improvements: text };
    }
    return { llm: false, improvements: this.staticImprovements() };
  }

  private staticImprovements(): string {
    return [
      '• توقّع/فوركاست محمّل من بيانات فعلية بدل متوسّط الأسابيع (دقّة الاحتياج).',
      '• إعادة فوركاست إنترا-داي تلقائية عند انحراف الحجم (RTA).',
      '• لوحة أدهيرنس لحظية (مجدول مقابل فعلي) لكل وكيل.',
      '• تتبّع شرينكج مصنّف (مخطّط/غير مخطّط) باتجاه زمني لكل TL.',
      '• محرّك توصية cross-skill يربط النقص بقسم بالفائض بقسم آخر.',
      '• ديزاين: توحيد ألوان الحالة (أخضر/أصفر/أحمر) ومؤشرات الفجوة عبر كل الصفحات.',
      '• ديزاين: شريط "أهم 3 مخاطر اليوم" أعلى كل لوحة قيادة.',
      '• تنبيهات استباقية قبل خرق SLA بدل بعده.',
      '(فعّل مفتاح LLM لتوصيات مفصّلة ومخصّصة لوضعك اللحظي.)',
    ].join('\n');
  }
}
