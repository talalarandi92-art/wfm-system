/**
 * Researcher catalog — curated WFM / contact-center innovations & best practices
 * ("what the strongest operations do"), each mapped to whether OUR platform already
 * has it. The Researcher surfaces these as a research feed + gap list. In-repo so it
 * works offline; with an LLM key + internet it can later pull live sources and
 * synthesize fresh findings on top of this base.
 */

export interface ResearchItem {
  id: string;
  category: string;          // forecasting, rta, automation, quality, wellbeing, analytics
  titleAr: string;
  summaryAr: string;         // the finding / practice
  status: 'have' | 'partial' | 'missing';
  actionAr: string;          // how it applies to us
}

export const CATALOG: ResearchItem[] = [
  { id: 'intraday-reforecast', category: 'forecasting', titleAr: 'إعادة التوقّع الإنترا-داي', summaryAr: 'المراكز المتقدّمة تعيد حساب التوقّع خلال اليوم عند انحراف الحجم بدل الانتظار للغد.', status: 'missing', actionAr: 'أضف إعادة فوركاست تلقائية للـRTA عند تجاوز الانحراف عتبة معيّنة.' },
  { id: 'forecast-accuracy', category: 'forecasting', titleAr: 'قياس دقّة التوقّع (MAPE/WAPE)', summaryAr: 'تتبّع دقّة التوقّع أسبوعياً مؤشّر نضج أساسي — بدونه لا تعرف إن كان تخطيطك يتحسّن.', status: 'missing', actionAr: 'احسب MAPE بين المتوقّع والفعلي واعرض اتجاهه.' },
  { id: 'live-adherence', category: 'rta', titleAr: 'لوحة الالتزام اللحظية', summaryAr: 'مقارنة المجدول بالفعلي لحظياً لكل وكيل تتيح تدخّلاً قبل خرق الـSLA.', status: 'partial', actionAr: 'عندك التغطية بالساعة؛ أضف أدهيرنس لكل وكيل لحظياً.' },
  { id: 'auto-approvals', category: 'automation', titleAr: 'موافقة الطلبات الآلية بالتغطية', summaryAr: 'أتمتة قرارات الطلبات منخفضة المخاطر تحرّر الـWFM للقرارات المعقّدة.', status: 'have', actionAr: 'موجود عندك (Auto Mode) — وسّع الأنواع تدريجياً.' },
  { id: 'shrinkage-trend', category: 'analytics', titleAr: 'اتجاه الشرينكج المصنّف', summaryAr: 'تتبّع الشرينكج (مخطّط/غير مخطّط) باتجاه زمني لكل فريق يكشف المشاكل الإدارية مبكراً.', status: 'partial', actionAr: 'عندك تحليلات؛ أضف تفصيل شرينكج لكل TL باتجاه.' },
  { id: 'agent-wellbeing', category: 'wellbeing', titleAr: 'مؤشّر إرهاق الوكيل', summaryAr: 'الإشغال المرتفع المستمر + الورديات الليلية المتكرّرة مؤشّرات احتراق تسبق التسرّب.', status: 'missing', actionAr: 'احسب مؤشّر ضغط من الإشغال + الليالي + الأوفرتايم وأنذر مبكراً.' },
  { id: 'quality-speed', category: 'quality', titleAr: 'توازن الجودة مقابل السرعة', summaryAr: 'مكافأة AHT المنخفض وحده يضرّ الجودة — اربط المؤشرين بالسكور كارد.', status: 'have', actionAr: 'سكور كاردك يوازن المؤشرين — استمرّ.' },
  { id: 'skill-decay', category: 'analytics', titleAr: 'تراجع المهارة وانتهاؤها', summaryAr: 'المهارات تتقادم؛ تنبيه انتهاء/تراجع المهارة يحافظ على جاهزية التغطية.', status: 'partial', actionAr: 'عندك مهارات؛ أضف تنبيه انتهاء استباقي.' },
  { id: 'attrition-early', category: 'analytics', titleAr: 'إنذار التسرّب المبكر', summaryAr: 'ارتفاع الغياب + انخفاض الالتزام + تراجع السكور كارد تتنبّأ بالاستقالة قبل حدوثها.', status: 'missing', actionAr: 'ادمج هذه الإشارات بمؤشّر خطر تسرّب لكل موظف.' },
  { id: 'self-service', category: 'automation', titleAr: 'الخدمة الذاتية للوكلاء', summaryAr: 'تمكين الوكيل من طلب التبديل/الإجازة ورؤية جدوله يقلّل عبء الـTL ويرفع الرضا.', status: 'have', actionAr: 'موجود (صفحة الموظف والطلبات) — استمرّ بالتوسيع.' },
];

export function gapList(): ResearchItem[] { return CATALOG.filter(i => i.status !== 'have'); }
