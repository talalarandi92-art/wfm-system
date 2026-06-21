import { useSearchParams } from 'react-router-dom';
import { Activity, BarChart3, FileText, UserMinus, TrendingUp, Database, UserSearch } from 'lucide-react';
import HubTabs from '@/components/HubTabs';
import OperationsAnalyticsPage from '@/pages/OperationsAnalytics';
import OpsInsightsPage from '@/pages/OpsInsights';
import People360Page from '@/pages/People360';
import WorkforceAnalyticsPage from '@/pages/WorkforceAnalytics';
import ReportsPage from '@/pages/Reports';
import AttritionPage from '@/pages/Attrition';
import ForecastingPage from '@/pages/Forecasting';

type HubTab = 'people360' | 'ops' | 'insights' | 'workforce' | 'attrition' | 'reports' | 'forecast';

const TABS: { key: HubTab; icon: typeof Activity; ar: string; en: string }[] = [
  { key: 'people360', icon: UserSearch, ar: 'تحليل 360°',            en: 'People 360' },
  { key: 'workforce', icon: BarChart3, ar: 'تحليلات القوى العاملة', en: 'Workforce Analytics' },
  { key: 'insights',  icon: Database,  ar: 'رؤى البيانات',          en: 'Data Insights' },
  { key: 'forecast',  icon: TrendingUp, ar: 'التنبؤ بالحجم',         en: 'Volume Forecast' },
  { key: 'ops',       icon: Activity,  ar: 'تحليلات العمليات',      en: 'Operations Analytics' },
  { key: 'attrition', icon: UserMinus, ar: 'معدّل التسرّب',          en: 'Attrition' },
  { key: 'reports',   icon: FileText,  ar: 'التقارير',              en: 'Reports' },
];

/**
 * Merges the three formerly-separate analytics pages (Workforce, Operations,
 * Reports) behind one nav entry with tabs. The active tab is kept in the URL
 * (?tab=) so deep links and the old /ops-analytics and /reports routes (which
 * redirect here) land on the right tab.
 */
export default function AnalyticsHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: HubTab = raw === 'people360' || raw === 'ops' || raw === 'insights' || raw === 'reports' || raw === 'attrition' || raw === 'forecast' ? raw : 'workforce';

  return (
    <div className="page-enter">
      <HubTabs tabs={TABS} active={tab} onChange={k => setParams({ tab: k }, { replace: true })} />

      {tab === 'people360' && <People360Page />}
      {tab === 'workforce' && <WorkforceAnalyticsPage />}
      {tab === 'insights'  && <OpsInsightsPage />}
      {tab === 'forecast'  && <ForecastingPage />}
      {tab === 'ops'       && <OperationsAnalyticsPage />}
      {tab === 'attrition' && <AttritionPage />}
      {tab === 'reports'   && <ReportsPage />}
    </div>
  );
}
