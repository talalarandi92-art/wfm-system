import { useSearchParams } from 'react-router-dom';
import { Users, GitMerge, Fingerprint } from 'lucide-react';
import HubTabs from '@/components/HubTabs';
import EmployeesPage from '@/pages/Employees';
import EmployeeMergePage from '@/pages/EmployeeMerge';
import IdentityQueuePage from '@/pages/IdentityQueue';

type HubTab = 'list' | 'merge' | 'identity';

const TABS: { key: HubTab; icon: typeof Users; ar: string; en: string }[] = [
  { key: 'list',  icon: Users,    ar: 'الموظفون',     en: 'Employees' },
  { key: 'merge', icon: GitMerge, ar: 'دمج المكررين', en: 'Duplicate Merge' },
  // The queue had a full API and no screen — 31 cases sat unseen.
  { key: 'identity', icon: Fingerprint, ar: 'مراجعة الهويات', en: 'Identity Review' },
];

/**
 * Merges the Employees directory and the duplicate-merge tool behind one nav
 * entry with tabs. Active tab lives in ?tab= so the old /employee-merge route
 * redirects here. Both require employees.view.
 */
export default function EmployeesHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: HubTab = raw === 'merge' ? 'merge' : raw === 'identity' ? 'identity' : 'list';

  return (
    <div className="page-enter">
      <HubTabs tabs={TABS} active={tab} onChange={k => setParams({ tab: k }, { replace: true })} />

      {tab === 'list'  && <EmployeesPage />}
      {tab === 'merge' && <EmployeeMergePage />}
      {tab === 'identity' && <IdentityQueuePage />}
    </div>
  );
}
