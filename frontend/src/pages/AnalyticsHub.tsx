import { useSearchParams } from 'react-router-dom';
import { Activity, BarChart3, FileText } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import OperationsAnalyticsPage from '@/pages/OperationsAnalytics';
import WorkforceAnalyticsPage from '@/pages/WorkforceAnalytics';
import ReportsPage from '@/pages/Reports';

type HubTab = 'ops' | 'workforce' | 'reports';

const TABS: { key: HubTab; icon: typeof Activity; ar: string; en: string }[] = [
  { key: 'workforce', icon: BarChart3, ar: 'تحليلات القوى العاملة', en: 'Workforce Analytics' },
  { key: 'ops',       icon: Activity,  ar: 'تحليلات العمليات',      en: 'Operations Analytics' },
  { key: 'reports',   icon: FileText,  ar: 'التقارير',              en: 'Reports' },
];

/**
 * Merges the three formerly-separate analytics pages (Workforce, Operations,
 * Reports) behind one nav entry with tabs. The active tab is kept in the URL
 * (?tab=) so deep links and the old /ops-analytics and /reports routes (which
 * redirect here) land on the right tab.
 */
export default function AnalyticsHub() {
  const lang = useUiStore(s => s.lang);
  const ar = lang === 'ar';
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: HubTab = raw === 'ops' || raw === 'reports' ? raw : 'workforce';

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

      {tab === 'workforce' && <WorkforceAnalyticsPage />}
      {tab === 'ops'       && <OperationsAnalyticsPage />}
      {tab === 'reports'   && <ReportsPage />}
    </div>
  );
}
