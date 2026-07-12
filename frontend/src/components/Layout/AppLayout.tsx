import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Moon, Sun, Sparkles, Globe, LogOut, ChevronDown, Search, X, CheckCheck, KeyRound } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import Sidebar from './Sidebar';
import { useAuthStore } from '@/store/auth.store';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { t } from '@/i18n';

/* ── Pages reachable from the Quick Search palette (filtered by permission) ── */
const SEARCH_PAGES: { path: string; ar: string; en: string; perm: string | null }[] = [
  { path: '/my',            ar: 'صفحتي',            en: 'My Workspace',     perm: null },
  { path: '/dashboard',     ar: 'لوحة التحكم',       en: 'Dashboard',        perm: 'reports.view' },
  { path: '/schedule',      ar: 'الجدول الزمني',     en: 'Schedule',         perm: 'schedule.view' },
  { path: '/generator',     ar: 'مولّد الجدول',      en: 'Auto Generator',   perm: 'schedule.generate' },
  { path: '/rotation',      ar: 'دوران الورديات',    en: 'Shift Rotation',   perm: 'schedule.edit' },
  { path: '/attendance',    ar: 'الحضور والانصراف',  en: 'Attendance',       perm: 'attendance.view_own' },
  { path: '/requests',      ar: 'الطلبات والموافقات', en: 'Requests',        perm: 'requests.view_own' },
  { path: '/breaks',        ar: 'إدارة البريكات',    en: 'Breaks',           perm: 'requests.view_own' },
  { path: '/calendar',      ar: 'التقويم',           en: 'Calendar',         perm: null },
  { path: '/skills',        ar: 'المهارات',          en: 'Skills',           perm: 'employees.view' },
  { path: '/chat',          ar: 'الشات',             en: 'Chat',             perm: null },
  { path: '/knowledge-base', ar: 'قاعدة المعرفة',    en: 'Knowledge Base',   perm: 'kb.view' },
  { path: '/rta',           ar: 'المراقبة المباشرة', en: 'Live Monitoring',  perm: 'rta.view' },
  { path: '/outages',       ar: 'الأعطال',           en: 'Outages',          perm: 'outages.view' },
  { path: '/technical-issues', ar: 'المشاكل التقنية', en: 'Technical Issues', perm: 'requests.view_own' },
  { path: '/capacity',      ar: 'تخطيط السعة',       en: 'Capacity',         perm: 'hc.view' },
  { path: '/scorecard',     ar: 'بطاقة الأداء',      en: 'Scorecard',        perm: 'scorecard.view_own' },
  { path: '/ops-analytics', ar: 'تحليلات العمليات',  en: 'Operations Analytics', perm: 'reports.view' },
  { path: '/employees',     ar: 'الموظفون',          en: 'Employees',        perm: 'employees.view' },
  { path: '/users',         ar: 'المستخدمون',        en: 'Users',            perm: 'users.view' },
  { path: '/import',        ar: 'استيراد البيانات',  en: 'Data Import',      perm: 'settings.view' },
  { path: '/reports',       ar: 'التقارير',          en: 'Reports',          perm: 'reports.view' },
  { path: '/report-library', ar: 'مكتبة التقارير',    en: 'Report Library',   perm: 'reports.view' },
  { path: '/integrations/odoo', ar: 'تكامل Odoo',    en: 'Odoo Integration', perm: 'settings.edit' },
  { path: '/integrations/health', ar: 'صحة الجسور',  en: 'Bridge Health',    perm: 'rta.view' },
  { path: '/settings',      ar: 'الإعدادات',         en: 'Settings',         perm: 'settings.view' },
];

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
  '/scorecard':  { ar: 'مركز الأداء والسكوركارد', en: 'Scorecard & Performance' },
  '/employees':  { ar: 'الموظفون',         en: 'Employees'        },
  '/users':      { ar: 'المستخدمون',       en: 'Users'            },
  '/import':     { ar: 'استيراد البيانات', en: 'Data Import'      },
  '/reports':    { ar: 'التقارير',         en: 'Reports'          },
  '/settings':   { ar: 'الإعدادات',        en: 'Settings'         },
  '/roster':     { ar: 'الروستر والتقارير', en: 'Roster & Reports' },
  '/report-library': { ar: 'مكتبة التقارير', en: 'Report Library' },
  '/analytics':  { ar: 'مركز التحليلات',   en: 'Analytics Hub'    },
  '/my':         { ar: 'صفحتي',            en: 'My Workspace'     },
  '/chat':       { ar: 'مساحة العمل',      en: 'Workspace'        },
  '/calendar':   { ar: 'التقويم',          en: 'Calendar'         },
  '/skills':     { ar: 'المهارات',         en: 'Skills'           },
  '/command-center':      { ar: 'مركز القيادة',    en: 'Command Center' },
  '/control-dashboards':  { ar: 'لوحات التحكّم',   en: 'Control Dashboards' },
  '/wfm-overview':        { ar: 'النظرة التنفيذية', en: 'WFM Overview' },
  '/chief':      { ar: 'الرئيس',           en: 'The Chief'        },
  '/coaching':   { ar: 'التدريب',          en: 'Coaching'         },
  '/integrations/odoo':   { ar: 'تكامل أودو',      en: 'Odoo Integration' },
  '/integrations/health': { ar: 'صحة الجسور',      en: 'Bridge Health'    },
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
  const { user, logout, hasPermission }   = useAuthStore();
  const { lang, dark, theme, sidebarOpen, toggleLang, cycleTheme } = useUiStore();
  const location           = useLocation();
  const navigate           = useNavigate();
  const ar                 = lang === 'ar';
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwOpen, setPwOpen]   = useState(false);
  const [pwCur, setPwCur]     = useState('');
  const [pwNew, setPwNew]     = useState('');
  const [pwConf, setPwConf]   = useState('');
  const [pwMsg, setPwMsg]     = useState<{ ok: boolean; text: string } | null>(null);
  const [pwBusy, setPwBusy]   = useState(false);
  const submitPw = async () => {
    setPwMsg(null);
    if (pwNew !== pwConf) { setPwMsg({ ok: false, text: ar ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match' }); return; }
    setPwBusy(true);
    try {
      await apiClient.post('/auth/change-password', { currentPassword: pwCur, newPassword: pwNew });
      setPwMsg({ ok: true, text: ar ? 'تم تغيير كلمة المرور' : 'Password changed' });
      setPwCur(''); setPwNew(''); setPwConf('');
    } catch (e: any) {
      setPwMsg({ ok: false, text: e?.response?.data?.message || (ar ? 'فشل التغيير' : 'Change failed') });
    } finally { setPwBusy(false); }
  };

  // ── MFA (two-factor) ───────────────────────────────────────────────────────
  const [mfaOpen, setMfaOpen]   = useState(false);
  const [mfaOn, setMfaOn]       = useState<boolean>(!!(user as any)?.mfaEnabled);
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaUri, setMfaUri]     = useState('');
  const [mfaCode, setMfaCode]   = useState('');
  const [mfaPw, setMfaPw]       = useState('');
  const [mfaMsg, setMfaMsg]     = useState<{ ok: boolean; text: string } | null>(null);
  const [mfaBusy, setMfaBusy]   = useState(false);
  const openMfa = () => { setMfaOpen(true); setMenuOpen(false); setMfaMsg(null); setMfaSecret(''); setMfaUri(''); setMfaCode(''); setMfaPw(''); };
  const mfaSetup = async () => {
    setMfaBusy(true); setMfaMsg(null);
    try { const { data } = await apiClient.post('/auth/mfa/setup'); setMfaSecret(data.secret); setMfaUri(data.otpauthUrl); }
    catch (e: any) { setMfaMsg({ ok: false, text: e?.response?.data?.message || 'Error' }); }
    finally { setMfaBusy(false); }
  };
  const mfaEnable = async () => {
    setMfaBusy(true); setMfaMsg(null);
    try { await apiClient.post('/auth/mfa/enable', { token: mfaCode }); setMfaOn(true); setMfaSecret(''); setMfaUri(''); setMfaCode(''); setMfaMsg({ ok: true, text: ar ? 'تم تفعيل المصادقة الثنائية' : 'Two-factor enabled' }); }
    catch (e: any) { setMfaMsg({ ok: false, text: e?.response?.data?.message || (ar ? 'رمز غير صحيح' : 'Invalid code') }); }
    finally { setMfaBusy(false); }
  };
  const mfaDisable = async () => {
    setMfaBusy(true); setMfaMsg(null);
    try { await apiClient.post('/auth/mfa/disable', { password: mfaPw, token: mfaCode }); setMfaOn(false); setMfaCode(''); setMfaPw(''); setMfaMsg({ ok: true, text: ar ? 'تم تعطيل المصادقة الثنائية' : 'Two-factor disabled' }); }
    catch (e: any) { setMfaMsg({ ok: false, text: e?.response?.data?.message || (ar ? 'تحقق غير صحيح' : 'Verification failed') }); }
    finally { setMfaBusy(false); }
  };

  // ── Notifications ──────────────────────────────────────────────────────────
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs]       = useState<any[]>([]);
  const [unread, setUnread]       = useState(0);

  const loadUnread = useCallback(() => {
    apiClient.get('/notifications/unread-count').then((r: any) => setUnread(r.data?.count ?? 0)).catch(() => {});
  }, []);
  useEffect(() => {
    loadUnread();
    const iv = setInterval(loadUnread, 60000);   // refresh every minute
    return () => clearInterval(iv);
  }, [loadUnread]);

  const openNotifs = () => {
    setNotifOpen(o => !o);
    if (!notifOpen) {
      apiClient.get('/notifications?limit=15').then((r: any) => setNotifs(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    }
  };
  const markAllRead = () => {
    apiClient.patch('/notifications/read-all', {}).then(() => { setUnread(0); setNotifs(n => n.map(x => ({ ...x, isRead: true }))); }).catch(() => {});
  };
  const openNotif = (n: any) => {
    apiClient.patch(`/notifications/${n.id}/read`, {}).catch(() => {});
    setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
    setUnread(u => Math.max(0, u - (n.isRead ? 0 : 1)));
    setNotifOpen(false);
  };

  // ── Quick search (⌘K) ────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery]           = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
      if (e.key === 'Escape') { setSearchOpen(false); setNotifOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const searchResults = SEARCH_PAGES.filter(p =>
    (!p.perm || hasPermission(p.perm)) &&
    (query.trim() === '' || p.ar.includes(query) || p.en.toLowerCase().includes(query.toLowerCase())),
  );
  const goTo = (path: string) => { setSearchOpen(false); setQuery(''); navigate(path); };
  const fmtNotifTime = (d: string) => new Date(d).toLocaleString(ar ? 'ar-KW' : 'en-GB', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });

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
              onClick={() => setSearchOpen(true)}
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

            {/* Theme cycle: Dark → Light → Aurora Glass */}
            <button
              onClick={cycleTheme}
              className="btn-ghost p-2"
              title={theme === 'dark' ? (ar ? 'الوضع: غامق — اضغط للفاتح' : 'Theme: Dark — click for Light')
                : theme === 'light' ? (ar ? 'الوضع: فاتح — اضغط للزجاجي' : 'Theme: Light — click for Aurora Glass')
                : (ar ? 'الوضع: زجاجي — اضغط للغامق' : 'Theme: Aurora Glass — click for Dark')}
              aria-label="Cycle theme"
            >
              {theme === 'dark'  && <Moon size={16} />}
              {theme === 'light' && <Sun size={16} className="text-amber-400" />}
              {theme === 'glass' && <Sparkles size={16} className="text-teal-300" />}
            </button>

            {/* Notifications */}
            <div className="relative">
              <button onClick={openNotifs} className="btn-ghost relative p-2" aria-label="Notifications">
                <Bell size={16} />
                {unread > 0 && (
                  <span
                    className="absolute -top-0.5 -end-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-[#07090f]"
                    style={{ boxShadow: '0 0 6px rgba(239,68,68,.7)' }}
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>

              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                  <div className={`absolute top-full mt-2 z-50 w-[340px] rounded-2xl overflow-hidden anim-scaleIn ${ar ? 'left-0' : 'right-0'}`}
                    style={{ background: dark ? 'rgba(15,20,35,0.97)' : 'rgba(255,255,255,0.98)', backdropFilter: 'blur(20px)', border: dark ? '1px solid rgba(255,255,255,.08)' : '1px solid rgba(0,0,0,.08)', boxShadow: '0 20px 48px rgba(0,0,0,.3)' }}>
                    <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/60">
                      <span className="text-sm font-bold text-slate-800 dark:text-white">{ar ? 'الإشعارات' : 'Notifications'}{unread > 0 ? ` (${unread})` : ''}</span>
                      {unread > 0 && (
                        <button onClick={markAllRead} className="flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-400">
                          <CheckCheck size={12} /> {ar ? 'تعليم الكل' : 'Mark all'}
                        </button>
                      )}
                    </div>
                    <div className="max-h-[380px] overflow-y-auto">
                      {notifs.length === 0 ? (
                        <p className="text-xs text-slate-500 text-center py-8">{ar ? 'لا توجد إشعارات' : 'No notifications'}</p>
                      ) : notifs.map(n => (
                        <button key={n.id} onClick={() => openNotif(n)}
                          className="w-full text-start px-4 py-2.5 flex items-start gap-2.5 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors border-b border-slate-50 dark:border-slate-800/30"
                          style={{ background: n.isRead ? 'transparent' : (dark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)') }}>
                          {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 flex-shrink-0" />}
                          <div className={`min-w-0 flex-1 ${n.isRead ? 'ps-3.5' : ''}`}>
                            <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">{ar ? (n.titleAr || n.title) : (n.title || n.titleAr)}</p>
                            {(n.body || n.bodyAr) && <p className="text-[11px] text-slate-500 line-clamp-2">{ar ? (n.bodyAr || n.body) : (n.body || n.bodyAr)}</p>}
                            <p className="text-[9px] text-slate-400 mt-0.5">{fmtNotifTime(n.createdAt)}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

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

                    {/* Change password */}
                    <button
                      onClick={() => { setPwOpen(true); setMenuOpen(false); setPwMsg(null); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm
                                 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white
                                 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors duration-150 rounded-xl mx-0.5"
                    >
                      <KeyRound size={15} />
                      {ar ? 'تغيير كلمة المرور' : 'Change password'}
                    </button>

                    {/* Two-factor */}
                    <button
                      onClick={openMfa}
                      className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm
                                 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white
                                 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors duration-150 rounded-xl mx-0.5"
                    >
                      <span className="flex items-center gap-3"><KeyRound size={15} />{ar ? 'المصادقة الثنائية' : 'Two-factor (MFA)'}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ background: mfaOn ? 'rgba(34,197,94,0.15)' : 'rgba(100,116,139,0.15)', color: mfaOn ? '#22c55e' : '#94a3b8' }}>
                        {mfaOn ? (ar ? 'مُفعّل' : 'ON') : (ar ? 'متوقّف' : 'OFF')}
                      </span>
                    </button>

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

        {/* Change-password modal */}
        {pwOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            style={{ background: 'rgba(2,6,23,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={() => setPwOpen(false)}>
            <div className="w-full max-w-sm rounded-2xl p-5"
              onClick={e => e.stopPropagation()}
              style={{ background: dark ? '#0c1628' : '#fff', border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}` }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-sm font-bold" style={{ color: dark ? '#e2e8f0' : '#0f172a' }}>
                  <KeyRound size={16} style={{ color: '#818cf8' }} /> {ar ? 'تغيير كلمة المرور' : 'Change password'}
                </div>
                <button onClick={() => setPwOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
              </div>
              {[
                { v: pwCur, set: setPwCur, ph: ar ? 'كلمة المرور الحالية' : 'Current password' },
                { v: pwNew, set: setPwNew, ph: ar ? 'كلمة المرور الجديدة' : 'New password' },
                { v: pwConf, set: setPwConf, ph: ar ? 'تأكيد كلمة المرور الجديدة' : 'Confirm new password' },
              ].map((f, i) => (
                <input key={i} type="password" value={f.v} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                  className="w-full mb-2.5 rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, color: dark ? '#e2e8f0' : '#0f172a' }} />
              ))}
              <p className="text-[11px] mb-3" style={{ color: '#94a3b8' }}>
                {ar ? '10 أحرف على الأقل، مع حرف صغير وكبير ورقم.' : 'At least 10 chars with lowercase, uppercase, and a digit.'}
              </p>
              {pwMsg && (
                <p className="text-xs mb-3 font-medium" style={{ color: pwMsg.ok ? '#22c55e' : '#ef4444' }}>{pwMsg.text}</p>
              )}
              <button onClick={submitPw} disabled={pwBusy || !pwCur || !pwNew} className="btn-primary w-full text-sm justify-center">
                {pwBusy ? '…' : (ar ? 'تغيير' : 'Change password')}
              </button>
            </div>
          </div>
        )}

        {/* Two-factor (MFA) modal */}
        {mfaOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            style={{ background: 'rgba(2,6,23,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => setMfaOpen(false)}>
            <div className="w-full max-w-sm rounded-2xl p-5" onClick={e => e.stopPropagation()}
              style={{ background: dark ? '#0c1628' : '#fff', border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}` }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-sm font-bold" style={{ color: dark ? '#e2e8f0' : '#0f172a' }}>
                  <KeyRound size={16} style={{ color: '#818cf8' }} /> {ar ? 'المصادقة الثنائية (MFA)' : 'Two-factor (MFA)'}
                </div>
                <button onClick={() => setMfaOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
              </div>

              {mfaOn ? (
                <>
                  <p className="text-xs mb-3" style={{ color: '#94a3b8' }}>{ar ? 'لإيقاف المصادقة الثنائية أدخل كلمة المرور ورمزاً حالياً.' : 'To disable, enter your password and a current code.'}</p>
                  <input type="password" value={mfaPw} onChange={e => setMfaPw(e.target.value)} placeholder={ar ? 'كلمة المرور' : 'Password'}
                    className="w-full mb-2.5 rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, color: dark ? '#e2e8f0' : '#0f172a' }} />
                  <input value={mfaCode} onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} placeholder="123456"
                    className="w-full mb-3 rounded-xl px-3 py-2.5 text-center tracking-[0.3em] outline-none" style={{ background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, color: dark ? '#e2e8f0' : '#0f172a' }} />
                  {mfaMsg && <p className="text-xs mb-3 font-medium" style={{ color: mfaMsg.ok ? '#22c55e' : '#ef4444' }}>{mfaMsg.text}</p>}
                  <button onClick={mfaDisable} disabled={mfaBusy || !mfaPw || mfaCode.length !== 6} className="btn-danger w-full text-sm justify-center">{ar ? 'إيقاف' : 'Disable'}</button>
                </>
              ) : !mfaSecret ? (
                <>
                  <p className="text-xs mb-3" style={{ color: '#94a3b8' }}>{ar ? 'فعّل طبقة حماية إضافية بتطبيق مصادقة (Google Authenticator، Authy…).' : 'Add an extra layer with an authenticator app (Google Authenticator, Authy…).'}</p>
                  {mfaMsg && <p className="text-xs mb-3 font-medium" style={{ color: mfaMsg.ok ? '#22c55e' : '#ef4444' }}>{mfaMsg.text}</p>}
                  <button onClick={mfaSetup} disabled={mfaBusy} className="btn-primary w-full text-sm justify-center">{ar ? 'تفعيل المصادقة الثنائية' : 'Enable two-factor'}</button>
                </>
              ) : (
                <>
                  <p className="text-xs mb-2" style={{ color: '#94a3b8' }}>{ar ? 'أضف هذا المفتاح في تطبيق المصادقة، ثم أدخل الرمز:' : 'Add this key to your authenticator app, then enter the code:'}</p>
                  <div className="rounded-xl px-3 py-2 mb-2 text-center font-mono text-xs break-all" style={{ background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.25)' }}>{mfaSecret}</div>
                  <input value={mfaCode} onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} placeholder="123456" autoFocus
                    className="w-full mb-3 rounded-xl px-3 py-2.5 text-center tracking-[0.3em] outline-none" style={{ background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, color: dark ? '#e2e8f0' : '#0f172a' }} />
                  {mfaMsg && <p className="text-xs mb-3 font-medium" style={{ color: mfaMsg.ok ? '#22c55e' : '#ef4444' }}>{mfaMsg.text}</p>}
                  <button onClick={mfaEnable} disabled={mfaBusy || mfaCode.length !== 6} className="btn-primary w-full text-sm justify-center">{ar ? 'تحقّق وفعّل' : 'Verify & enable'}</button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Page content — keyed by route for a soft enter transition ──── */}
        <main className="flex-1 p-6">
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>

      {/* ── Quick search palette (⌘K) ──────────────────────────────────────── */}
      {searchOpen && (
        <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh] px-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
          onClick={() => { setSearchOpen(false); setQuery(''); }}>
          <div className="w-full max-w-lg rounded-2xl overflow-hidden anim-scaleIn"
            style={{ background: dark ? 'rgba(15,20,35,0.98)' : '#fff', border: dark ? '1px solid rgba(255,255,255,.1)' : '1px solid rgba(0,0,0,.08)', boxShadow: '0 24px 64px rgba(0,0,0,.4)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100 dark:border-slate-800/60">
              <Search size={16} className="text-slate-400 flex-shrink-0" />
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && searchResults[0]) goTo(searchResults[0].path); }}
                placeholder={ar ? 'انتقل إلى صفحة...' : 'Jump to a page...'}
                className="flex-1 bg-transparent text-sm text-slate-800 dark:text-white outline-none placeholder-slate-400" />
              <button onClick={() => { setSearchOpen(false); setQuery(''); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={15} /></button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto py-2">
              {searchResults.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">{ar ? 'لا توجد نتائج' : 'No results'}</p>
              ) : searchResults.map(p => (
                <button key={p.path} onClick={() => goTo(p.path)}
                  className="w-full text-start px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-500/15 transition-colors flex items-center justify-between">
                  <span>{ar ? p.ar : p.en}</span>
                  <span className="text-[10px] text-slate-400">{p.path}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
