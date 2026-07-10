import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Activity, BarChart3, FileText, UserMinus, TrendingUp, Database, UserSearch, Scale } from 'lucide-react';
import GroupedTabs, { TabGroupDef } from '@/components/GroupedTabs';
import OperationsAnalyticsPage from '@/pages/OperationsAnalytics';
import OpsInsightsPage from '@/pages/OpsInsights';
import People360Page from '@/pages/People360';
import WorkforceAnalyticsPage from '@/pages/WorkforceAnalytics';
import ReportsPage from '@/pages/Reports';
import AttritionPage from '@/pages/Attrition';
import ForecastingPage from '@/pages/Forecasting';
import ShiftFairnessPage from '@/pages/ShiftFairness';

type HubTab = 'people360' | 'ops' | 'insights' | 'workforce' | 'attrition' | 'fairness' | 'reports' | 'forecast';

/**
 * The 8 former flat tabs regrouped into 5 groups (R1 rollout).
 * Tab KEYS are unchanged — every existing `?tab=` deep link keeps working
 * exactly as before (including the legacy hourly/generate redirects below).
 */
const GROUPS: TabGroupDef[] = [
  {
    key: 'people360', label: 'People 360', labelAr: 'الأفراد', icon: UserSearch,
    tabs: [
      { key: 'people360', label: 'People 360', labelAr: 'تحليل 360°', icon: UserSearch },
    ],
  },
  {
    key: 'workforce', label: 'Workforce', labelAr: 'القوى العاملة', icon: BarChart3,
    tabs: [
      { key: 'workforce', label: 'Workforce Analytics', labelAr: 'تحليلات القوى العاملة', icon: BarChart3 },
      { key: 'insights',  label: 'Data Insights',       labelAr: 'رؤى البيانات',          icon: Database },
      { key: 'attrition', label: 'Attrition',           labelAr: 'معدّل التسرّب',          icon: UserMinus },
    ],
  },
  {
    key: 'forecast', label: 'Forecast', labelAr: 'التنبؤ', icon: TrendingUp,
    tabs: [
      { key: 'forecast', label: 'Volume Forecast', labelAr: 'التنبؤ بالحجم', icon: TrendingUp },
    ],
  },
  {
    key: 'fairness', label: 'Fairness', labelAr: 'العدالة', icon: Scale,
    tabs: [
      { key: 'fairness', label: 'Shift Fairness', labelAr: 'عدالة الشفتات', icon: Scale },
    ],
  },
  {
    key: 'reports', label: 'Reports', labelAr: 'التقارير', icon: FileText,
    tabs: [
      { key: 'reports', label: 'Reports',              labelAr: 'التقارير',         icon: FileText },
      { key: 'ops',     label: 'Operations Analytics', labelAr: 'تحليلات العمليات', icon: Activity },
    ],
  },
];

const ALL_KEYS = GROUPS.flatMap(g => g.tabs.map(t => t.key));

/**
 * Merges the formerly-separate analytics pages behind one nav entry with tabs.
 * The active tab is kept in the URL (?tab=) so deep links land right.
 * (2026-07-03) Hourly Analytics + Demand Schedule MOVED to the Scheduling hub
 * (/schedule?tab=hourly / ?tab=demand) so everything schedule-related is ONE
 * place — old ?tab=hourly/?tab=generate deep links redirect there.
 * (R1) Flat 8-tab strip regrouped into 5 groups via GroupedTabs — the ?tab=
 * keys are unchanged.
 */
export default function AnalyticsHub() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const raw = params.get('tab');

  useEffect(() => {
    if (raw === 'hourly') nav('/schedule?tab=hourly', { replace: true });
    else if (raw === 'generate') nav('/schedule?tab=demand', { replace: true });
  }, [raw, nav]);

  const tab: HubTab = raw && ALL_KEYS.includes(raw) ? (raw as HubTab) : 'workforce';

  return (
    <div className="page-enter">
      <GroupedTabs groups={GROUPS} defaultTab="workforce" />

      {tab === 'people360' && <People360Page />}
      {tab === 'workforce' && <WorkforceAnalyticsPage />}
      {tab === 'insights'  && <OpsInsightsPage />}
      {tab === 'forecast'  && <ForecastingPage />}
      {tab === 'ops'       && <OperationsAnalyticsPage />}
      {tab === 'fairness'  && <ShiftFairnessPage />}
      {tab === 'attrition' && <AttritionPage />}
      {tab === 'reports'   && <ReportsPage />}
    </div>
  );
}
