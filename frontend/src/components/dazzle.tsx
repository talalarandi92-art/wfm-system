/**
 * WFM "Dazzle" kit — premium, theme-aware, animated primitives.
 *
 * Everything here reads the theme CSS variables (--surface, --surface-2,
 * --border, --text-1/2/3) so a single component looks correct across ALL three
 * themes (Dark / Light / Aurora-Glass) with zero per-theme code. Motion is
 * tasteful and fully respects prefers-reduced-motion.
 *
 * Building blocks:
 *   useReducedMotion()  — honor the OS "reduce motion" setting
 *   useCountUp()        — ease-out count-up that snaps to the target if reduced
 *   <StatTile/>         — animated KPI tile: count-up value, accent edge, glow, hover-lift
 *   <Donut/>            — animated SVG ring with count-up center + legend
 *   <BarRow/>           — a single growing horizontal bar row
 */
import { useEffect, useRef, useState } from 'react';

/* ── Reduced-motion ───────────────────────────────────────────────────────── */
export function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    setR(m.matches);
    const h = (e: MediaQueryListEvent) => setR(e.matches);
    m.addEventListener?.('change', h);
    return () => m.removeEventListener?.('change', h);
  }, []);
  return r;
}

/* ── Count-up ─────────────────────────────────────────────────────────────── */
export function useCountUp(target: number, ms = 900, run = true) {
  const reduced = useReducedMotion();
  const [v, setV] = useState(0);
  const raf = useRef(0);
  const decimals = useRef(0);
  // keep one decimal place if the target isn't whole (e.g. 12.5h)
  decimals.current = Number.isInteger(target) ? 0 : 1;
  useEffect(() => {
    if (!run || reduced || target === 0) { setV(target); return; }
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / ms, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const cur = target * eased;
      setV(decimals.current ? Math.round(cur * 10) / 10 : Math.round(cur));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms, run, reduced]);

  /* Truth beats decoration. A tile that mounts BEFORE its data (num=0) and is
     later handed the real value was observed rendering a stale 0 while the rows
     underneath it showed 31 — a wrong number on screen is worse than no
     animation. This guarantees the displayed value can never lag its target:
     once the animation window has passed, snap to the truth. */
  useEffect(() => {
    if (v === target) return;
    const t = setTimeout(() => setV((cur) => (cur === target ? cur : target)), ms + 120);
    return () => clearTimeout(t);
  }, [target, ms, v]);

  return v;
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

/* ── StatTile ─────────────────────────────────────────────────────────────── */
export function StatTile({ icon: Icon, label, num, suffix = '', value, sub, color, delay = 0, onClick, trend, trendColor }: {
  icon?: any; label: string;
  num?: number; suffix?: string; value?: string; sub?: React.ReactNode;
  color: string; delay?: number; onClick?: () => void;
  trend?: number[]; trendColor?: string;
}) {
  const reduced = useReducedMotion();
  const [rdy, setRdy] = useState(false);
  const [hov, setHov] = useState(false);
  useEffect(() => { const t = setTimeout(() => setRdy(true), reduced ? 0 : delay); return () => clearTimeout(t); }, [delay, reduced]);
  const n = useCountUp(num ?? 0, 900, rdy && num !== undefined);
  const disp = num !== undefined ? fmt(n) + suffix : (value ?? '—');

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: 'relative', overflow: 'hidden', borderRadius: 16, padding: '14px 16px',
        background: 'var(--surface)', border: '1px solid var(--border)',
        opacity: rdy ? 1 : 0,
        transform: hov ? 'translateY(-3px)' : (rdy ? 'translateY(0)' : 'translateY(10px)'),
        boxShadow: hov ? `0 12px 30px ${color}28, 0 0 0 1px ${color}33` : '0 1px 3px rgba(0,0,0,0.05)',
        transition: 'opacity .4s ease, transform .28s cubic-bezier(.34,1.56,.64,1), box-shadow .25s',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {/* accent top edge */}
      <div style={{ position: 'absolute', insetInlineStart: 0, insetInlineEnd: 0, top: 0, height: 2.5, background: `linear-gradient(90deg, ${color}, ${color}22)` }} />
      {/* soft corner glow */}
      <div style={{ position: 'absolute', top: -28, insetInlineEnd: -18, width: 92, height: 92, borderRadius: '50%', background: color, opacity: hov ? 0.16 : 0.07, filter: 'blur(26px)', transition: 'opacity .25s', pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        {Icon && (
          <div style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: `${color}1f`, color, transition: 'transform .25s', transform: hov ? 'scale(1.12) rotate(-4deg)' : 'none' }}>
            <Icon size={15} strokeWidth={2.2} />
          </div>
        )}
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </div>
      <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{disp}</div>
      {sub != null && <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
      {trend && trend.length > 1 && (
        <div style={{ marginTop: 9, marginInline: -2 }}><Sparkline data={trend} color={trendColor || color} height={26} /></div>
      )}
    </div>
  );
}

/* ── Donut ────────────────────────────────────────────────────────────────── */
export function Donut({ segments, centerNum, centerSuffix = '', centerLabel, size = 168, thickness = 14 }: {
  segments: { label: string; value: number; color: string }[];
  centerNum: number; centerSuffix?: string; centerLabel: string;
  size?: number; thickness?: number;
}) {
  const reduced = useReducedMotion();
  const [grown, setGrown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setGrown(true), reduced ? 0 : 120); return () => clearTimeout(t); }, [reduced]);
  const r = (size - thickness) / 2 - 2;
  const cx = size / 2, cy = size / 2, circ = 2 * Math.PI * r;
  const sum = segments.reduce((a, s) => a + s.value, 0) || 1;
  const center = useCountUp(centerNum, 1000, true);
  let acc = 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} />
          {segments.map((s, i) => {
            const frac = (s.value || 0) / sum;
            const len = (grown ? frac : 0) * circ;
            const off = -acc * circ; acc += frac;
            return (
              <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
                strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={off}
                style={{ transition: reduced ? 'none' : `stroke-dasharray 1s cubic-bezier(.4,0,.2,1) ${i * 0.18}s` }} />
            );
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 23, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{fmt(center)}{centerSuffix}</div>
            <div style={{ fontSize: 9.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 2 }}>{centerLabel}</div>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 130, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {segments.map((s, i) => {
          const pct = Math.round(100 * (s.value || 0) / sum);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0, boxShadow: `0 0 8px ${s.color}66` }} />
              <span style={{ fontSize: 11.5, color: 'var(--text-2)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{fmt(s.value || 0)}</span>
              <span style={{ fontSize: 10, color: 'var(--text-3)', width: 32, textAlign: 'end' }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── BarRow ───────────────────────────────────────────────────────────────── */
export function BarRow({ label, value, max, color, suffix = '', delay = 0 }: {
  label: string; value: number; max: number; color: string; suffix?: string; delay?: number;
}) {
  const reduced = useReducedMotion();
  const [grown, setGrown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setGrown(true), reduced ? 0 : 80 + delay); return () => clearTimeout(t); }, [delay, reduced]);
  const pct = Math.round(100 * value / (max || 1));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
      <span style={{ width: 96, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <div style={{ flex: 1, height: 8, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 99, width: grown ? `${pct}%` : '0%',
          background: `linear-gradient(90deg, ${color}cc, ${color})`,
          boxShadow: `0 0 10px ${color}55`,
          transition: reduced ? 'none' : 'width .9s cubic-bezier(.4,0,.2,1)',
        }} />
      </div>
      <span style={{ width: 64, textAlign: 'end', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{fmt(value)}{suffix}</span>
    </div>
  );
}

/* ── Gauge ────────────────────────────────────────────────────────────────── */
/** A 270° radial dial with a count-up center — for any single 0-100 metric
 *  (conformance, SLA, occupancy, approval rate…). Theme-var + reduced-motion. */
export function Gauge({ value, label, color, size = 140, suffix = '%', sub }: {
  value: number; label: string; color: string; size?: number; suffix?: string; sub?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const [grown, setGrown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setGrown(true), reduced ? 0 : 140); return () => clearTimeout(t); }, [reduced]);
  const v = useCountUp(value, 1000, true);
  const thickness = Math.max(8, Math.round(size * 0.09));
  const r = (size - thickness) / 2 - 2;
  const cx = size / 2, cy = size / 2, circ = 2 * Math.PI * r;
  const ARC = 0.75; // 270° gauge, gap at the bottom
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const track = ARC * circ;
  const prog = (grown ? pct : 0) * ARC * circ;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(135deg)' }}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} strokeLinecap="round" strokeDasharray={`${track} ${circ}`} />
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round" strokeDasharray={`${prog} ${circ}`}
            style={{ transition: reduced ? 'none' : 'stroke-dasharray 1s cubic-bezier(.4,0,.2,1)', filter: `drop-shadow(0 0 5px ${color}55)` }} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: Math.round(size * 0.21), fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmt(v)}{suffix}</div>
            {sub != null && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>{sub}</div>}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-2)', textAlign: 'center' }}>{label}</div>
    </div>
  );
}

/* ── Sparkline ────────────────────────────────────────────────────────────── */
/** A responsive mini trend line (fills its container width) with a gradient
 *  area fill and a draw-on animation. Theme-agnostic colour; reduced-motion aware. */
export function Sparkline({ data, color, height = 30, strokeWidth = 1.75, fill = true }: {
  data: number[]; color: string; height?: number; strokeWidth?: number; fill?: boolean;
}) {
  const reduced = useReducedMotion();
  const [drawn, setDrawn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDrawn(true), reduced ? 0 : 150); return () => clearTimeout(t); }, [reduced]);
  if (!data || data.length < 2) return <div style={{ height }} />;
  const W = 100, H = height, pad = 2;
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
  const xs = (i: number) => (i / (data.length - 1)) * W;
  const ys = (v: number) => pad + (1 - (v - min) / range) * (H - 2 * pad);
  const line = `M ${data.map((v, i) => `${xs(i).toFixed(2)},${ys(v).toFixed(2)}`).join(' L ')}`;
  const area = `${line} L ${W},${H} L 0,${H} Z`;
  const gid = `spk-${color.replace('#', '')}-${Math.round(H)}`;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.26} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`} style={{ opacity: drawn ? 1 : 0, transition: reduced ? 'none' : 'opacity .6s ease .35s' }} />}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
        vectorEffect="non-scaling-stroke" pathLength={1}
        style={{ strokeDasharray: 1, strokeDashoffset: drawn ? 0 : 1, transition: reduced ? 'none' : 'stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)' }} />
    </svg>
  );
}
