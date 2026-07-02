import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Calendar, ClockIcon, FileText, BarChart3,
  Radio, AlertTriangle, Users, Settings, UserCog, Award,
  Upload, ChevronLeft, ChevronRight, Activity, Zap, Shuffle,
  GitMerge, Wrench, Coffee, CalendarDays, BrainCircuit, MessageCircle, BookOpen, UserCircle, Plug, Megaphone, ClipboardCheck, CalendarCog, GraduationCap, ShieldCheck, Bot, FileBarChart, Sparkles, ShieldAlert, Crown, Gauge,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useUiStore } from '@/store/ui.store';
import { t } from '@/i18n';

/* ── Nav structure with section groupings ─────────────────────────────────── */
const NAV_SECTIONS = [
  {
    label: null,
    items: [
      { key: 'commandCenter', icon: Crown,         path: '/command-center', permission: 'reports.view', agentHidden: true },
      { key: 'myWorkspace', icon: UserCircle,      path: '/my',        permission: null },
      // Ops overview — management + RTA only; agents use My Workspace instead.
      { key: 'dashboard',   icon: LayoutDashboard, path: '/dashboard', permission: null, agentHidden: true },
      { key: 'controlDashboards', icon: Gauge, path: '/control-dashboards', permission: 'reports.view', agentHidden: true },
      // The Chief is the single visible face — the rest of the team runs behind it
      // (reachable from the Chief / Bots Hub, not shown individually in the nav).
      { key: 'chief', icon: Bot, path: '/chief', permission: 'hc.view', agentHidden: true },
    ],
  },
  {
    label: { ar: 'التشغيل', en: 'Operations' },
    items: [
      // Scheduling hub (schedule grid + generator + rotation + campaigns) — visible
      // to management + RTA (schedule.view); agent sees own shifts in My Workspace.
      { key: 'schedulingHub', icon: Calendar,   path: '/schedule',   permission: 'schedule.view', agentHidden: true },
      // Attendance hub (dashboard + corrections + breaks) — per-tab gating: agents
      // reach only Corrections, management/RTA see all. Not agent-hidden so agents keep it.
      { key: 'attendanceHub', icon: ClockIcon,   path: '/attendance', permission: 'attendance.view_own' },
      { key: 'roster',     icon: Users,          path: '/roster',     permission: 'attendance.view_team', agentHidden: true },
      { key: 'requests',   icon: FileText,       path: '/requests',   permission: 'requests.view_own' },
      { key: 'calendar',   icon: CalendarDays,   path: '/calendar',   permission: null },
      { key: 'skills',     icon: BrainCircuit,   path: '/skills',     permission: 'employees.view' },
      // Workspace hub (chat + knowledge base)
      { key: 'workspace',  icon: MessageCircle,  path: '/chat',       permission: null },
      // Live Ops hub (RTA + outages + technical issues) — per-tab gating: agents
      // reach only Technical Issues, management/RTA see all.
      { key: 'liveOps',          icon: Radio,          path: '/rta',              permission: 'requests.view_own' },
    ],
  },
  {
    label: { ar: 'التخطيط', en: 'Planning' },
    items: [
      // Executive command center — gateway to the hub tabs (Agent 360, Board, Roster Dashboard…).
      { key: 'wfmOverview', icon: Sparkles, path: '/wfm-overview', permission: 'attendance.view_team', agentHidden: true },
      // Capacity & Coverage hub (Erlang planning + hourly coverage + interval headcount).
      { key: 'capacity',  icon: BarChart3, path: '/capacity',  permission: 'hc.view' },
      // Scorecard hub (overview + board + leaderboard + trends + agent/team 360 + coaching + productivity).
      { key: 'scorecard', icon: Award,     path: '/scorecard', permission: 'scorecard.view_own', agentHidden: true },
      { key: 'analyticsHub', icon: Activity, path: '/analytics', permission: 'reports.view' },
    ],
  },
  // (2026-07-02) The former "Reports & Analytics" section is gone: its 7 pages are now
  // tabs inside the Roster hub (/roster) and the Scorecard hub (/scorecard).
  {
    label: { ar: 'الإدارة', en: 'Management' },
    items: [
      { key: 'employees', icon: Users,    path: '/employees', permission: 'employees.view' },
      { key: 'users',     icon: UserCog,  path: '/users',     permission: 'users.view' },
      { key: 'import',    icon: Upload,   path: '/import',    permission: 'settings.view' },
      { key: 'odoo',      icon: Plug,     path: '/integrations/odoo', permission: 'settings.edit' },
      { key: 'settings',  icon: Settings, path: '/settings',  permission: 'settings.view' },
    ],
  },
];

/* ── Component ────────────────────────────────────────────────────────────── */
export default function Sidebar() {
  const { hasPermission } = useAuthStore();
  const { lang, sidebarOpen, toggleSidebar } = useUiStore();
  const location = useLocation();
  const ar = lang === 'ar';

  // An "agent" has none of the staff/management capabilities. Management AND RTA
  // all hold at least one of these — so items flagged `agentHidden` stay visible
  // to them and are hidden only from agents (who get their personal workspace).
  const isAgent = !['reports.view', 'rta.view', 'users.view', 'attendance.view_team',
    'attendance.view_all', 'hc.view', 'schedule.view_draft', 'settings.view']
    .some(p => hasPermission(p));

  return (
    <aside
      className={`
        fixed top-0 h-full z-40 flex flex-col
        transition-all duration-300 ease-in-out
        ${ar ? 'right-0' : 'left-0'}
        ${sidebarOpen ? 'w-64' : 'w-[68px]'}
      `}
      style={{
        background: 'linear-gradient(180deg,#0d1120 0%,#0b0f1c 100%)',
        borderInlineEnd: '1px solid rgba(255,255,255,0.05)',
        boxShadow: '4px 0 24px rgba(0,0,0,0.4)',
      }}
    >

      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center h-[60px] px-4 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      >
        {/* Logo mark */}
        <div
          className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg,#4f46e5,#7c3aed)',
            boxShadow: '0 4px 12px rgba(99,102,241,.4), 0 0 0 1px rgba(255,255,255,.1)',
          }}
        >
          <Zap size={18} className="text-white" fill="white" />
        </div>

        {/* Brand name — only when expanded */}
        <div
          className={`overflow-hidden transition-all duration-300 ${
            sidebarOpen ? 'w-40 opacity-100 ms-3' : 'w-0 opacity-0'
          }`}
        >
          <p className="text-white font-bold text-sm leading-none tracking-tight whitespace-nowrap">
            WFM Platform
          </p>
          <p className="text-slate-500 text-[11px] mt-0.5 whitespace-nowrap">
            {ar ? 'إدارة القوى العاملة' : 'Workforce Management'}
          </p>
        </div>
      </div>

      {/* ── Navigation ────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-0.5">
        {NAV_SECTIONS.map((section, si) => {
          const visibleItems = section.items.filter(item => {
            if ((item as any).agentHidden && isAgent) return false;
            return !item.permission || hasPermission(item.permission);
          });
          if (!visibleItems.length) return null;

          return (
            <div key={si}>
              {/* Section label */}
              {section.label && sidebarOpen && (
                <p className="sidebar-label mt-4">
                  {ar ? section.label.ar : section.label.en}
                </p>
              )}
              {section.label && !sidebarOpen && (
                <div className="sidebar-divider" />
              )}

              {visibleItems.map(item => {
                const isActive = location.pathname === item.path ||
                  (item.path !== '/dashboard' && location.pathname.startsWith(item.path));

                return (
                  <NavLink
                    key={item.key}
                    to={item.path}
                    className={`sidebar-item ${isActive ? 'active' : ''} ${!sidebarOpen ? 'justify-center px-2' : ''}`}
                    title={!sidebarOpen ? t(lang, item.key as any) : undefined}
                    end={item.path === '/dashboard'}
                  >
                    {/* Icon with active glow */}
                    <span
                      className={`flex-shrink-0 transition-all duration-200 ${
                        isActive ? 'text-indigo-400' : ''
                      }`}
                      style={isActive ? { filter: 'drop-shadow(0 0 6px rgba(99,102,241,.7))' } : {}}
                    >
                      <item.icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                    </span>

                    {/* Label */}
                    <span
                      className={`whitespace-nowrap transition-all duration-300 ${
                        sidebarOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0 overflow-hidden'
                      }`}
                    >
                      {t(lang, item.key as any)}
                    </span>

                    {/* Active indicator dot — collapsed */}
                    {isActive && !sidebarOpen && (
                      <span
                        className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                        style={{ background: '#6366f1', boxShadow: '0 0 4px #6366f1' }}
                      />
                    )}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* ── Collapse toggle ────────────────────────────────────────────────── */}
      <button
        onClick={toggleSidebar}
        className={`
          absolute top-1/2 -translate-y-1/2
          ${ar ? '-left-3.5' : '-right-3.5'}
          w-7 h-7 rounded-full flex items-center justify-center
          border border-slate-700/80 transition-all duration-200
          hover:border-indigo-500/60 hover:scale-110
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
        `}
        style={{
          background: 'linear-gradient(135deg,#151b2e,#0f1527)',
          boxShadow: '0 2px 8px rgba(0,0,0,.5)',
        }}
        aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {ar
          ? (sidebarOpen ? <ChevronRight size={13} className="text-slate-400" /> : <ChevronLeft size={13} className="text-slate-400" />)
          : (sidebarOpen ? <ChevronLeft  size={13} className="text-slate-400" /> : <ChevronRight size={13} className="text-slate-400" />)
        }
      </button>
    </aside>
  );
}
