import { useSearchParams } from 'react-router-dom';
import { Users, GitMerge } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import EmployeesPage from '@/pages/Employees';
import EmployeeMergePage from '@/pages/EmployeeMerge';

type HubTab = 'list' | 'merge';

const TABS: { key: HubTab; icon: typeof Users; ar: string; en: string }[] = [
  { key: 'list',  icon: Users,    ar: 'الموظفون',     en: 'Employees' },
  { key: 'merge', icon: GitMerge, ar: 'دمج المكررين', en: 'Duplicate Merge' },
];

/**
 * Merges the Employees directory and the duplicate-merge tool behind one nav
 * entry with tabs. Active tab lives in ?tab= so the old /employee-merge route
 * redirects here. Both require employees.view.
 */
export default function EmployeesHub() {
  const ar = useUiStore(s => s.lang) === 'ar';
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: HubTab = raw === 'merge' ? 'merge' : 'list';

  return (
    <div className="page-enter">
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setParams({ tab: t.key }, { replace: true })}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                active
                  ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={16} />
              {ar ? t.ar : t.en}
            </button>
          );
        })}
      </div>

      {tab === 'list'  && <EmployeesPage />}
      {tab === 'merge' && <EmployeeMergePage />}
    </div>
  );
}
