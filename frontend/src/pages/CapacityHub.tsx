import { useSearchParams } from 'react-router-dom';
import { BarChart3, Activity, BarChart4, Sigma } from 'lucide-react';
import HubTabs from '@/components/HubTabs';
import CapacityPage from '@/pages/Capacity';
import HourlyCoveragePage from '@/pages/HourlyCoverage';
import IntervalHeadcountPage from '@/pages/IntervalHeadcount';
import StaffingEnginePage from '@/pages/StaffingEngine';

type HubTab = 'staffing' | 'planning' | 'coverage' | 'intervals';

const TABS: { key: HubTab; icon: typeof BarChart3; ar: string; en: string }[] = [
  { key: 'staffing',  icon: Sigma,     ar: 'محرك التوظيف',      en: 'Staffing Engine' },
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
  const tab: HubTab = TABS.some(t => t.key === raw) ? (raw as HubTab) : 'staffing';

  return (
    <div className="page-enter">
      <HubTabs tabs={TABS} active={tab} onChange={k => setParams({ tab: k }, { replace: true })} />

      {tab === 'staffing'  && <StaffingEnginePage />}
      {tab === 'planning'  && <CapacityPage />}
      {tab === 'coverage'  && <HourlyCoveragePage />}
      {tab === 'intervals' && <IntervalHeadcountPage />}
    </div>
  );
}
