import { useSearchParams } from 'react-router-dom';
import { BarChart3, Activity, BarChart4 } from 'lucide-react';
import HubTabs from '@/components/HubTabs';
import CapacityPage from '@/pages/Capacity';
import HourlyCoveragePage from '@/pages/HourlyCoverage';
import IntervalHeadcountPage from '@/pages/IntervalHeadcount';

type HubTab = 'planning' | 'coverage' | 'intervals';

const TABS: { key: HubTab; icon: typeof BarChart3; ar: string; en: string }[] = [
  { key: 'planning',  icon: BarChart3, ar: 'تخطيط الطاقة',      en: 'Capacity Planning' },
  { key: 'coverage',  icon: Activity,  ar: 'التغطية بالساعة',   en: 'Hourly Coverage' },
  { key: 'intervals', icon: BarChart4, ar: 'هيدكاونت بالفترات', en: 'Interval Headcount' },
];

/**
 * Capacity & Coverage hub — the coverage-planning triplet (Erlang capacity,
 * hourly Required/Scheduled/Available/Gap, and interval headcount) that lived
 * in two different sidebar sections now shares one home. Old routes
 * (/hourly-coverage, /interval-headcount) redirect here.
 */
export default function CapacityHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: HubTab = TABS.some(t => t.key === raw) ? (raw as HubTab) : 'planning';

  return (
    <div className="page-enter">
      <HubTabs tabs={TABS} active={tab} onChange={k => setParams({ tab: k }, { replace: true })} />

      {tab === 'planning'  && <CapacityPage />}
      {tab === 'coverage'  && <HourlyCoveragePage />}
      {tab === 'intervals' && <IntervalHeadcountPage />}
    </div>
  );
}
