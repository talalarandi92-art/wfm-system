import { Users, UserCheck, FileText, Plane, TrendingUp, Activity, Clock, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useUiStore } from '@/store/ui.store';
import { t } from '@/i18n';

const statCards = [
  { key: 'totalEmployees', icon: Users,      value: '—', color: 'blue',  sub: '' },
  { key: 'activeToday',    icon: UserCheck,  value: '—', color: 'green', sub: '' },
  { key: 'pendingRequests',icon: FileText,   value: '—', color: 'amber', sub: '' },
  { key: 'onLeave',        icon: Plane,      value: '—', color: 'purple',sub: '' },
];

const colorMap: Record<string, string> = {
  blue:   'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
  green:  'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
  amber:  'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400',
  purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400',
};

export default function Dashboard() {
  const { user } = useAuthStore();
  const { lang } = useUiStore();

  const userName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t(lang, 'welcome')}، {userName} 👋
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            {new Date().toLocaleDateString(lang === 'ar' ? 'ar-KW' : 'en-US', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            })}
          </p>
        </div>
        <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded-full border border-green-200 dark:border-green-800">
          <CheckCircle2 size={14} />
          {t(lang, 'systemReady')}
        </span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div key={card.key} className="card flex items-start gap-4">
            <div className={`p-2.5 rounded-xl ${colorMap[card.color]}`}>
              <card.icon size={20} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{card.value}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {t(lang, card.key as any)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Middle row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Coverage */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Activity size={18} className="text-blue-600" />
              {t(lang, 'coverageStatus')}
            </h2>
          </div>
          <div className="flex flex-col items-center justify-center h-32 text-gray-400 dark:text-gray-600">
            <TrendingUp size={36} className="mb-2 opacity-30" />
            <p className="text-sm text-center">{t(lang, 'connectData')}</p>
          </div>
        </div>

        {/* Quick links */}
        <div className="card">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Clock size={18} className="text-blue-600" />
            {lang === 'ar' ? 'وصول سريع' : 'Quick Access'}
          </h2>
          <div className="space-y-2">
            {[
              { label: lang === 'ar' ? 'عرض جدولي' : 'My Schedule',   color: 'blue'   },
              { label: lang === 'ar' ? 'طلب استئذان' : 'New Request',  color: 'amber'  },
              { label: lang === 'ar' ? 'الحضور اليوم' : 'Attendance',  color: 'green'  },
              { label: lang === 'ar' ? 'بطاقة أدائي' : 'My Scorecard', color: 'purple' },
            ].map((link) => (
              <button
                key={link.label}
                className="w-full text-start px-3 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border border-gray-100 dark:border-gray-800"
              >
                {link.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Role badge */}
      <div className="card bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-100 dark:border-blue-900/40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-700 flex items-center justify-center text-white font-bold">
            {userName?.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">{userName}</p>
            <p className="text-sm text-blue-600 dark:text-blue-400">
              {user?.roles.join(', ')} &nbsp;·&nbsp;
              <span className="text-gray-400 text-xs">
                {user?.permissions.length} {lang === 'ar' ? 'صلاحية' : 'permissions'}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
