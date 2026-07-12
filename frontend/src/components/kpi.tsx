/**
 * PROVENANCE KIT — <Kpi> tile.
 *
 * The Director's rule: every KPI number must be (a) clickable → a drill route
 * where the number can be explored, and (b) able to show WHERE it came from
 * (endpoint + table + definition + period) via a small ⓘ popover.
 *
 * Theme-aware via CSS variables (--surface / --border / --text-1/2/3) so one
 * component renders correctly in all three themes (Dark / Light / Aurora-Glass),
 * matching the dazzle-kit StatTile look. RTL-aware (dir follows lang).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { Sparkline } from '@/components/dazzle';

export interface KpiSource {
  /** e.g. "GET /api/v1/control-dashboard" */
  endpoint: string;
  /** e.g. "attendance_records" */
  table?: string;
  /** What the number actually is — canonical wording, English. */
  definition: string;
  /** Optional Arabic definition; falls back to `definition`. */
  definitionAr?: string;
  /** e.g. "2026-07-01 → 2026-07-10" or "latest attendance date" */
  period?: string;
}

/* ── Source popover ───────────────────────────────────────────────────────── */
function SourcePopover({ source, ar, onClose }: { source: KpiSource; ar: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [onClose]);

  const Row = ({ k, v, mono = false }: { k: string; v: React.ReactNode; mono?: boolean }) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', flexShrink: 0, minWidth: 52 }}>{k}</span>
      <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: mono ? 'ui-monospace, monospace' : undefined, wordBreak: 'break-word', direction: mono ? 'ltr' : undefined, unicodeBidi: mono ? 'embed' : undefined }}>{v}</span>
    </div>
  );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={ar ? 'مصدر البيانات' : 'Data source'}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', top: 30, insetInlineEnd: 8, zIndex: 60,
        width: 260, maxWidth: 'calc(100vw - 48px)',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '10px 12px',
        boxShadow: '0 12px 32px rgba(0,0,0,0.35), 0 0 0 1px var(--border)',
        display: 'flex', flexDirection: 'column', gap: 7,
        cursor: 'default', textAlign: 'start',
        animation: 'ds-fadein .15s ease',
      }}
    >
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-1)' }}>
        {ar ? 'المصدر' : 'Source'}
      </div>
      <Row k={ar ? 'الواجهة' : 'Endpoint'} v={source.endpoint} mono />
      {source.table && <Row k={ar ? 'الجدول' : 'Table'} v={source.table} mono />}
      <Row k={ar ? 'التعريف' : 'Definition'} v={ar ? (source.definitionAr ?? source.definition) : source.definition} />
      {source.period && <Row k={ar ? 'الفترة' : 'Period'} v={source.period} />}
    </div>
  );
}

/* ── Kpi tile ─────────────────────────────────────────────────────────────── */
export function Kpi({ label, value, source, drill, accent = '#6366f1', sub, icon, spark, sparkColor }: {
  label: string;
  value: React.ReactNode;
  source: KpiSource;            // REQUIRED — provenance is the whole point
  drill?: string;               // route to navigate on click
  accent?: string;              // semantic accent color
  sub?: string;
  icon?: React.ReactNode;
  /** Optional mini trend series rendered as an inline sparkline under the value. */
  spark?: number[];
  /** Sparkline stroke color — defaults to the tile accent. */
  sparkColor?: string;
}) {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const navigate = useNavigate();
  const [hov, setHov] = useState(false);
  const [open, setOpen] = useState(false);
  const clickable = !!drill;

  const go = () => { if (drill) navigate(drill); };

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? label : undefined}
      dir={ar ? 'rtl' : 'ltr'}
      onClick={clickable ? go : undefined}
      onKeyDown={clickable ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }) : undefined}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: 'relative', borderRadius: 16, padding: '14px 16px',
        background: 'var(--surface)', border: '1px solid var(--border)',
        transform: hov && clickable ? 'translateY(-3px)' : 'translateY(0)',
        boxShadow: hov && clickable
          ? `0 12px 30px ${accent}28, 0 0 0 1px ${accent}55`
          : '0 1px 3px rgba(0,0,0,0.05)',
        transition: 'transform .25s cubic-bezier(.34,1.56,.64,1), box-shadow .25s',
        cursor: clickable ? 'pointer' : 'default',
        outline: 'none', minWidth: 0,
      }}
    >
      {/* accent top edge (rounded on itself — tile keeps overflow visible for the popover) */}
      <div style={{ position: 'absolute', insetInlineStart: 12, insetInlineEnd: 12, top: 0, height: 2.5, borderRadius: '0 0 3px 3px', background: `linear-gradient(90deg, ${accent}, ${accent}22)`, pointerEvents: 'none' }} />

      {/* ⓘ provenance affordance — always rendered */}
      <button
        type="button"
        aria-label={ar ? 'المصدر' : 'Source'}
        title={ar ? 'المصدر' : 'Source'}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        onKeyDown={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 8, insetInlineEnd: 8,
          width: 20, height: 20, borderRadius: 7,
          display: 'grid', placeItems: 'center',
          background: open ? `${accent}22` : 'transparent',
          border: 'none', padding: 0, cursor: 'pointer',
          color: open ? accent : 'var(--text-3)',
          opacity: hov || open ? 1 : 0.45,
          transition: 'opacity .15s, color .15s, background .15s',
        }}
      >
        <Info size={12} strokeWidth={2.2} />
      </button>
      {open && <SourcePopover source={source} ar={ar} onClose={() => setOpen(false)} />}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, paddingInlineEnd: 22 }}>
        {icon && (
          <div style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: `${accent}1f`, color: accent, flexShrink: 0, transition: 'transform .25s', transform: hov && clickable ? 'scale(1.1)' : 'none' }}>
            {icon}
          </div>
        )}
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </div>
      <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {sub != null && <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
      {spark && spark.length >= 2 && (
        <div style={{ marginTop: 8, marginInline: -2 }}>
          <Sparkline data={spark} color={sparkColor || accent} height={24} />
        </div>
      )}
    </div>
  );
}

/* ── KpiRow — responsive grid wrapper ─────────────────────────────────────── */
export function KpiRow({ children, cols = 4, className = '' }: {
  children: React.ReactNode;
  /** max columns at lg breakpoint: 4 (default) or 6 */
  cols?: 4 | 6;
  className?: string;
}) {
  const lg = cols === 6 ? 'lg:grid-cols-6' : 'lg:grid-cols-4';
  return (
    <div className={`grid gap-3 grid-cols-2 sm:grid-cols-3 ${lg} ${className}`}>
      {children}
    </div>
  );
}
