import { useSearchParams } from 'react-router-dom';
import { Clock, ClipboardCheck, Coffee } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import AttendanceDashboard from '@/pages/AttendanceDashboard';
import AttendanceCorrectionsPage from '@/pages/AttendanceCorrections';
import BreaksPage from '@/pages/Breaks';

type HubTab = 'dashboard' | 'corrections' | 'breaks';

// Dashboard + Breaks are management/RTA (attendance.view_team); Corrections is
// agent self-service (attendance.view_own) so agents keep access to that tab.
const TABS: { key: HubTab; icon: typeof Clock; ar: string; en: string; permission: string }[] = [
  { key: 'dashboard',   icon: Clock,          ar: 'الحضور',        en: 'Attendance',  permission: 'attendance.view_team' },
  { key: 'corrections', icon: ClipboardCheck, ar: 'تصحيح الحضور',  en: 'Corrections', permission: 'attendance.view_own' },
  { key: 'breaks',      icon: Coffee,         ar: 'البريكات',      en: 'Breaks',      permission: 'attendance.view_team' },
];

/**
 * Merges the Attendance dashboard, Attendance corrections and Break management
 * behind one nav entry with tabs. Per-tab permission gating preserves the
 * original access model: agents (own-attendance only) see just Corrections,
 * management/RTA see all three. Active tab lives in ?tab= so the old
 * /attendance-corrections and /breaks routes redirect here.
 */
export default function AttendanceHub() {
  const ar = useUiStore(s => s.lang) === 'ar';
  const hasPermission = useAuthStore(s => s.hasPermission);
  const [params, setParams] = useSearchParams();

  const visible = TABS.filter(t => hasPermission(t.permission));
  const raw = params.get('tab') as HubTab | null;
  const tab: HubTab = visible.some(t => t.key === raw) ? raw! : (visible[0]?.key ?? 'dashboard');

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

      {tab === 'dashboard'   && <AttendanceDashboard />}
      {tab === 'corrections' && <AttendanceCorrectionsPage />}
      {tab === 'breaks'      && <BreaksPage />}
    </div>
  );
}
