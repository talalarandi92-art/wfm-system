/**
 * FieldPicker — Sprinklr-grade field selection modal for Builder v2.
 *
 * Left rail: categories (from field.category — falls back to 'General' when the
 * backend catalog doesn't carry categories yet), with per-category counts.
 * Right: scrollable field cards — name + type badge + one-line description
 * (description hidden when the payload doesn't provide one). Search filters
 * name + description. Kind chips (All / Dimensions / Metrics). Multi-select
 * with checkmarks + a Selected (N) strip. Esc = cancel, Enter = done.
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, X, Check, Layers, Hash, Type as TypeIcon, CalendarDays } from 'lucide-react';
import { tp, ts, NxBtn } from '@/components/ds';

export type PickerField = {
  key: string; label_en: string; label_ar: string;
  kind: 'dimension' | 'metric';
  type?: string; format?: string; time?: boolean;
  badge?: 'dimension' | 'custom_dimension' | 'metric' | 'calculated_metric';
  category?: string; description_en?: string; description_ar?: string;
};

const BADGE_STYLE: Record<string, { color: string; en: string; ar: string }> = {
  dimension:         { color: '#6366f1', en: 'Dimension', ar: 'بُعد' },
  custom_dimension:  { color: '#8b5cf6', en: 'Custom Dimension', ar: 'بُعد مخصّص' },
  metric:            { color: '#22c55e', en: 'Metric', ar: 'مقياس' },
  calculated_metric: { color: '#14b8a6', en: 'Calculated Metric', ar: 'مقياس محسوب' },
};

const GENERAL = { en: 'General', ar: 'عام' };

export function FieldPicker({ fields, initial, kindDefault, dark, ar, onDone, onCancel }: {
  fields: PickerField[];
  initial: string[];                       // pre-selected field keys
  kindDefault?: 'all' | 'dimension' | 'metric';
  dark: boolean; ar: boolean;
  onDone: (selected: string[]) => void;    // keeps initial order, appends new picks
  onCancel: () => void;
}) {
  const L = (en: string, arv: string) => (ar ? arv : en);
  const label = (f: PickerField) => (ar ? f.label_ar : f.label_en) || f.label_en || f.key;
  const desc = (f: PickerField) => (ar ? f.description_ar : f.description_en) || (ar ? f.description_en : '') || '';

  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'dimension' | 'metric'>(kindDefault ?? 'all');
  const [cat, setCat] = useState<string>('*');
  const [sel, setSel] = useState<string[]>(initial);

  /* categories (fallback → General) */
  const catOf = (f: PickerField) => (f.category && f.category.trim()) || L(GENERAL.en, GENERAL.ar);
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of fields) m.set(catOf(f), (m.get(catOf(f)) ?? 0) + 1);
    return [...m.entries()];
  }, [fields, ar]); // eslint-disable-line

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return fields.filter(f =>
      (kind === 'all' || f.kind === kind) &&
      (cat === '*' || catOf(f) === cat) &&
      (!needle || label(f).toLowerCase().includes(needle) || f.key.toLowerCase().includes(needle) || desc(f).toLowerCase().includes(needle)),
    );
  }, [fields, q, kind, cat, ar]); // eslint-disable-line

  const toggle = (k: string) => setSel(s => (s.includes(k) ? s.filter(x => x !== k) : [...s, k]));
  const byKey = useMemo(() => Object.fromEntries(fields.map(f => [f.key, f])), [fields]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
      if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement && e.target.type === 'text' && q === '')) { onDone(sel); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [sel, onDone, onCancel, q]);

  const badgeOf = (f: PickerField) => BADGE_STYLE[f.badge ?? f.kind] ?? BADGE_STYLE[f.kind];
  const typeIcon = (f: PickerField) => (f.kind === 'metric' ? Hash : f.type === 'date' ? CalendarDays : TypeIcon);
  const border = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const chip = (active: boolean, color = '#6366f1'): React.CSSProperties => ({
    padding: '5px 11px', borderRadius: 9, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? color + '80' : border}`,
    background: active ? `${color}22` : 'transparent', color: active ? color : ts(dark),
  });

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 70, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} dir={ar ? 'rtl' : 'ltr'} style={{
        width: 860, maxWidth: '96vw', height: 620, maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        borderRadius: 18, overflow: 'hidden', background: dark ? '#0e1326' : '#fff',
        border: `1px solid ${border}`, boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
      }}>
        {/* header: title + filter chips + search */}
        <div style={{ padding: '14px 18px 10px', borderBottom: `1px solid ${border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Layers size={15} style={{ color: '#8b5cf6' }} />
            <span style={{ fontSize: 14.5, fontWeight: 800, color: tp(dark) }}>{L('Add fields', 'إضافة حقول')}</span>
            <span style={{ fontSize: 11, color: ts(dark) }}>{fields.length} {L('available', 'متاح')}</span>
            <button onClick={onCancel} style={{ marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: ts(dark), display: 'flex' }}><X size={17} /></button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {(['all', 'dimension', 'metric'] as const).map(k => (
              <button key={k} onClick={() => setKind(k)} style={chip(kind === k, k === 'metric' ? '#22c55e' : '#6366f1')}>
                {L({ all: 'All', dimension: 'Dimensions', metric: 'Metrics' }[k], { all: 'الكل', dimension: 'الأبعاد', metric: 'المقاييس' }[k])}
              </button>
            ))}
            <div style={{ position: 'relative', marginInlineStart: 'auto' }}>
              <Search size={13} style={{ position: 'absolute', insetInlineStart: 9, top: '50%', transform: 'translateY(-50%)', color: ts(dark) }} />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={L('Search fields…', 'ابحث في الحقول…')}
                style={{ padding: '7px 10px', paddingInlineStart: 28, borderRadius: 9, fontSize: 12, width: 220, outline: 'none',
                  background: dark ? 'rgba(255,255,255,0.05)' : '#f8fafc', border: `1px solid ${border}`, color: tp(dark) }} />
            </div>
          </div>
        </div>

        {/* body: categories rail | field cards */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ width: 208, flexShrink: 0, overflowY: 'auto', padding: 10, borderInlineEnd: `1px solid ${border}` }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: ts(dark), padding: '2px 8px 6px' }}>{L('Categories', 'التصنيفات')}</div>
            {[['*', fields.length] as [string, number], ...cats].map(([c, n]) => {
              const active = cat === c;
              return (
                <button key={c} onClick={() => setCat(c)} style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'start', cursor: 'pointer',
                  padding: '7px 9px', borderRadius: 9, marginBottom: 2, border: 'none', fontSize: 12, fontWeight: active ? 700 : 500,
                  background: active ? 'rgba(139,92,246,0.14)' : 'transparent', color: active ? '#a78bfa' : tp(dark),
                }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c === '*' ? L('All categories', 'كل التصنيفات') : c}</span>
                  <span style={{ fontSize: 10, color: ts(dark), fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
            {visible.length === 0 && <div style={{ padding: 24, fontSize: 12, color: ts(dark), textAlign: 'center' }}>{L('No fields match your search.', 'لا توجد حقول مطابقة.')}</div>}
            {visible.map(f => {
              const on = sel.includes(f.key);
              const b = badgeOf(f); const Icon = typeIcon(f); const d = desc(f);
              return (
                <button key={`${f.kind}:${f.key}`} onClick={() => toggle(f.key)} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'start', cursor: 'pointer',
                  padding: '10px 12px', borderRadius: 11, marginBottom: 6,
                  border: `1px solid ${on ? b.color + '70' : border}`,
                  background: on ? `${b.color}14` : (dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)'),
                }}>
                  <span style={{ width: 18, height: 18, borderRadius: 6, flexShrink: 0, marginTop: 1, display: 'grid', placeItems: 'center',
                    border: `1.5px solid ${on ? b.color : border}`, background: on ? b.color : 'transparent' }}>
                    {on && <Check size={12} color="#fff" strokeWidth={3} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <Icon size={12} style={{ color: b.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: tp(dark) }}>{label(f)}</span>
                      <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: `${b.color}1e`, color: b.color }}>{ar ? b.ar : b.en}</span>
                    </span>
                    {d && <span style={{ display: 'block', fontSize: 11, color: ts(dark), marginTop: 3, lineHeight: 1.45 }}>{d}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* footer: selected strip + actions */}
        <div style={{ padding: '10px 18px', borderTop: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: ts(dark), flexShrink: 0 }}>{L(`Selected (${sel.length})`, `المختارة (${sel.length})`)}</span>
            {sel.map(k => {
              const f = byKey[k]; if (!f) return null; const b = badgeOf(f);
              return (
                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: `${b.color}18`, border: `1px solid ${b.color}40`, color: b.color }}>
                  {label(f)}
                  <X size={11} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); toggle(k); }} />
                </span>
              );
            })}
          </div>
          <NxBtn variant="ghost" dark={dark} onClick={onCancel}>{L('Cancel', 'إلغاء')}</NxBtn>
          <NxBtn color="#8b5cf6" dark={dark} onClick={() => onDone(sel)}>{L('Done', 'تم')}</NxBtn>
        </div>
      </div>
    </div>
  );
}
