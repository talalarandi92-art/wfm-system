import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Globe, Moon, Sun, ArrowRight, Zap } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useUiStore } from '@/store/ui.store';
import { t } from '@/i18n';

/* ─────────────────────────────────────────────────────────────────────────── */

export default function Login() {
  const navigate   = useNavigate();
  const { login, isLoading } = useAuthStore();
  const { lang, dark, toggleLang, toggleDark } = useUiStore();
  const ar = lang === 'ar';

  const STORAGE_KEY = 'wfm_remember';

  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'); } catch { return null; }
  })();

  const [email,    setEmail]    = useState<string>(saved?.email    ?? '');
  const [password, setPassword] = useState<string>(saved?.password ?? '');
  const [remember, setRemember] = useState<boolean>(!!saved);
  const [showPass, setShowPass] = useState(false);
  const [error,    setError]    = useState('');
  const [focused,  setFocused]  = useState<'email' | 'pass' | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      if (remember) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ email, password }));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
      navigate('/dashboard');
    } catch (err: any) {
      const s = err?.response?.status;
      setError(s === 401 || s === 403 ? t(lang, 'invalidCredentials') : t(lang, 'serverError'));
    }
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg,#060a14 0%,#0d1425 40%,#0a0e1c 100%)' }}
    >
      {/* ── Animated mesh orbs ────────────────────────────────────────────── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        {/* Orb 1 — indigo */}
        <div
          className="anim-orb-a absolute rounded-full blur-3xl opacity-25"
          style={{
            width: 600, height: 600,
            top: '-15%', left: ar ? 'auto' : '-10%', right: ar ? '-10%' : 'auto',
            background: 'radial-gradient(circle,#6366f1 0%,transparent 70%)',
          }}
        />
        {/* Orb 2 — violet */}
        <div
          className="anim-orb-b absolute rounded-full blur-3xl opacity-20"
          style={{
            width: 500, height: 500,
            bottom: '-10%', right: ar ? 'auto' : '-5%', left: ar ? '-5%' : 'auto',
            background: 'radial-gradient(circle,#8b5cf6 0%,transparent 70%)',
          }}
        />
        {/* Orb 3 — cyan accent */}
        <div
          className="anim-orb-c absolute rounded-full blur-2xl opacity-15"
          style={{
            width: 300, height: 300,
            top: '40%', left: ar ? '10%' : 'auto', right: ar ? 'auto' : '10%',
            background: 'radial-gradient(circle,#06b6d4 0%,transparent 70%)',
          }}
        />
        {/* Grid lines */}
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.5) 1px,transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      {/* ── Top bar controls ──────────────────────────────────────────────── */}
      <div className="absolute top-5 end-5 flex items-center gap-2 z-20">
        <button
          onClick={toggleLang}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                     bg-white/8 hover:bg-white/14 border border-white/10
                     text-slate-300 hover:text-white text-xs font-medium
                     transition-all duration-200 backdrop-blur-sm"
        >
          <Globe size={13} />
          {ar ? 'EN' : 'عر'}
        </button>
        <button
          onClick={toggleDark}
          className="p-1.5 rounded-xl bg-white/8 hover:bg-white/14 border border-white/10
                     text-slate-400 hover:text-white transition-all duration-200 backdrop-blur-sm"
          aria-label={dark ? 'Light mode' : 'Dark mode'}
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>

      {/* ── Main card ─────────────────────────────────────────────────────── */}
      <div className={`relative z-10 w-full max-w-[420px] anim-scaleIn`} dir={ar ? 'rtl' : 'ltr'}>

        {/* Logo + brand */}
        <div className="text-center mb-8 anim-fadeUp">
          {/* Logo mark */}
          <div className="inline-flex items-center justify-center relative mb-5">
            {/* Ring pulse */}
            <div
              className="absolute w-20 h-20 rounded-2xl anim-ring opacity-60"
              style={{ background: 'transparent' }}
            />
            {/* Logo box */}
            <div
              className="relative w-16 h-16 rounded-2xl flex items-center justify-center shadow-2xl"
              style={{
                background: 'linear-gradient(135deg,#4f46e5,#7c3aed)',
                boxShadow: '0 8px 32px rgba(99,102,241,.45), 0 0 0 1px rgba(255,255,255,.08)',
              }}
            >
              <Zap size={28} className="text-white" fill="white" />
            </div>
          </div>

          <h1
            className="text-2xl font-bold text-white tracking-tight"
            style={{ letterSpacing: '-0.02em' }}
          >
            {ar ? 'منصة إدارة القوى العاملة' : 'WFM Platform'}
          </h1>
          <p className="text-slate-400 text-sm mt-1.5 flex items-center justify-center gap-1.5">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400"
              style={{ boxShadow: '0 0 6px #10b981' }}
            />
            {ar ? 'النظام جاهز ويعمل' : 'System operational'}
          </p>
        </div>

        {/* Glass form card */}
        <div
          className="rounded-2xl p-8 anim-fadeUp delay-1"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(24px)',
            boxShadow: '0 32px 64px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.06)',
          }}
        >
          <h2 className="text-lg font-semibold text-white mb-1">
            {ar ? 'تسجيل الدخول' : 'Sign in to your account'}
          </h2>
          <p className="text-slate-500 text-sm mb-7">
            {ar ? 'أدخل بيانات الدخول للمتابعة' : 'Enter your credentials to continue'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                {ar ? 'البريد الإلكتروني' : 'Email Address'}
              </label>
              <div
                className="relative transition-all duration-200"
                style={{
                  borderRadius: 12,
                  boxShadow: focused === 'email'
                    ? '0 0 0 2px rgba(99,102,241,.5), 0 4px 16px rgba(99,102,241,.15)'
                    : '0 2px 8px rgba(0,0,0,.2)',
                }}
              >
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onFocus={() => setFocused('email')}
                  onBlur={() => setFocused(null)}
                  placeholder={ar ? 'أدخل بريدك الإلكتروني' : 'you@company.com'}
                  className="w-full px-4 py-3.5 rounded-xl text-sm text-white placeholder:text-slate-600 outline-none"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    transition: 'border-color .2s',
                    borderColor: focused === 'email' ? 'rgba(99,102,241,.6)' : 'rgba(255,255,255,.08)',
                  }}
                  required
                  dir="ltr"
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                {ar ? 'كلمة المرور' : 'Password'}
              </label>
              <div
                className="relative transition-all duration-200"
                style={{
                  borderRadius: 12,
                  boxShadow: focused === 'pass'
                    ? '0 0 0 2px rgba(99,102,241,.5), 0 4px 16px rgba(99,102,241,.15)'
                    : '0 2px 8px rgba(0,0,0,.2)',
                }}
              >
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={() => setFocused('pass')}
                  onBlur={() => setFocused(null)}
                  placeholder={ar ? 'أدخل كلمة المرور' : '••••••••••••'}
                  className="w-full px-4 py-3.5 rounded-xl text-sm text-white placeholder:text-slate-600 outline-none"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderColor: focused === 'pass' ? 'rgba(99,102,241,.6)' : 'rgba(255,255,255,.08)',
                    paddingInlineEnd: '3rem',
                  }}
                  required
                  dir="ltr"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute inset-y-0 flex items-center px-1 text-slate-500 hover:text-slate-300 transition-colors"
                  style={{ right: 12 }}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <label
              className="flex items-center gap-2.5 cursor-pointer select-none group w-fit"
              style={{ marginTop: 2 }}
            >
              <div
                onClick={() => setRemember(r => !r)}
                style={{
                  width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                  border: `1.5px solid ${remember ? '#6366f1' : 'rgba(255,255,255,0.2)'}`,
                  background: remember
                    ? 'linear-gradient(135deg,#4f46e5,#7c3aed)'
                    : 'rgba(255,255,255,0.05)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all .2s',
                  boxShadow: remember ? '0 0 0 3px rgba(99,102,241,0.2)' : 'none',
                }}
              >
                {remember && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 3.5L3.8 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <input type="checkbox" className="sr-only" checked={remember} onChange={e => setRemember(e.target.checked)} />
              <span className="text-xs text-slate-400 group-hover:text-slate-300 transition-colors">
                {ar ? 'تذكرني' : 'Remember me'}
              </span>
            </label>

            {/* Error */}
            {error && (
              <div
                className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm text-red-300 anim-scaleIn"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}
              >
                <span className="mt-0.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5" />
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading || !email || !password}
              className="group w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl
                         font-semibold text-sm text-white mt-2
                         transition-all duration-200 hover:-translate-y-px active:translate-y-0
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0"
              style={{
                background: 'linear-gradient(135deg,#4f46e5,#7c3aed)',
                boxShadow: '0 8px 24px rgba(99,102,241,.4), 0 0 0 1px rgba(255,255,255,.08)',
              }}
            >
              {isLoading ? (
                <span className="dot-loader flex gap-1.5">
                  <span /><span /><span />
                </span>
              ) : (
                <>
                  {ar ? 'دخول' : 'Sign In'}
                  <ArrowRight
                    size={16}
                    className={`transition-transform duration-200 group-hover:translate-x-1 ${ar ? 'rotate-180' : ''}`}
                  />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-slate-600 text-xs mt-6 anim-fadeUp delay-2">
          {ar
            ? 'نظام إدارة القوى العاملة — جميع الحقوق محفوظة'
            : 'Workforce Management Platform — All rights reserved'
          }
        </p>
      </div>
    </div>
  );
}
