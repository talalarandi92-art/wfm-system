import { useSearchParams } from 'react-router-dom';
import { Activity, BarChart3, FileText, UserMinus, TrendingUp } from 'lucide-react';
import HubTabs from '@/components/HubTabs';
import OperationsAnalyticsPage from '@/pages/OperationsAnalytics';
import WorkforceAnalyticsPage from '@/pages/WorkforceAnalytics';
import ReportsPage from '@/pages/Reports';
import AttritionPage from '@/pages/Attrition';
import ForecastingPage from '@/pages/Forecasting';

type HubTab = 'ops' | 'workforce' | 'attrition' | 'reports' | 'forecast';

const TABS: { key: HubTab; icon: typeof Activity; ar: string; en: string }[] = [
  { key: 'workforce', icon: BarChart3, ar: 'تحليلات القوى العاملة', en: 'Workforce Analytics' },
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
  const tab: HubTab = raw === 'ops' || raw === 'reports' || raw === 'attrition' || raw === 'forecast' ? raw : 'workforce';

  return (
    <div className="page-enter">
      <HubTabs tabs={TABS} active={tab} onChange={k => setParams({ tab: k }, { replace: true })} />

      {tab === 'workforce' && <WorkforceAnalyticsPage />}
      {tab === 'forecast'  && <ForecastingPage />}
      {tab === 'ops'       && <OperationsAnalyticsPage />}
      {tab === 'attrition' && <AttritionPage />}
      {tab === 'reports'   && <ReportsPage />}
    </div>
  );
}
