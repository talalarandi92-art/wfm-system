import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Globe, Moon, Sun, LogIn } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useUiStore } from '@/store/ui.store';
import { t } from '@/i18n';

export default function Login() {
  const navigate = useNavigate();
  const { login, isLoading } = useAuthStore();
  const { lang, dark, toggleLang, toggleDark } = useUiStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        setError(t(lang, 'invalidCredentials'));
      } else {
        setError(t(lang, 'serverError'));
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">

      {/* Top controls */}
      <div className="absolute top-4 end-4 flex items-center gap-2">
        <button
          onClick={toggleLang}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-all"
        >
          <Globe size={15} />
          {lang === 'ar' ? 'EN' : 'عر'}
        </button>
        <button
          onClick={toggleDark}
          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      {/* Card */}
      <div className="w-full max-w-md">

        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 shadow-lg shadow-blue-900/50 mb-4">
            <span className="text-white text-2xl font-bold">W</span>
          </div>
          <h1 className="text-2xl font-bold text-white">{t(lang, 'appName')}</h1>
          <p className="text-blue-300 text-sm mt-1">{t(lang, 'boutiqaat')}</p>
        </div>

        {/* Form */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
            {t(lang, 'login')}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t(lang, 'email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t(lang, 'emailPlaceholder')}
                className="input-field"
                required
                autoFocus
                dir="ltr"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t(lang, 'password')}
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t(lang, 'passwordPlaceholder')}
                  className="input-field pe-11"
                  required
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute inset-y-0 end-3 flex items-center text-gray-400 hover:text-gray-600"
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg px-4 py-3 text-sm text-red-700 dark:text-red-400">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full justify-center py-3 text-base"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  {t(lang, 'loggingIn')}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <LogIn size={18} />
                  {t(lang, 'loginButton')}
                </span>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
