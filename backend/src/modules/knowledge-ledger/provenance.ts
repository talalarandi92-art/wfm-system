/**
 * Provenance for every piece of knowledge/expertise the platform holds — the
 * source it was acquired from, the benefit it gives, and when it was added.
 * Kept as parallel maps so the underlying knowledge arrays stay untouched; any
 * item without an entry still appears in the ledger with a sensible default, so
 * the report grows automatically as knowledge is added.
 */

export interface Provenance { source: string; benefit: string; addedAt: string }

// Expert knowledge topics (keyed by KnowledgeTopic.topic).
export const PROV_EXPERT: Record<string, Provenance> = {
  forecasting: { source: 'منهجية التنبؤ في WFM (SWPP / ICMI) + بياناتنا التاريخية', benefit: 'احتياج توظيف أدقّ وتقليل الفائض/النقص', addedAt: '2026-06-14' },
  erlang: { source: 'نظرية Erlang-C + ممارسات NICE / Verint', benefit: 'حساب الموظفين المطلوبين للصوت لتحقيق الـSLA بدقّة', addedAt: '2026-06-14' },
  concurrency: { source: 'ممارسات القنوات الرقمية (Calabrio / Genesys) + قرارنا: تزامن 4', benefit: 'تحجيم الشات/واتساب/إيميل صح بدل تقدير عشوائي', addedAt: '2026-06-14' },
  scheduling: { source: 'أفضل ممارسات الجدولة + قواعد Boutiqaat المعتمدة', benefit: 'جداول عادلة تغطّي الذروة وتحترم الراحة والأوف', addedAt: '2026-06-14' },
  adherence: { source: 'معايير الالتزام/المطابقة (ICMI)', benefit: 'كشف فجوة التغطية اللحظية قبل خرق الـSLA', addedAt: '2026-06-14' },
  shrinkage: { source: 'نماذج الشرينكج المعيارية (SWPP)', benefit: 'منع نقص التوظيف المزمن باحتساب الهدر', addedAt: '2026-06-14' },
  rta: { source: 'ممارسات الإدارة اللحظية RTA', benefit: 'تدخّل سريع يمنع الخرق بدل شرحه بعد وقوعه', addedAt: '2026-06-14' },
  occupancy: { source: 'نظرية الإشغال في مراكز الاتصال', benefit: 'موازنة الإنتاجية مع تجنّب احتراق الموظفين', addedAt: '2026-06-14' },
  omnichannel: { source: 'أطر الأومني-تشانل الحديثة', benefit: 'تخطيط كل قناة حسب طبيعتها + cross-skill بحكمة', addedAt: '2026-06-14' },
  attrition: { source: 'أبحاث التسرّب في مراكز الاتصال', benefit: 'توظيف استباقي وتقليل أثر الاستقالات على التغطية', addedAt: '2026-06-14' },
  coaching: { source: 'أطر الكوتشينج القائم على البيانات', benefit: 'معالجة فجوات الأداء بخطة قابلة للقياس', addedAt: '2026-06-14' },
  reporting: { source: 'مبادئ تصميم الـMIS / التقارير', benefit: 'تقارير تجاوب على قرار لا تعرض أرقاماً فقط', addedAt: '2026-06-14' },
  scorecard: { source: 'تصميم بطاقات الأداء + سكور كاردنا الفعلي', benefit: 'تقييم أداء عادل يربط الجودة بالكفاءة ويغذّي الكوتشينج', addedAt: '2026-06-14' },
  our_rules: { source: 'قواعدنا المعتمدة (ذاكرة المشروع / CLAUDE.md)', benefit: 'كل القرارات تلتزم قواعد Boutiqaat الفعلية', addedAt: '2026-06-14' },
};

// Researcher catalog items (keyed by ResearchItem.id). benefit defaults to the item's actionAr.
export const PROV_RESEARCH: Record<string, { source: string; addedAt: string }> = {
  'intraday-reforecast': { source: 'ممارسات RTA المتقدّمة (NICE / Verint)', addedAt: '2026-06-14' },
  'forecast-accuracy': { source: 'مؤشرات نضج التخطيط (SWPP)', addedAt: '2026-06-14' },
  'live-adherence': { source: 'لوحات الالتزام اللحظية (Calabrio)', addedAt: '2026-06-14' },
  'auto-approvals': { source: 'أتمتة WFM الحديثة', addedAt: '2026-06-14' },
  'shrinkage-trend': { source: 'تحليلات الشرينكج (SWPP)', addedAt: '2026-06-14' },
  'agent-wellbeing': { source: 'أبحاث رفاهية الوكيل ومنع الاحتراق', addedAt: '2026-06-14' },
  'quality-speed': { source: 'موازنة الجودة/السرعة (ICMI)', addedAt: '2026-06-14' },
  'skill-decay': { source: 'إدارة المهارات وانتهاؤها', addedAt: '2026-06-14' },
  'attrition-early': { source: 'نماذج التنبؤ بالتسرّب', addedAt: '2026-06-14' },
  'self-service': { source: 'اتجاهات الخدمة الذاتية للوكلاء', addedAt: '2026-06-14' },
};

export const DEFAULT_EXPERT: Provenance = { source: 'ضمن معرفة WFM المعتمدة', benefit: '—', addedAt: '2026-06-14' };
export const DEFAULT_RESEARCH = { source: 'رصد ممارسات القطاع', addedAt: '2026-06-14' };
