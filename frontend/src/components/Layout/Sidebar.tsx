import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Calendar, Clock, FileText, BarChart3,
  Radio, AlertTriangle, Users, Settings, UserCog, Award,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useUiStore } from '@/store/ui.store';
import { t } from '@/i18n';

const navItems = [
  { key: 'dashboard',  icon: LayoutDashboard, path: '/dashboard',  permission: null },
  { key: 'schedule',   icon: Calendar,        path: '/schedule',   permission: 'schedule.view' },
  { key: 'attendance', icon: Clock,           path: '/attendance', permission: 'attendance.view_own' },
  { key: 'requests',   icon: FileText,        path: '/requests',   permission: 'requests.view_own' },
  { key: 'capacity',   icon: BarChart3,       path: '/capacity',   permission: 'hc.view' },
  { key: 'rta',        icon: Radio,           path: '/rta',        permission: 'rta.view' },
  { key: 'outages',    icon: AlertTriangle,   path: '/outages',    permission: 'outages.view' },
  { key: 'scorecard',  icon: Award,           path: '/scorecard',  permission: 'scorecard.view_own' },
  { key: 'employees',  icon: Users,           path: '/employees',  permission: 'employees.view' },
  { key: 'users',      icon: UserCog,         path: '/users',      permission: 'users.view' },
  { key: 'reports',    icon: BarChart3,       path: '/reports',    permission: 'reports.view' },
  { key: 'settings',   icon: Settings,        path: '/settings',   permission: 'settings.view' },
];

export default function Sidebar() {
  const { hasPermission } = useAuthStore();
  const { lang, sidebarOpen, toggleSidebar } = useUiStore();
  const isRtl = lang === 'ar';

  const visible = navItems.filter(
    (item) => !item.permission || hasPermission(item.permission)
  );

  return (
    <aside
      className={`
        fixed top-0 ${isRtl ? 'right-0' : 'left-0'} h-full z-40
        bg-white dark:bg-gray-900 border-${isRtl ? 'l' : 'r'} border-gray-100 dark:border-gray-800
        flex flex-col transition-all duration-300 shadow-sm
        ${sidebarOpen ? 'w-64' : 'w-16'}
      `}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-gray-100 dark:border-gray-800">
        <div className="flex-shrink-0 w-8 h-8 bg-blue-700 rounded-lg flex items-center justify-center">
          <span className="text-white text-sm font-bold">W</span>
        </div>
        {sidebarOpen && (
          <div className="overflow-hidden">
            <p className="text-sm font-bold text-gray-900 dark:text-white leading-none">WFM</p>
            <p className="text-xs text-gray-400 leading-none mt-0.5">Boutiqaat</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
        {visible.map((item) => (
          <NavLink
            key={item.key}
            to={item.path}
            className={({ isActive }) =>
              `sidebar-item ${isActive ? 'active' : ''} ${!sidebarOpen ? 'justify-center' : ''}`
            }
            title={!sidebarOpen ? t(lang, item.key as any) : undefined}
          >
            <item.icon size={18} className="flex-shrink-0" />
            {sidebarOpen && (
              <span className="truncate">{t(lang, item.key as any)}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className={`
          absolute top-1/2 -translate-y-1/2
          ${isRtl ? '-left-3' : '-right-3'}
          w-6 h-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
          rounded-full flex items-center justify-center shadow-sm
          hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors
        `}
      >
        {isRtl
          ? (sidebarOpen ? <ChevronRight size={12} /> : <ChevronLeft size={12} />)
          : (sidebarOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />)
        }
      </button>
    </aside>
  );
}
