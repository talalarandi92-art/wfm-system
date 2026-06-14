import { useSearchParams } from 'react-router-dom';
import { Radio, AlertTriangle, Wrench } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import RTAPage from '@/pages/RTA';
import OutagesPage from '@/pages/Outages';
import TechnicalIssuesPage from '@/pages/TechnicalIssues';

type HubTab = 'rta' | 'outages' | 'technical';

// RTA + Outages are management/RTA; Technical Issues is agent-facing
// (requests.view_own) so agents keep access to report issues.
const TABS: { key: HubTab; icon: typeof Radio; ar: string; en: string; permission: string }[] = [
  { key: 'rta',       icon: Radio,         ar: 'المراقبة المباشرة', en: 'Live Monitoring',   permission: 'rta.view' },
  { key: 'outages',   icon: AlertTriangle, ar: 'الأعطال',           en: 'Outages',           permission: 'outages.view' },
  { key: 'technical', icon: Wrench,        ar: 'المشاكل التقنية',   en: 'Technical Issues',  permission: 'requests.view_own' },
];

/**
 * Merges Live Monitoring (RTA), Outages and Technical Issues behind one nav
 * entry with tabs. Per-tab permission gating keeps the original access model:
 * agents (requests.view_own) see only Technical Issues, management/RTA see all.
 * Active tab lives in ?tab= so the old /outages and /technical-issues routes
 * redirect here.
 */
export default function LiveOpsHub() {
  const ar = useUiStore(s => s.lang) === 'ar';
  const hasPermission = useAuthStore(s => s.hasPermission);
  const [params, setParams] = useSearchParams();

  const visible = TABS.filter(t => hasPermission(t.permission));
  const raw = params.get('tab') as HubTab | null;
  const tab: HubTab = visible.some(t => t.key === raw) ? raw! : (visible[0]?.key ?? 'technical');

  return (
    <div className="page-enter">
      {visible.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          {visible.map(t => {
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
      )}

      {tab === 'rta'       && <RTAPage />}
      {tab === 'outages'   && <OutagesPage />}
      {tab === 'technical' && <TechnicalIssuesPage />}
    </div>
  );
}
