import { Outlet, useLocation } from 'react-router-dom';
import { Bell, Moon, Sun, Globe, LogOut, ChevronDown, Search } from 'lucide-react';
import { useState } from 'react';
import Sidebar from './Sidebar';
import { useAuthStore } from '@/store/auth.store';
import { useUiStore } from '@/store/ui.store';
import { t } from '@/i18n';

/* ── Breadcrumb map ───────────────────────────────────────────────────────── */
const PAGE_TITLES: Record<string, { ar: string; en: string }> = {
  '/dashboard':  { ar: 'لوحة التحكم',      en: 'Dashboard'        },
  '/schedule':   { ar: 'الجدول الزمني',    en: 'Schedule'         },
  '/generator':  { ar: 'مولّد الجدول التلقائي', en: 'Auto Schedule Generator' },
  '/rotation':   { ar: 'دوران الورديات وتوزيع الشيفتات', en: 'Shift Rotation & Rate' },
  '/attendance': { ar: 'الحضور والانصراف', en: 'Attendance'       },
  '/requests':   { ar: 'الطلبات والموافقات', en: 'Requests & Approvals' },
  '/capacity':   { ar: 'التخطيط',          en: 'Capacity Planning' },
  '/rta':        { ar: 'المراقبة المباشرة', en: 'Live Monitoring'  },
  '/outages':    { ar: 'الأعطال',          en: 'Outages'          },
  '/scorecard':  { ar: 'بطاقة الأداء',     en: 'Scorecard'        },
  '/employees':  { ar: 'الموظفون',         en: 'Employees'        },
  '/users':      { ar: 'المستخدمون',       en: 'Users'            },
  '/import':     { ar: 'استيراد البيانات', en: 'Data Import'      },
  '/reports':    { ar: 'التقارير',         en: 'Reports'          },
  '/settings':   { ar: 'الإعدادات',        en: 'Settings'         },
};

/* ── Avatar gradient by first char ───────────────────────────────────────── */
const AVATAR_GRADIENTS = [
  'from-indigo-500 to-violet-600',
  'from-sky-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
];
function avatarGradient(name: string) {
  const i = (name.charCodeAt(0) || 0) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[i];
}

/* ── Component ────────────────────────────────────────────────────────────── */
export default function AppLayout() {
  const { user, logout }   = useAuthStore();
  const { lang, dark, sidebarOpen, toggleLang, toggleDark } = useUiStore();
  const location           = useLocation();
  const ar                 = lang === 'ar';
  const [menuOpen, setMenuOpen] = useState(false);

  const userName   = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || '—';
  const initials   = userName.slice(0, 2).toUpperCase();
  const pageTitle  = PAGE_TITLES[location.pathname];
  const gradient   = avatarGradient(userName);

  return (
    <div className={`min-h-screen ${ar ? 'font-arabic' : ''}`}>
      <Sidebar />

      {/* ── Main wrapper ────────────────────────────────────────────────── */}
      <div
        className="flex flex-col min-h-screen transition-all duration-300"
        style={{
          marginInlineStart: sidebarOpen ? 256 : 68,
        }}
      >
        {/* ── Top bar ───────────────────────────────────────────────────── */}
        <header
          className="sticky top-0 z-30 flex items-center justify-between px-6 h-[60px]"
          style={{
            background: dark
              ? 'rgba(7,9,15,0.85)'
              : 'rgba(248,250,252,0.85)',
            backdropFilter: 'blur(20px) saturate(1.8)',
            borderBottom: dark
              ? '1px solid rgba(255,255,255,0.05)'
              : '1px solid rgba(0,0,0,0.06)',
          }}
        >
          {/* Left: page title */}
          <div className="flex items-center gap-3 min-w-0">
            {pageTitle && (
              <div className="min-w-0">
                <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                  {ar ? pageTitle.ar : pageTitle.en}
                </h1>
              </div>
            )}
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-1">
            {/* Search pill */}
            <button
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs
                         text-slate-400 hover:text-slate-600 dark:hover:text-slate-300
                         border border-slate-200 dark:border-slate-800/80
                         bg-white/60 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-800
                         transition-all duration-200 me-2"
              style={{ minWidth: 160 }}
            >
              <Search size={13} />
              <span>{ar ? 'بحث سريع...' : 'Quick search...'}</span>
              <kbd className="ms-auto text-[10px] opacity-50 hidden lg:block">⌘K</kbd>
            </button>

            {/* Language toggle */}
            <button
              onClick={toggleLang}
              className="btn-ghost text-xs px-2.5 py-1.5"
              aria-label="Toggle language"
            >
              <Globe size={14} />
              <span className="hidden sm:inline">{ar ? 'EN' : 'عر'}</span>
            </button>

            {/* Dark / Light */}
            <button
              onClick={toggleDark}
              className="btn-ghost p-2"
              aria-label={dark ? 'Light mode' : 'Dark mode'}
            >
              {dark
                ? <Sun size={16} className="text-amber-400" />
                : <Moon size={16} />
              }
            </button>

            {/* Notifications */}
            <button className="btn-ghost relative p-2" aria-label="Notifications">
              <Bell size={16} />
              <span
                className="absolute top-1.5 end-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-[#07090f]"
                style={{ boxShadow: '0 0 6px rgba(239,68,68,.7)' }}
              />
            </button>

            {/* Divider */}
            <div className="w-px h-5 bg-slate-200 dark:bg-slate-800 mx-1" />

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl
                           hover:bg-slate-100 dark:hover:bg-slate-800/80
                           transition-all duration-200 focus-visible:outline-none"
              >
                {/* Avatar */}
                <div
                  className={`w-7 h-7 rounded-lg bg-gradient-to-br ${gradient}
                              flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0`}
                  style={{ boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}
                >
                  {initials}
                </div>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200 max-w-[110px] truncate hidden sm:block">
                  {userName}
                </span>
                <ChevronDown
                  size={13}
                  className={`text-slate-400 transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''} hidden sm:block`}
                />
              </button>

              {/* Dropdown */}
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div
                    className={`
                      absolute top-full mt-2 z-50 min-w-[200px] rounded-2xl py-1.5
                      anim-scaleIn
                      ${ar ? 'left-0' : 'right-0'}
                    `}
                    style={{
                      background: dark ? 'rgba(15,20,35,0.95)' : 'rgba(255,255,255,0.97)',
                      backdropFilter: 'blur(20px)',
                      border: dark ? '1px solid rgba(255,255,255,.08)' : '1px solid rgba(0,0,0,.08)',
                      boxShadow: '0 20px 48px rgba(0,0,0,.3)',
                    }}
                  >
                    {/* User info */}
                    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800/60">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl bg-gradient-to-br ${gradient}
                                      flex items-center justify-center text-white text-sm font-bold`}
                        >
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                            {userName}
                          </p>
                          <p className="text-xs text-slate-400 truncate">{user?.email}</p>
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {user?.roles.map(r => (
                          <span
                            key={r}
                            className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                            style={{
                              background: 'rgba(99,102,241,.15)',
                              color: '#a5b4fc',
                              border: '1px solid rgba(99,102,241,.25)',
                            }}
                          >
                            {r.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Logout */}
                    <button
                      onClick={() => { logout(); setMenuOpen(false); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm
                                 text-red-500 hover:text-red-400
                                 hover:bg-red-500/8 transition-colors duration-150 rounded-xl mx-0.5"
                    >
                      <LogOut size={15} />
                      {t(lang, 'logout')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* ── Page content — keyed by route for a soft enter transition ──── */}
        <main className="flex-1 p-6">
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
