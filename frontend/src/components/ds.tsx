/**
 * WFM Design System — Nexora WFM style
 * All pages import from here for visual consistency.
 */
import { useEffect, useState, useRef } from 'react';
import {
  Construction, WifiOff, ChevronUp, ChevronDown,
  RefreshCw, Loader2,
} from 'lucide-react';

/* ── Keyframes injected once ─────────────────────────────────────────────── */
export const DS_ANIMS = `
  @keyframes ds-pulse  { 0%,100%{opacity:1} 50%{opacity:.4} }
  @keyframes ds-ring   { 0%{transform:scale(.85);opacity:.9} 100%{transform:scale(1.7);opacity:0} }
  @keyframes ds-slide  { from{transform:translateY(10px);opacity:0} to{transform:translateY(0);opacity:1} }
  @keyframes ds-spin   { to{transform:rotate(360deg)} }
  @keyframes ds-fadein { from{opacity:0} to{opacity:1} }
`;

export function useInjectDsStyles() {
  useEffect(() => {
    if (document.getElementById('wfm-ds-styles')) return;
    const el = document.createElement('style');
    el.id = 'wfm-ds-styles';
    el.textContent = DS_ANIMS;
    document.head.appendChild(el);
    return () => { /* leave it; global styles shared */ };
  }, []);
}

/* ── Design tokens ────────────────────────────────────────────────────────── */
export const card = (dark: boolean) => ({
  background: dark ? 'rgba(255,255,255,0.04)' : '#fff',
  border: `1px solid ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}`,
  borderRadius: 18,
  boxShadow: dark ? 'none' : '0 1px 4px rgba(0,0,0,0.04)',
});

export const tp = (dark: boolean) => dark ? '#f1f5f9' : '#0f172a';
export const ts = (dark: boolean) => dark ? '#64748b' : '#94a3b8';
export const divider = (dark: boolean) => `1px solid ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}`;

/* ── Unified status palette ───────────────────────────────────────────────────
   One green/amber/red/gray scale for the whole app so a status reads the same
   everywhere. Prefer these over ad-hoc inline hexes. */
export const STATUS = {
  ok: '#22c55e', good: '#22c55e',
  warn: '#f59e0b', caution: '#f59e0b',
  risk: '#ef4444', bad: '#ef4444', fail: '#ef4444',
  info: '#64748b', neutral: '#64748b', skip: '#64748b',
} as const;
export type StatusKey = keyof typeof STATUS;
export const sevColor = (level: StatusKey) => STATUS[level] ?? STATUS.info;
/** Color a gap/surplus: ≥ warnAt+1 green, ≥ warnAt amber, else red. */
export const gapColor = (gap: number, warnAt = 0) => gap >= warnAt + 1 ? STATUS.ok : gap >= warnAt ? STATUS.warn : STATUS.risk;
/** Color a 0–100 score: ≥90 green, ≥70 amber, else red. */
export const scoreColor = (s: number) => s >= 90 ? STATUS.ok : s >= 70 ? STATUS.warn : STATUS.risk;

/* ── Animated counter hook ───────────────────────────────────────────────── */
export function useCountUp(target: number, ms = 800, run = true) {
  const [v, setV] = useState(0);
  const f = useRef(0);
  useEffect(() => {
    if (!run || target === 0) { setV(target); return; }
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / ms, 1);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) f.current = requestAnimationFrame(tick);
    };
    f.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(f.current);
  }, [target, ms, run]);
  return v;
}

/* ── NxCard ──────────────────────────────────────────────────────────────── */
export function NxCard({ children, dark, style, pad = '20px 22px', hover = false }: {
  children: React.ReactNode; dark: boolean; style?: React.CSSProperties; pad?: string; hover?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={hover ? () => setHov(true) : undefined}
      onMouseLeave={hover ? () => setHov(false) : undefined}
      style={{
        ...card(dark),
        padding: pad,
        boxShadow: hov ? '0 8px 28px rgba(99,102,241,0.1)' : (dark ? 'none' : '0 1px 4px rgba(0,0,0,0.04)'),
        transition: hover ? 'box-shadow 0.2s' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ── NxKpiCard ───────────────────────────────────────────────────────────── */
export function NxKpiCard({ icon: Icon, title, titleAr, value, numValue, sub, subAr, trendPct, trendLabel, trendLabelAr, color, dark, ar, onClick, delay = 0 }: {
  icon: any; title: string; titleAr: string;
  value?: string; numValue?: number;
  sub?: string; subAr?: string;
  trendPct?: number; trendLabel?: string; trendLabelAr?: string;
  color: string; dark: boolean; ar: boolean;
  onClick?: () => void; delay?: number;
}) {
  const [hov, setHov] = useState(false);
  const [rdy, setRdy] = useState(false);
  useEffect(() => { const t = setTimeout(() => setRdy(true), delay); return () => clearTimeout(t); }, [delay]);
  const num = useCountUp(numValue ?? 0, 800, rdy && numValue !== undefined);
  const disp = numValue !== undefined ? num.toLocaleString() : (value ?? '—');
  const up = (trendPct ?? 0) >= 0;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: 1, minWidth: 0,
        ...card(dark),
        padding: '16px 18px',
        cursor: onClick ? 'pointer' : 'default',
        opacity: rdy ? 1 : 0,
        transform: hov ? 'translateY(-3px)' : (rdy ? 'translateY(0)' : 'translateY(10px)'),
        boxShadow: hov ? `0 8px 28px ${color}22, 0 0 0 1px ${color}18` : (dark ? 'none' : '0 1px 3px rgba(0,0,0,0.04)'),
        border: `1px solid ${hov ? color + '50' : (dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)')}`,
        borderRadius: 16,
        transition: 'all 0.2s cubic-bezier(.4,0,.2,1)',
        position: 'relative', overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: hov ? color : `${color}30`, borderRadius: '16px 16px 0 0', transition: 'background 0.2s' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: hov ? `${color}22` : `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s' }}>
          <Icon size={14} style={{ color, transform: hov ? 'scale(1.2)' : 'scale(1)', transition: 'transform 0.2s' }} strokeWidth={2.2} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 500, color: dark ? '#64748b' : '#94a3b8' }}>{ar ? titleAr : title}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1, color: dark ? '#f1f5f9' : '#0f172a', marginBottom: 6 }}>{disp}</div>
      {sub && <div style={{ fontSize: 11, color: dark ? '#475569' : '#94a3b8', marginBottom: 6 }}>{ar && subAr ? subAr : sub}</div>}
      {trendPct !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: up ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.1)', color: up ? '#10b981' : '#ef4444', border: `1px solid ${up ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.15)'}` }}>
            {up ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {Math.abs(trendPct).toFixed(1)}%
          </span>
          {trendLabel && <span style={{ fontSize: 11, color: dark ? '#475569' : '#94a3b8' }}>{ar && trendLabelAr ? trendLabelAr : trendLabel}</span>}
        </div>
      )}
    </div>
  );
}

/* ── NxBadge ─────────────────────────────────────────────────────────────── */
export function NxBadge({ status, custom, pulse }: {
  status?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple';
  custom?: { color: string; label: string };
  pulse?: boolean;
}) {
  const MAP = {
    success: { color: '#10b981', label: 'Good' },
    warning: { color: '#f59e0b', label: 'Watch' },
    danger:  { color: '#ef4444', label: 'At Risk' },
    info:    { color: '#38bdf8', label: 'Info' },
    neutral: { color: '#64748b', label: 'Neutral' },
    purple:  { color: '#8b5cf6', label: 'Active' },
  };
  const { color, label } = custom ?? MAP[status ?? 'neutral'];
  return (
    <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${color}15`, color, border: `1px solid ${color}30`, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
      {pulse && <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, animation: 'ds-pulse 1.5s ease infinite', display: 'inline-block' }} />}
      {label}
    </span>
  );
}

/* ── NxTableHead ─────────────────────────────────────────────────────────── */
export function NxTh({ children, dark, right = false }: { children: React.ReactNode; dark: boolean; right?: boolean }) {
  return (
    <th style={{ padding: '10px 20px', textAlign: right ? 'end' : 'start', fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: dark ? '#334155' : '#cbd5e1', whiteSpace: 'nowrap', userSelect: 'none' }}>
      {children}
    </th>
  );
}

/* ── NxTableRow ──────────────────────────────────────────────────────────── */
export function NxTr({ children, dark, onClick, accent }: { children: React.ReactNode; dark: boolean; onClick?: () => void; accent?: string }) {
  const [hov, setHov] = useState(false);
  return (
    <tr
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onClick}
      style={{
        background: hov ? (dark ? 'rgba(255,255,255,0.025)' : 'rgba(99,102,241,0.025)') : 'transparent',
        transition: 'background 0.15s',
        cursor: onClick ? 'pointer' : 'default',
        borderInlineStart: hov && accent ? `3px solid ${accent}` : '3px solid transparent',
      }}
    >
      {children}
    </tr>
  );
}

export function NxTd({ children, dark, muted = false, mono = false, right = false }: {
  children: React.ReactNode; dark: boolean; muted?: boolean; mono?: boolean; right?: boolean;
}) {
  return (
    <td style={{ padding: '12px 20px', fontSize: 13, color: muted ? (dark ? '#475569' : '#94a3b8') : (dark ? '#e2e8f0' : '#1e293b'), fontVariantNumeric: mono ? 'tabular-nums' : undefined, textAlign: right ? 'end' : 'start' }}>
      {children}
    </td>
  );
}

/* ── NxEmpty ─────────────────────────────────────────────────────────────── */
export function NxEmpty({ icon: Icon = Construction, title, titleAr, desc, descAr, ar, dark }: {
  icon?: any; title: string; titleAr: string; desc?: string; descAr?: string; ar: boolean; dark: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', color: dark ? '#475569' : '#94a3b8', animation: 'ds-fadein 0.4s ease' }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <Icon size={24} style={{ color: dark ? '#334155' : '#cbd5e1' }} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: dark ? '#64748b' : '#475569', marginBottom: 6 }}>{ar ? titleAr : title}</div>
      {desc && <div style={{ fontSize: 13, color: dark ? '#334155' : '#94a3b8', textAlign: 'center', maxWidth: 320 }}>{ar && descAr ? descAr : desc}</div>}
    </div>
  );
}

/* ── NxLoading ───────────────────────────────────────────────────────────── */
export function NxLoading({ dark, ar }: { dark: boolean; ar: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '60px 0', color: dark ? '#64748b' : '#94a3b8' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', border: '3px solid rgba(99,102,241,0.2)', borderTopColor: '#6366f1', animation: 'ds-spin .7s linear infinite' }} />
      <span style={{ fontSize: 13 }}>{ar ? 'جاري التحميل...' : 'Loading...'}</span>
    </div>
  );
}

/* ── NxError ─────────────────────────────────────────────────────────────── */
export function NxError({ onRetry, dark, ar }: { onRetry: () => void; dark: boolean; ar: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderRadius: 14, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.15)', marginBottom: 16 }}>
      <WifiOff size={15} style={{ color: '#ef4444', flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13, color: '#f87171' }}>{ar ? 'تعذر التحميل — تأكد من تشغيل الخادم' : 'Could not load — check backend'}</span>
      <button onClick={onRetry} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: 'none', cursor: 'pointer' }}>
        {ar ? 'إعادة المحاولة' : 'Retry'}
      </button>
    </div>
  );
}

/* ── NxPageHeader ────────────────────────────────────────────────────────── */
export function NxPageHeader({ title, titleAr, desc, descAr, icon: Icon, color = '#6366f1', actions, dark, ar, onRefresh, refreshing }: {
  title: string; titleAr: string; desc?: string; descAr?: string;
  icon?: any; color?: string; actions?: React.ReactNode;
  dark: boolean; ar: boolean; onRefresh?: () => void; refreshing?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {Icon && (
          <div style={{ width: 40, height: 40, borderRadius: 12, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
            <Icon size={20} style={{ color }} strokeWidth={2} />
          </div>
        )}
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: '-0.03em', color: dark ? '#f1f5f9' : '#0f172a' }}>
            {ar ? titleAr : title}
          </h1>
          {desc && <p style={{ margin: '3px 0 0', fontSize: 13, color: dark ? '#64748b' : '#94a3b8' }}>{ar && descAr ? descAr : desc}</p>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {onRefresh && (
          <button onClick={onRefresh} style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}`, background: dark ? 'rgba(255,255,255,0.04)' : '#fff', color: dark ? '#64748b' : '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.18s' }}
            onMouseEnter={e => { const b = e.currentTarget; b.style.background = 'rgba(99,102,241,0.1)'; b.style.color = '#6366f1'; }}
            onMouseLeave={e => { const b = e.currentTarget; b.style.background = dark ? 'rgba(255,255,255,0.04)' : '#fff'; b.style.color = dark ? '#64748b' : '#94a3b8'; }}>
            <RefreshCw size={13} style={{ animation: refreshing ? 'ds-spin .7s linear infinite' : 'none' }} />
          </button>
        )}
        {actions}
      </div>
    </div>
  );
}

/* ── NxSectionTitle ──────────────────────────────────────────────────────── */
export function NxSectionTitle({ title, titleAr, icon: Icon, color = '#6366f1', action, dark, ar }: {
  title: string; titleAr: string; icon?: any; color?: string; action?: React.ReactNode; dark: boolean; ar: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {Icon && (
          <div style={{ width: 28, height: 28, borderRadius: 8, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={13} style={{ color }} />
          </div>
        )}
        <span style={{ fontSize: 13, fontWeight: 700, color: dark ? '#f1f5f9' : '#0f172a' }}>{ar ? titleAr : title}</span>
      </div>
      {action}
    </div>
  );
}

/* ── NxBtn ───────────────────────────────────────────────────────────────── */
export function NxBtn({ children, onClick, color = '#6366f1', variant = 'solid', size = 'md', icon: Icon, disabled, dark }: {
  children: React.ReactNode; onClick?: () => void; color?: string; variant?: 'solid' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg'; icon?: any; disabled?: boolean; dark?: boolean;
}) {
  const [hov, setHov] = useState(false);
  const pad = size === 'sm' ? '6px 12px' : size === 'lg' ? '10px 22px' : '8px 16px';
  const fs  = size === 'sm' ? 11 : size === 'lg' ? 14 : 12;
  const base = {
    solid:   { bg: hov ? color + 'e0' : color,             fg: '#fff',  border: color },
    outline: { bg: hov ? `${color}12` : 'transparent',     fg: color,   border: color + '60' },
    ghost:   { bg: hov ? (dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)') : 'transparent', fg: dark?'#94a3b8':'#64748b', border: 'transparent' },
  }[variant];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: pad, borderRadius: 10, fontSize: fs, fontWeight: 600,
        background: disabled ? (dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)') : base.bg,
        color: disabled ? (dark ? '#334155' : '#cbd5e1') : base.fg,
        border: `1px solid ${disabled ? 'transparent' : base.border}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.18s', whiteSpace: 'nowrap',
        transform: hov && !disabled ? 'translateY(-1px)' : 'none',
        boxShadow: hov && !disabled && variant === 'solid' ? `0 4px 14px ${color}40` : 'none',
      }}
    >
      {Icon && <Icon size={fs + 1} />}
      {children}
    </button>
  );
}

/* ── NxInput ─────────────────────────────────────────────────────────────── */
export function NxInput({ placeholder, value, onChange, icon: Icon, dark, type = 'text', style: sx }: {
  placeholder: string; value: string; onChange: (v: string) => void;
  icon?: any; dark: boolean; type?: string; style?: React.CSSProperties;
}) {
  const [foc, setFoc] = useState(false);
  return (
    <div style={{ position: 'relative', ...sx }}>
      {Icon && <Icon size={14} style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', color: foc ? '#6366f1' : (dark ? '#475569' : '#94a3b8'), pointerEvents: 'none', transition: 'color 0.15s' }} />}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFoc(true)}
        onBlur={() => setFoc(false)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: `9px 12px 9px ${Icon ? '36px' : '12px'}`,
          borderRadius: 10, fontSize: 13,
          background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
          border: `1px solid ${foc ? '#6366f180' : (dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)')}`,
          color: dark ? '#e2e8f0' : '#1e293b',
          outline: 'none', transition: 'border-color 0.15s',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

/* ── NxSelect ────────────────────────────────────────────────────────────── */
export function NxSelect({ value, onChange, options, dark, style: sx }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
  dark: boolean; style?: React.CSSProperties;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        padding: '8px 12px', borderRadius: 10, fontSize: 13,
        background: dark ? 'rgba(255,255,255,0.05)' : '#fff',
        border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
        color: dark ? '#e2e8f0' : '#1e293b',
        cursor: 'pointer', outline: 'none', ...sx,
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/* ── NxPlaceholder (for unfinished pages) ────────────────────────────────── */
export function NxPlaceholder({ title, titleAr, icon: Icon = Construction, dark, ar }: {
  title: string; titleAr: string; icon?: any; dark: boolean; ar: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16, animation: 'ds-fadein 0.4s ease' }}>
      <div style={{ width: 72, height: 72, borderRadius: 20, background: dark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={30} style={{ color: '#6366f1' }} />
      </div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: dark ? '#94a3b8' : '#475569', textAlign: 'center', marginBottom: 6 }}>{ar ? titleAr : title}</div>
        <div style={{ fontSize: 13, color: dark ? '#334155' : '#94a3b8', textAlign: 'center' }}>{ar ? 'قيد التطوير — قريباً' : 'Under development — coming soon'}</div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {[0,1,2].map(i=>(
          <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1', opacity: 0.3 + i * 0.25, animation: `ds-pulse ${1 + i * 0.3}s ease infinite`, animationDelay: `${i * 0.2}s` }} />
        ))}
      </div>
    </div>
  );
}

/* ── NxLiveBadge ─────────────────────────────────────────────────────────── */
export function NxLiveBadge({ ar }: { ar: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 12, fontSize: 12, fontWeight: 700, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#10b981', position: 'relative' }}>
      <span style={{ position: 'absolute', width: 6, height: 6, borderRadius: '50%', background: '#10b981', animation: 'ds-ring 1.5s ease infinite' }} />
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block', animation: 'ds-pulse 2s ease infinite', position: 'relative' }} />
      {ar ? 'مباشر' : 'Live'}
    </div>
  );
}

/* ── NxDivider ───────────────────────────────────────────────────────────── */
export function NxDivider({ dark }: { dark: boolean }) {
  return <div style={{ height: 1, background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', margin: '0 -1px' }} />;
}
