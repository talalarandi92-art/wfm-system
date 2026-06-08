import { Outlet } from 'react-router-dom';
import { Bell, Moon, Sun, Globe, LogOut, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import Sidebar from './Sidebar';
import { useAuthStore } from '@/store/auth.store';
import { useUiStore } from '@/store/ui.store';
import { t } from '@/i18n';

export default function AppLayout() {
  const { user, logout } = useAuthStore();
  const { lang, dark, sidebarOpen, toggleLang, toggleDark } = useUiStore();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const isRtl = lang === 'ar';

  const userName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || '—';

  return (
    <div className={`min-h-screen bg-gray-50 dark:bg-gray-950 ${isRtl ? 'font-arabic' : ''}`}>
      <Sidebar />

      {/* Main area */}
      <div
        className={`transition-all duration-300 min-h-screen flex flex-col ${
          isRtl
            ? sidebarOpen ? 'mr-64' : 'mr-16'
            : sidebarOpen ? 'ml-64' : 'ml-16'
        }`}
      >
        {/* Top bar */}
        <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between px-6 sticky top-0 z-30 shadow-sm">
          {/* Left: breadcrumb placeholder */}
          <div />

          {/* Right: controls */}
          <div className="flex items-center gap-2">
            {/* Language */}
            <button
              onClick={toggleLang}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Globe size={15} />
              {lang === 'ar' ? 'EN' : 'عر'}
            </button>

            {/* Dark mode */}
            <button
              onClick={toggleDark}
              className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title={t(lang, dark ? 'lightMode' : 'darkMode')}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Notifications */}
            <button className="relative p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <Bell size={18} />
              <span className="absolute top-1.5 end-1.5 w-2 h-2 bg-red-500 rounded-full" />
            </button>

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-blue-700 flex items-center justify-center text-white text-xs font-bold">
                  {userName.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-200 max-w-[120px] truncate">
                  {userName}
                </span>
                <ChevronDown size={14} className="text-gray-400" />
              </button>

              {userMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setUserMenuOpen(false)}
                  />
                  <div className={`
                    absolute top-full mt-1 ${isRtl ? 'left-0' : 'right-0'}
                    w-48 bg-white dark:bg-gray-900 rounded-xl shadow-lg
                    border border-gray-100 dark:border-gray-800 z-50 py-1
                  `}>
                    <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
                      <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                      <p className="text-xs font-medium text-blue-600 mt-0.5">
                        {user?.roles[0] ?? '—'}
                      </p>
                    </div>
                    <button
                      onClick={() => { logout(); setUserMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <LogOut size={14} />
                      {t(lang, 'logout')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
