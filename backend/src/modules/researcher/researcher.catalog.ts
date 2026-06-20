/**
 * Researcher catalog — curated WFM / contact-center innovations & best practices
 * ("what the strongest operations do"), each mapped to whether OUR platform already
 * has it. The Researcher surfaces these as a research feed + gap list. In-repo so it
 * works offline; with an LLM key + internet it can later pull live sources and
 * synthesize fresh findings on top of this base.
 *
 * Every item is bilingual (Ar + En) so the feed/digest switch with the UI language.
 */

export interface ResearchItem {
  id: string;
  category: string;          // forecasting, rta, automation, quality, wellbeing, analytics
  titleAr: string;
  titleEn: string;
  summaryAr: string;         // the finding / practice
  summaryEn: string;
  status: 'have' | 'partial' | 'missing';   // BASELINE — overridden live by detect()
  actionAr: string;          // how it applies to us
  actionEn: string;
  /**
   * Live detectors: SQL probes proving whether the feature actually exists/runs in
   * THIS deployment. Each must return a single column `n`. The Researcher runs them
   * and upgrades the baseline to the real state — so a gap disappears once it's built.
   */
  detect?: {
    haveSql?: string;        // n > 0  → 'have'
    partialSql?: string;     // n > 0  → at least 'partial'
  };
}

export const CATALOG: ResearchItem[] = [
  { id: 'intraday-reforecast', category: 'forecasting',
    titleAr: 'إعادة التوقّع الإنترا-داي', titleEn: 'Intraday re-forecasting',
    summaryAr: 'المراكز المتقدّمة تعيد حساب التوقّع خلال اليوم عند انحراف الحجم بدل الانتظار للغد.',
    summaryEn: 'Leading centers recompute the forecast during the day when volume drifts, instead of waiting for tomorrow.',
    status: 'missing',
    actionAr: 'أضف إعادة فوركاست تلقائية للـRTA عند تجاوز الانحراف عتبة معيّنة.',
    actionEn: 'Add automatic re-forecasting for RTA when the deviation crosses a set threshold.' },
  { id: 'forecast-accuracy', category: 'forecasting',
    titleAr: 'قياس دقّة التوقّع (MAPE/WAPE)', titleEn: 'Forecast accuracy tracking (MAPE/WAPE)',
    summaryAr: 'تتبّع دقّة التوقّع أسبوعياً مؤشّر نضج أساسي — بدونه لا تعرف إن كان تخطيطك يتحسّن.',
    summaryEn: 'Tracking forecast accuracy weekly is a core maturity signal — without it you cannot tell whether planning is improving.',
    status: 'missing',
    actionAr: 'احسب MAPE بين المتوقّع والفعلي واعرض اتجاهه.',
    actionEn: 'Compute MAPE between forecast and actual and show its trend.',
    detect: { partialSql: `SELECT COUNT(*) n FROM channel_demand_daily WHERE tenant_id = $1`,
              haveSql:    `SELECT COUNT(DISTINCT demand_date) n FROM channel_demand_daily WHERE tenant_id = $1 HAVING COUNT(DISTINCT demand_date) >= 7` } },
  { id: 'live-adherence', category: 'rta',
    titleAr: 'لوحة الالتزام اللحظية', titleEn: 'Live adherence dashboard',
    summaryAr: 'مقارنة المجدول بالفعلي لحظياً لكل وكيل تتيح تدخّلاً قبل خرق الـSLA.',
    summaryEn: 'Comparing scheduled vs actual in real time per agent enables intervention before an SLA breach.',
    status: 'partial',
    actionAr: 'عندك التغطية بالساعة؛ أضف أدهيرنس لكل وكيل لحظياً.',
    actionEn: 'You have hourly coverage; add real-time per-agent adherence.',
    detect: { haveSql: `SELECT COUNT(*) n FROM adherence_daily WHERE tenant_id = $1` } },
  { id: 'auto-approvals', category: 'automation',
    titleAr: 'موافقة الطلبات الآلية بالتغطية', titleEn: 'Coverage-aware auto-approvals',
    summaryAr: 'أتمتة قرارات الطلبات منخفضة المخاطر تحرّر الـWFM للقرارات المعقّدة.',
    summaryEn: 'Automating low-risk request decisions frees WFM for the complex ones.',
    status: 'have',
    actionAr: 'موجود عندك (Auto Mode) — وسّع الأنواع تدريجياً.',
    actionEn: 'Already in place (Auto Mode) — expand the request types gradually.',
    detect: { haveSql: `SELECT COUNT(*) n FROM automode_decisions WHERE tenant_id = $1` } },
  { id: 'shrinkage-trend', category: 'analytics',
    titleAr: 'اتجاه الشرينكج المصنّف', titleEn: 'Categorized shrinkage trend',
    summaryAr: 'تتبّع الشرينكج (مخطّط/غير مخطّط) باتجاه زمني لكل فريق يكشف المشاكل الإدارية مبكراً.',
    summaryEn: 'Tracking shrinkage (planned/unplanned) over time per team surfaces management issues early.',
    status: 'partial',
    actionAr: 'عندك تحليلات؛ أضف تفصيل شرينكج لكل TL باتجاه.',
    actionEn: 'You have analytics; add per-TL shrinkage breakdown with a trend.' },
  { id: 'agent-wellbeing', category: 'wellbeing',
    titleAr: 'مؤشّر إرهاق الوكيل', titleEn: 'Agent burnout index',
    summaryAr: 'الإشغال المرتفع المستمر + الورديات الليلية المتكرّرة مؤشّرات احتراق تسبق التسرّب.',
    summaryEn: 'Sustained high occupancy + frequent night shifts are burnout signals that precede attrition.',
    status: 'missing',
    actionAr: 'احسب مؤشّر ضغط من الإشغال + الليالي + الأوفرتايم وأنذر مبكراً.',
    actionEn: 'Compute a strain index from occupancy + night shifts + overtime and alert early.' },
  { id: 'quality-speed', category: 'quality',
    titleAr: 'توازن الجودة مقابل السرعة', titleEn: 'Quality vs speed balance',
    summaryAr: 'مكافأة AHT المنخفض وحده يضرّ الجودة — اربط المؤشرين بالسكور كارد.',
    summaryEn: 'Rewarding low AHT alone hurts quality — tie both metrics together in the scorecard.',
    status: 'have',
    actionAr: 'سكور كاردك يوازن المؤشرين — استمرّ.',
    actionEn: 'Your scorecard already balances both — keep it up.' },
  { id: 'skill-decay', category: 'analytics',
    titleAr: 'تراجع المهارة وانتهاؤها', titleEn: 'Skill decay & expiry',
    summaryAr: 'المهارات تتقادم؛ تنبيه انتهاء/تراجع المهارة يحافظ على جاهزية التغطية.',
    summaryEn: 'Skills age; an expiry/decay alert keeps coverage readiness intact.',
    status: 'partial',
    actionAr: 'عندك مهارات؛ أضف تنبيه انتهاء استباقي.',
    actionEn: 'You have skills; add a proactive expiry alert.',
    detect: { partialSql: `SELECT COUNT(*) n FROM employee_skills WHERE tenant_id = $1` } },
  { id: 'attrition-early', category: 'analytics',
    titleAr: 'إنذار التسرّب المبكر', titleEn: 'Early attrition warning',
    summaryAr: 'ارتفاع الغياب + انخفاض الالتزام + تراجع السكور كارد تتنبّأ بالاستقالة قبل حدوثها.',
    summaryEn: 'Rising absence + falling adherence + declining scorecard predict resignation before it happens.',
    status: 'missing',
    actionAr: 'ادمج هذه الإشارات بمؤشّر خطر تسرّب لكل موظف.',
    actionEn: 'Combine these signals into a per-employee attrition-risk score.' },
  { id: 'self-service', category: 'automation',
    titleAr: 'الخدمة الذاتية للوكلاء', titleEn: 'Agent self-service',
    summaryAr: 'تمكين الوكيل من طلب التبديل/الإجازة ورؤية جدوله يقلّل عبء الـTL ويرفع الرضا.',
    summaryEn: 'Letting agents request swaps/leave and see their schedule reduces TL load and lifts satisfaction.',
    status: 'have',
    actionAr: 'موجود (صفحة الموظف والطلبات) — استمرّ بالتوسيع.',
    actionEn: 'In place (agent page + requests) — keep expanding it.',
    detect: { haveSql: `SELECT COUNT(*) n FROM requests WHERE tenant_id = $1` } },
];

export function gapList(): ResearchItem[] { return CATALOG.filter(i => i.status !== 'have'); }
