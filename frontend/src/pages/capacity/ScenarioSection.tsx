/**
 * ③ SCENARIOS — base / surge / quiet / OT side-by-side with delta arrows.
 * Powered by GET /capacity/staffing/scenario-compare?from&to (parallel backend
 * agent). Until that endpoint lands, this section graceful-hides entirely —
 * no fake scenario numbers. The normalizer is defensive about the exact shape.
 */
import { useMemo } from 'react';
import { GitCompareArrows, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Section, nfmt, PAL, type Maybe } from './kit';

interface ScenCard {
  key: string;
  required: number | null;
  hire: number | null;
  peak: number | null;
  label?: string;
  labelAr?: string;
}

const SCEN_META: Record<string, { en: string; ar: string; color: string; descEn: string; descAr: string }> = {
  base:  { en: 'Base',  ar: 'الأساس',   color: PAL.require, descEn: 'the plan as forecast', descAr: 'الخطة كما هي متوقعة' },
  surge: { en: 'Surge', ar: 'ذروة',     color: PAL.risk,    descEn: 'demand spike',         descAr: 'قفزة في الطلب' },
  quiet: { en: 'Quiet', ar: 'هادئ',     color: PAL.demand,  descEn: 'soft demand',          descAr: 'طلب منخفض' },
  ot:    { en: 'OT',    ar: 'أوفرتايم', color: PAL.warn,    descEn: 'overtime absorbs gap', descAr: 'الأوفرتايم يمتص الفجوة' },
};

const num = (o: Record<string, unknown>, keys: string[]): number | null => {
  for (const k of keys) { const v = o[k]; if (typeof v === 'number' && !Number.isNaN(v)) return v; }
  return null;
};

export function normalizeScenarios(data: unknown): ScenCard[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  let entries: [string, Record<string, unknown>][] = [];
  if (Array.isArray(d.scenarios)) {
    entries = (d.scenarios as Record<string, unknown>[]).map(s => [String(s.key ?? s.name ?? s.scenario ?? '?'), s]);
  } else if (d.scenarios && typeof d.scenarios === 'object') {
    entries = Object.entries(d.scenarios as Record<string, Record<string, unknown>>);
  } else {
    entries = Object.entries(d).filter(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && SCEN_META[k.toLowerCase()]) as [string, Record<string, unknown>][];
  }
  return entries.map(([key, s]) => ({
    key: key.toLowerCase(),
    required: num(s, ['totalRequired', 'requiredBodies', 'required', 'bodiesPerDay', 'needs']),
    hire: num(s, ['internsToHire', 'totalInternsToHire', 'hire', 'interns']),
    peak: num(s, ['requiredPeak', 'peak', 'peakHc']),
    label: typeof s.label === 'string' ? s.label : typeof s.label_en === 'string' ? s.label_en : undefined,
    labelAr: typeof s.label_ar === 'string' ? s.label_ar : undefined,
  })).filter(c => c.required != null || c.hire != null || c.peak != null);
}

function Delta({ v, ar, invert = false }: { v: number; ar: boolean; invert?: boolean }) {
  if (v === 0) {
    return <span className="inline-flex items-center gap-0.5 text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>
      <Minus size={9} /> {ar ? 'مثل الأساس' : 'same as base'}
    </span>;
  }
  const up = v > 0;
  const bad = invert ? !up : up;           // more required/hire = red, less = green
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-black tabular-nums"
      style={{ color: bad ? PAL.risk : PAL.ok }}>
      {up ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
      {up ? '+' : '−'}{nfmt(Math.abs(v))} {ar ? 'عن الأساس' : 'vs base'}
    </span>
  );
}

export default function ScenarioSection({ ar, no, scen }: { ar: boolean; no: string; scen: Maybe<unknown> }) {
  const cards = useMemo(() => (scen.status === 'live' ? normalizeScenarios(scen.data) : []), [scen]);
  if (scen.status !== 'live' || !cards.length) return null;   // graceful-hide until the endpoint lands

  const order = ['base', 'surge', 'quiet', 'ot'];
  const sorted = [...cards].sort((a, b) => (order.indexOf(a.key) + 99) - (order.indexOf(b.key) + 99));
  const base = sorted.find(c => c.key === 'base');

  return (
    <Section no={no} icon={GitCompareArrows} color={PAL.warn}
      title={ar ? 'السيناريوهات — أساس · ذروة · هادئ · أوفرتايم' : 'Scenarios — base · surge · quiet · OT'}
      desc={ar ? 'نفس المحرك بأربع فرضيات جنبًا إلى جنب — كم يتحرك المطلوب والتوظيف مع كل فرضية'
               : 'the same engine under four assumptions, side by side — how the requirement and hiring move'}>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {sorted.map(c => {
          const meta = SCEN_META[c.key] ?? { en: c.label ?? c.key, ar: c.labelAr ?? c.label ?? c.key, color: PAL.neutral, descEn: '', descAr: '' };
          const main = c.required ?? c.peak;
          const baseMain = base ? (base.required ?? base.peak) : null;
          return (
            <div key={c.key} className="rounded-xl p-3 relative overflow-hidden"
              style={{
                background: 'var(--surface-2)',
                border: `1px solid ${c.key === 'base' ? meta.color + '55' : 'var(--border)'}`,
              }}>
              <div style={{ position: 'absolute', top: 0, insetInlineStart: 0, insetInlineEnd: 0, height: 2.5, background: meta.color }} />
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: meta.color }}>
                  {ar ? (c.labelAr ?? meta.ar) : (c.label ?? meta.en)}
                </span>
                <span className="text-[8.5px] ms-auto" style={{ color: 'var(--text-3)' }}>{ar ? meta.descAr : meta.descEn}</span>
              </div>
              <div className="text-2xl font-extrabold tabular-nums" style={{ color: 'var(--text-1)', letterSpacing: '-.03em' }}>
                {main != null ? nfmt(main) : '—'}
              </div>
              <div className="text-[9px] mb-1" style={{ color: 'var(--text-3)' }}>
                {c.required != null ? (ar ? 'أجسام مطلوبة/يوم' : 'bodies required/day') : (ar ? 'ذروة HC' : 'peak HC')}
              </div>
              {c.key !== 'base' && main != null && baseMain != null && <Delta v={main - baseMain} ar={ar} />}
              {c.hire != null && (
                <div className="mt-1.5 text-[10px] font-black tabular-nums px-2 py-1 rounded-lg inline-block"
                  style={{ background: c.hire > 0 ? `${PAL.risk}14` : `${PAL.ok}12`, color: c.hire > 0 ? PAL.risk : PAL.ok }}>
                  {c.hire > 0 ? `+${nfmt(c.hire)} ${ar ? 'إنترن' : 'interns'}` : (ar ? '✓ بدون توظيف' : '✓ no hiring')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
