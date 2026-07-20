import { useState, useEffect, useCallback } from 'react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { StatTile, Gauge } from '@/components/dazzle';
import { tp } from '@/components/ds';
import {
  Phone, MessageSquare, Mail, Zap, Users, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle, BarChart3, RefreshCw, ChevronDown, ChevronUp,
  Info, Calculator, Target, Clock, Activity, Minus, ShoppingBag, ArrowRight,
} from 'lucide-react';

/* ── Theme-aware neutral tokens (same shape as ScheduleChanges/Calendar) ─────────
   Centralizes Capacity's card / border / input / chip surfaces + secondary/body
   text. Dark keeps the page's original explicit values; light mirrors them (white
   cards + slate borders + tinted inputs so panels read on the light bg). Primary
   headings use the ds tp() helper. Semantic hues (blue/emerald/amber/red accents,
   occupancy status) stay inline. `tip` is a floating tooltip kept dark in BOTH
   themes on purpose. Residual neutral literals live only in this block. */
const T = (dark: boolean) => ({
  card:        dark ? 'rgba(255,255,255,0.03)' : '#ffffff',
  cardBorder:  dark ? 'rgba(255,255,255,0.08)' : '#e2e8f0',
  cardSoft:    dark ? 'rgba(255,255,255,0.02)' : '#ffffff',
  borderSoft:  dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
  border2:     dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
  panel2:      dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
  panel2Bd:    dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  input:       dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
  inputBorder: dark ? 'rgba(255,255,255,0.1)'  : 'rgba(0,0,0,0.1)',
  chip:        dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
  chip2:       dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
  tBody:       dark ? '#e2e8f0' : '#0f172a',
  tRow:        dark ? '#e2e8f0' : '#1e293b',
  tip:         dark ? '#0f1527' : '#1e293b',    // floating tooltip — dark in BOTH themes on purpose
});

/* ─────────────────────────────────────────────────────────────────────────────
 *  TYPES
 * ────────────────────────────────────────────────────────────────────────────*/
interface Func {
  id: string; name: string; name_ar: string; channel_type: string; concurrency: number;
}

interface IntervalRow {
  intervalStart: string;
  volume: number;
  aht?: number;
}

interface CalcInterval {
  intervalStart: string; intervalEnd: string;
  volume: number; aht: number; workload: number;
  requiredHc: number; requiredHcWithShrinkage: number;
  scheduledHc: number; gap: number;
  occupancy: number; serviceLevel?: number;
  risk: 'ok' | 'warning' | 'critical';
}

interface CapacityResult {
  functionId: string; functionName: string; channelType: string; date: string;
  totalRequired: number; totalScheduled: number; totalGap: number;
  avgOccupancy: number; slaAtRisk: boolean;
  intervals: CalcInterval[];
  scenarios: {
    base: { required: number; gap: number };
    lean: { required: number; gap: number };
    withOT?: { required: number; gap: number };
    surge?: { required: number; gap: number; multiplier: number; extraVsBase: number };
  };
}

interface HcOverviewRow {
  function_id: string; func_name: string; channel_type: string; concurrency: string;
  scheduled_hc: string; wfh_hc: string; office_hc: string;
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  HELPERS
 * ────────────────────────────────────────────────────────────────────────────*/
const CHANNEL_META: Record<string, { icon: React.ElementType; label: string; color: string; bgDark: string }> = {
  voice:    { icon: Phone,         label: 'Voice / Inbound', color: 'text-blue-400',   bgDark: 'bg-blue-500/10 border-blue-500/30' },
  chat:     { icon: MessageSquare, label: 'Live Chat',        color: 'text-emerald-400', bgDark: 'bg-emerald-500/10 border-emerald-500/30' },
  whatsapp: { icon: MessageSquare, label: 'WhatsApp',          color: 'text-green-400',   bgDark: 'bg-green-500/10 border-green-500/30' },
  email:    { icon: Mail,          label: 'Email Support',     color: 'text-purple-400',  bgDark: 'bg-purple-500/10 border-purple-500/30' },
};

// Non-frontline roles don't handle a contact queue (no Erlang demand) → excluded
// from capacity planning: RTA, Customer Care, Team Leader.
const EXCLUDED_FN = /\b(rta|customer\s*care|team\s*leader)\b/i;

function channelMeta(ct: string) {
  return CHANNEL_META[ct] ?? { icon: Activity, label: ct, color: 'text-slate-400', bgDark: 'bg-slate-500/10 border-slate-500/30' };
}

function generateIntervals(startH = 6, endH = 24, stepMin = 30): IntervalRow[] {
  const rows: IntervalRow[] = [];
  for (let h = startH; h < endH; h++) {
    for (let m = 0; m < 60; m += stepMin) {
      rows.push({
        intervalStart: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,
        volume: 0,
      });
    }
  }
  return rows;
}

function riskColor(risk: string, dark: boolean) {
  if (risk === 'critical') return dark ? 'bg-red-500/20 text-red-300' : 'bg-red-100 text-red-700';
  if (risk === 'warning')  return dark ? 'bg-yellow-500/20 text-yellow-300' : 'bg-yellow-100 text-yellow-700';
  return dark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700';
}

function gapBadge(gap: number, dark: boolean) {
  if (gap > 3)  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${dark ? 'bg-red-500/20 text-red-300' : 'bg-red-100 text-red-700'}`}>-{gap}</span>;
  if (gap > 0)  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${dark ? 'bg-yellow-500/20 text-yellow-300' : 'bg-yellow-100 text-yellow-700'}`}>-{gap}</span>;
  if (gap === 0) return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${dark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700'}`}>✓</span>;
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${dark ? 'bg-slate-600 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>+{Math.abs(gap)}</span>;
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  VOLUME GRID EDITOR
 * ────────────────────────────────────────────────────────────────────────────*/
function VolumeGrid({
  rows, onChange, dark, globalAht, ar
}: {
  rows: IntervalRow[]; onChange: (rows: IntervalRow[]) => void;
  dark: boolean; globalAht: number; ar: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 8);

  function update(idx: number, field: 'volume' | 'aht', val: number) {
    const next = [...rows];
    next[idx] = { ...next[idx], [field]: val };
    onChange(next);
  }

  function applyFlat(val: number) {
    onChange(rows.map(r => ({ ...r, volume: val })));
  }

  const totalVol = rows.reduce((s, r) => s + (r.volume || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-semibold ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
          {ar ? 'الحجم لكل فترة — الإجمالي:' : 'VOLUME BY INTERVAL — Total:'} {totalVol.toLocaleString()}
        </span>
        <div className="flex gap-2 items-center">
          <input
            type="number" min={0} placeholder={ar ? 'حجم موحّد' : 'Flat volume'}
            className={`w-24 text-xs px-2 py-1 rounded border ${dark ? 'bg-white/[0.04] border-white/10 text-white' : 'bg-white border-slate-300'}`}
            onBlur={e => { if (e.target.value) applyFlat(+e.target.value); }}
          />
          <button
            onClick={() => applyFlat(0)}
            className={`text-xs px-2 py-1 rounded ${dark ? 'bg-white/[0.05] hover:bg-white/[0.08] text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
          >
            {ar ? 'مسح' : 'Clear'}
          </button>
        </div>
      </div>

      <div className={`rounded-lg border overflow-hidden text-xs ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
        <table className="w-full">
          <thead>
            <tr className={dark ? 'bg-white/[0.04]' : 'bg-slate-50'}>
              <th className="px-3 py-2 text-left font-medium">{ar ? 'الفترة' : 'Interval'}</th>
              <th className="px-3 py-2 text-center font-medium">{ar ? 'الحجم' : 'Volume'}</th>
              <th className="px-3 py-2 text-center font-medium">{ar ? 'AHT (ث)' : 'AHT (s)'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {visible.map((row, i) => (
              <tr key={row.intervalStart} className={i % 2 === 0 ? (dark ? 'bg-slate-800/40' : 'bg-white') : (dark ? 'bg-slate-800/20' : 'bg-slate-50/50')}>
                <td className={`px-3 py-1.5 font-mono ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{row.intervalStart}</td>
                <td className="px-2 py-1">
                  <input
                    type="number" min={0} value={row.volume || ''}
                    onChange={e => update(i, 'volume', +e.target.value)}
                    placeholder="0"
                    className={`w-full text-center rounded border px-1 py-0.5 ${dark ? 'bg-white/[0.04] border-white/10 text-white' : 'bg-white border-slate-300'}`}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number" min={1} value={row.aht || ''}
                    onChange={e => update(i, 'aht', +e.target.value)}
                    placeholder={String(globalAht)}
                    className={`w-full text-center rounded border px-1 py-0.5 ${dark ? 'bg-white/[0.04] border-white/10 text-white' : 'bg-white border-slate-300'}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 8 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className={`mt-2 w-full text-xs py-1.5 rounded flex items-center justify-center gap-1 ${dark ? 'bg-white/[0.05] hover:bg-white/[0.08] text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
        >
          {expanded ? <><ChevronUp size={12} /> {ar ? 'عرض أقل' : 'Show Less'}</> : <><ChevronDown size={12} /> {ar ? `عرض كل ${rows.length} فترة` : `Show All ${rows.length} Intervals`}</>}
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  INTERVAL CHART — Required (with shrinkage) vs Scheduled, gaps highlighted
 * ────────────────────────────────────────────────────────────────────────────*/
function IntervalChart({ result, dark, ar }: { result: CapacityResult; dark: boolean; ar: boolean }) {
  const rows = result.intervals.filter(i => i.volume > 0 || i.scheduledHc > 0);
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map(r => Math.max(r.requiredHcWithShrinkage, r.scheduledHc)));
  const H = 150;

  return (
    <div className={`rounded-xl border p-4 mb-4 ${dark ? 'bg-white/[0.02] border-white/[0.08]' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold flex items-center gap-1.5"><BarChart3 size={13} className="text-indigo-400" /> {ar ? 'المطلوب مقابل المجدول لكل فترة' : 'Required vs Scheduled by Interval'}</span>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#6366f1' }} /> {ar ? 'مطلوب' : 'Required'}</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: dark ? '#475569' : '#cbd5e1' }} /> {ar ? 'مجدول' : 'Scheduled'}</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> {ar ? 'فجوة' : 'Gap'}</span>
        </div>
      </div>
      <div className="overflow-x-auto" dir="ltr">
        <div className="flex items-end gap-1" style={{ height: H + 24, minWidth: rows.length * 26 }}>
          {rows.map((r, i) => {
            const reqH = Math.round((r.requiredHcWithShrinkage / max) * H);
            const schH = Math.round((r.scheduledHc / max) * H);
            const understaffed = r.gap > 0;
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 group relative" style={{ minWidth: 22 }}>
                {/* tooltip */}
                <div className="absolute -top-1 hidden group-hover:block z-10 px-2 py-1 rounded-lg text-[9px] whitespace-nowrap"
                  style={{ background: T(dark).tip, color: '#fff', bottom: H + 4 }}>
                  {r.intervalStart} · req {r.requiredHcWithShrinkage} · sched {r.scheduledHc}{understaffed ? ` · gap ${r.gap}` : ''}
                </div>
                <div className="flex items-end gap-0.5" style={{ height: H }}>
                  <div className="w-2 rounded-t" style={{ height: Math.max(2, reqH), background: understaffed ? '#ef4444' : '#6366f1' }} />
                  <div className="w-2 rounded-t" style={{ height: Math.max(2, schH), background: dark ? '#475569' : '#cbd5e1' }} />
                </div>
                <span className={`text-[8px] ${dark ? 'text-slate-600' : 'text-slate-400'} rotate-0`}>{r.intervalStart.slice(0, 5)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  RESULTS TABLE
 * ────────────────────────────────────────────────────────────────────────────*/
function ResultsTable({ result, dark, ar }: { result: CapacityResult; dark: boolean; ar: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const intervals = result.intervals.filter(i => i.volume > 0 || i.scheduledHc > 0);
  const visible = showAll ? intervals : intervals.slice(0, 12);

  const isVoice = result.channelType === 'voice';
  const t = T(dark);

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: ar ? 'إجمالي المطلوب' : 'Total Required', value: result.totalRequired, sub: ar ? 'مع الانكماش' : 'with shrinkage', icon: Target, accent: '#6366f1' },
          { label: ar ? 'المجدول' : 'Scheduled', value: result.totalScheduled, sub: ar ? 'موظفون على الشيفت' : 'agents on shift', icon: Users, accent: dark ? '#64748b' : '#94a3b8' },
          { label: result.totalGap > 0 ? (ar ? 'نقص تغطية' : 'Understaffed') : (ar ? 'فائض' : 'Surplus'), value: Math.abs(result.totalGap), sub: result.totalGap > 0 ? (ar ? 'أضف موظفين / أوفرتايم' : 'add staff / OT') : (ar ? 'متوازن' : 'balanced'), icon: result.totalGap > 0 ? TrendingDown : TrendingUp, accent: result.totalGap > 0 ? '#ef4444' : '#22c55e' },
          { label: ar ? 'متوسط الإشغال' : 'Avg Occupancy', value: `${(result.avgOccupancy * 100).toFixed(0)}%`, sub: result.avgOccupancy > 0.9 ? (ar ? 'محمّل زيادة' : 'overloaded') : (ar ? 'صحي' : 'healthy'), icon: Activity, accent: result.avgOccupancy > 0.9 ? '#ef4444' : result.avgOccupancy > 0.8 ? '#f59e0b' : '#22c55e' },
        ].map((card, i) => {
          const isNum = typeof card.value === 'number';
          return (
            <StatTile key={card.label} icon={card.icon} label={card.label}
              num={isNum ? (card.value as number) : undefined} value={isNum ? undefined : String(card.value)}
              sub={card.sub} color={card.accent} delay={i * 60} />
          );
        })}
      </div>

      {/* occupancy dial — the headline staffing-health metric, interpreted */}
      <div className="rounded-2xl border p-4 mb-4 flex flex-col items-center sm:flex-row sm:items-center sm:gap-5"
        style={{ background: t.card, borderColor: t.cardBorder }}>
        <Gauge value={Math.round(result.avgOccupancy * 100)} label={ar ? 'متوسط الإشغال' : 'Avg Occupancy'}
          color={result.avgOccupancy > 0.9 ? '#ef4444' : result.avgOccupancy > 0.8 ? '#f59e0b' : '#22c55e'} size={150} />
        <div className="flex-1 text-xs leading-relaxed mt-2 sm:mt-0" style={{ color: dark ? '#94a3b8' : '#64748b' }}>
          <div className="font-bold mb-1" style={{ color: tp(dark) }}>{ar ? 'صحّة الإشغال' : 'Occupancy health'}</div>
          {result.avgOccupancy > 0.9
            ? (ar ? 'الفريق محمّل فوق 90% — خطر إرهاق وتدهور SLA؛ أضف تغطية أو أوفرتايم.' : 'Loaded above 90% — burnout & SLA risk; add coverage or OT.')
            : result.avgOccupancy > 0.8
              ? (ar ? 'إشغال مرتفع لكنه ضمن المدى — راقب فترات الذروة.' : 'High but within range — watch the peak intervals.')
              : (ar ? 'إشغال صحّي — هامش كافٍ لتقلّبات الحجم.' : 'Healthy occupancy — enough headroom for volume swings.')}
        </div>
      </div>

      {/* SLA warning */}
      {result.slaAtRisk && (
        <div className={`mb-4 flex items-center gap-2 px-3 py-2 rounded-lg text-sm border ${dark ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <AlertTriangle size={14} />
          {ar ? 'هدف SLA في خطر — زِد التوظيف أو اعتمد أوفرتايم' : 'SLA target is at risk — increase staffing or approve OT'}
        </div>
      )}

      {/* Scenarios */}
      <div className={`rounded-xl border p-3 mb-4 ${dark ? 'bg-white/[0.02] border-white/[0.08]' : 'bg-slate-50 border-slate-200'}`}>
        <div className="text-xs font-semibold flex items-center gap-1.5">
          <BarChart3 size={13} />
          {ar ? 'مقارنة السيناريوهات' : 'Scenario Comparison'}
        </div>
        <div className={`text-[10px] mb-3 mt-0.5 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
          {ar ? 'نفس المدخلات بثلاث فرضيات — كم يتحرك المطلوب مع كل فرضية مقارنة بالأساس' : 'the same inputs under three assumptions — how the requirement moves vs base'}
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          {([
            { key: 'base',   label: ar ? 'الأساس (طلب P90)' : 'Base (P90 demand)',                         sc: result.scenarios.base,   accent: false },
            result.scenarios.surge
              ? { key: 'surge', label: ar ? `ذروة P99 (×${(result.scenarios.surge as any).multiplier})` : `P99 Surge (×${(result.scenarios.surge as any).multiplier})`, sc: result.scenarios.surge, accent: true }
              : { key: 'withOT', label: ar ? 'مع تغطية أوفرتايم (-10%)' : 'With OT Coverage (-10%)',                sc: result.scenarios.withOT!, accent: false },
            { key: 'lean',   label: ar ? 'خطة مقتصدة (+15%)' : 'Lean Plan (+15%)',                          sc: result.scenarios.lean,   accent: false },
          ] as { key: string; label: string; sc: { required: number; gap: number }; accent: boolean }[]).map(({ key, label, sc, accent }) => {
            const delta = key === 'base' ? 0 : sc.required - result.scenarios.base.required;
            return (
            <div key={key} className={`rounded-lg p-2 border text-center ${accent ? 'bg-amber-500/10 border-amber-500/40' : dark ? 'bg-white/[0.03] border-white/[0.08]' : 'bg-white border-slate-200'}`}>
              <div className={`text-[10px] mb-1.5 font-medium ${accent ? 'text-amber-400' : dark ? 'text-slate-400' : 'text-slate-500'}`}>{label}</div>
              <div className={`text-lg font-bold ${accent ? 'text-amber-300' : dark ? 'text-white' : 'text-slate-800'}`}>{sc.required}</div>
              {key !== 'base' && (
                <div className={`text-[9px] font-bold inline-flex items-center gap-0.5 ${delta > 0 ? 'text-red-400' : delta < 0 ? 'text-emerald-400' : (dark ? 'text-slate-500' : 'text-slate-400')}`}>
                  {delta > 0 ? <TrendingUp size={9} /> : delta < 0 ? <TrendingDown size={9} /> : <Minus size={9} />}
                  {delta === 0 ? (ar ? 'مثل الأساس' : 'same as base') : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} ${ar ? 'عن الأساس' : 'vs base'}`}
                </div>
              )}
              <div className={`text-[10px] mt-0.5 ${sc.gap > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {sc.gap > 0 ? (ar ? `${sc.gap} نقص` : `${sc.gap} understaffed`) : sc.gap < 0 ? (ar ? `${Math.abs(sc.gap)} فائض` : `${Math.abs(sc.gap)} surplus`) : (ar ? 'متوازن' : 'Balanced')}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Visual chart — required vs scheduled per interval */}
      <IntervalChart result={result} dark={dark} ar={ar} />

      {/* Interval table */}
      <div className={`rounded-xl border overflow-hidden ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
        <table className="w-full text-xs">
          <thead>
            <tr className={dark ? 'bg-white/[0.04]' : 'bg-slate-50'}>
              <th className="px-3 py-2.5 text-left font-semibold">{ar ? 'الفترة' : 'Interval'}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{ar ? 'الحجم' : 'Volume'}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{ar ? 'الحمل' : 'Workload'}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{ar ? 'المطلوب' : 'Required HC'}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{ar ? '+انكماش' : '+Shrinkage'}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{ar ? 'المجدول' : 'Scheduled'}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{ar ? 'الفجوة' : 'Gap'}</th>
              <th className="px-3 py-2.5 text-center font-semibold">{ar ? 'الإشغال' : 'Occupancy'}</th>
              {isVoice && <th className="px-3 py-2.5 text-center font-semibold">SL%</th>}
              <th className="px-3 py-2.5 text-center font-semibold">{ar ? 'الخطر' : 'Risk'}</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${dark ? 'divide-slate-700/40' : 'divide-slate-100'}`}>
            {visible.map((row, idx) => (
              <tr
                key={row.intervalStart}
                className={`${
                  row.risk === 'critical' ? (dark ? 'bg-red-500/8' : 'bg-red-50') :
                  row.risk === 'warning'  ? (dark ? 'bg-yellow-500/5' : 'bg-yellow-50/60') : ''
                } ${idx % 2 === 0 ? '' : (dark ? 'bg-slate-800/20' : '')}`}
              >
                <td className={`px-3 py-2 font-mono font-medium ${dark ? 'text-slate-300' : 'text-slate-700'}`}>
                  {row.intervalStart}–{row.intervalEnd}
                </td>
                <td className={`px-3 py-2 text-center ${dark ? 'text-slate-400' : 'text-slate-600'}`}>{row.volume || '–'}</td>
                <td className={`px-3 py-2 text-center ${dark ? 'text-slate-400' : 'text-slate-600'}`}>{row.workload || '–'}</td>
                <td className={`px-3 py-2 text-center font-semibold ${dark ? 'text-blue-300' : 'text-blue-700'}`}>{row.requiredHc || '–'}</td>
                <td className={`px-3 py-2 text-center font-semibold ${dark ? 'text-indigo-300' : 'text-indigo-700'}`}>{row.requiredHcWithShrinkage || '–'}</td>
                <td className={`px-3 py-2 text-center ${dark ? 'text-slate-300' : 'text-slate-700'}`}>{row.scheduledHc}</td>
                <td className="px-3 py-2 text-center">{gapBadge(row.gap, dark)}</td>
                <td className={`px-3 py-2 text-center ${row.occupancy > 0.9 ? 'text-red-400 font-semibold' : row.occupancy > 0.8 ? 'text-yellow-400' : (dark ? 'text-emerald-400' : 'text-emerald-600')}`}>
                  {row.volume > 0 ? `${(row.occupancy * 100).toFixed(0)}%` : '–'}
                </td>
                {isVoice && (
                  <td className={`px-3 py-2 text-center ${
                    row.serviceLevel !== undefined
                      ? row.serviceLevel < 0.7 ? 'text-red-400 font-semibold' :
                        row.serviceLevel < 0.85 ? 'text-yellow-400' : 'text-emerald-400'
                      : (dark ? 'text-slate-500' : 'text-slate-400')
                  }`}>
                    {row.serviceLevel !== undefined && row.volume > 0 ? `${(row.serviceLevel * 100).toFixed(0)}%` : '–'}
                  </td>
                )}
                <td className="px-3 py-2 text-center">
                  {row.volume > 0 ? (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${riskColor(row.risk, dark)}`}>
                      {row.risk === 'critical' ? (ar ? '⚠ حرج' : '⚠ Critical') : row.risk === 'warning' ? (ar ? '! تحذير' : '! Warning') : (ar ? '✓ آمن' : '✓ OK')}
                    </span>
                  ) : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {intervals.length > 12 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className={`mt-2 w-full text-xs py-2 rounded flex items-center justify-center gap-1 ${dark ? 'bg-white/[0.05] hover:bg-white/[0.08] text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
        >
          {showAll ? <><ChevronUp size={12} /> {ar ? 'عرض أقل' : 'Show Less'}</> : <><ChevronDown size={12} /> {ar ? `عرض كل ${intervals.length} فترة` : `Show All ${intervals.length} Intervals`}</>}
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  MAIN PAGE
 * ────────────────────────────────────────────────────────────────────────────*/
export default function CapacityPage() {
  const { dark, lang } = useUiStore();
  const ar = lang === 'ar';

  /* ── State ────────────────────────────────────────────────────────────── */
  const [functions, setFunctions] = useState<Func[]>([]);
  const [overview, setOverview] = useState<HcOverviewRow[]>([]);
  const [selectedFunc, setSelectedFunc] = useState<Func | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Per-channel inputs
  const [targetSL, setTargetSL] = useState(80);
  const [targetAnswerSec, setTargetAnswerSec] = useState(20);
  const [defaultAht, setDefaultAht] = useState(300);
  const [shrinkage, setShrinkage] = useState(25);
  const [occupancyTarget, setOccupancyTarget] = useState(85);
  const [internFactor, setInternFactor] = useState(70);
  const [openingBacklog, setOpeningBacklog] = useState(0);
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [intervals, setIntervals] = useState<IntervalRow[]>(() => generateIntervals());

  const [result, setResult] = useState<CapacityResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState('');
  const [overviewLoading, setOverviewLoading] = useState(false);

  // CPO Forecaster
  const [cpoOrders, setCpoOrders] = useState<number>(0);
  const [cpoPct, setCpoPct] = useState<number>(15);
  const [cpoResult, setCpoResult] = useState<{ forecastedCalls: number } | null>(null);
  const [cpoLoading, setCpoLoading] = useState(false);

  // Live Plan — measured Erlang-C plan from Sprinklr workload
  const [livePlan, setLivePlan] = useState<any | null>(null);
  const [livePlanLoading, setLivePlanLoading] = useState(false);
  const [lpSaveMsg, setLpSaveMsg] = useState('');
  const [savedScenarios, setSavedScenarios] = useState<any[]>([]);
  const loadSavedScenarios = useCallback(() => {
    apiClient.get('/capacity/scenarios').then(r => setSavedScenarios(Array.isArray(r.data) ? r.data : [])).catch(() => setSavedScenarios([]));
  }, []);
  useEffect(() => { loadSavedScenarios(); }, [loadSavedScenarios]);
  const deleteScenario = async (id: string) => { await apiClient.post('/capacity/scenarios/delete', { id }).catch(() => {}); loadSavedScenarios(); };

  // HC by Function × Hour
  const [fnHourly, setFnHourly] = useState<any | null>(null);
  const [fnHourlyOpen, setFnHourlyOpen] = useState(true);

  useEffect(() => {
    apiClient.get(`/capacity/function-hourly?date=${date}`)
      .then(r => setFnHourly(r.data)).catch(() => setFnHourly(null));
  }, [date]);

  const loadLivePlan = useCallback(() => {
    setLivePlanLoading(true);
    apiClient.get(`/capacity/live-plan?date=${date}`)
      .then(r => setLivePlan(r.data))
      .catch(() => setLivePlan(null))
      .finally(() => setLivePlanLoading(false));
  }, [date]);

  useEffect(() => { loadLivePlan(); }, [loadLivePlan]);

  const saveLivePlanScenario = async () => {
    if (!livePlan) return;
    try {
      await apiClient.post('/capacity/scenarios', {
        name: `Live Plan ${livePlan.date}`,
        channel: 'omni',
        scenarioType: 'base',
        inputs: livePlan.assumptions,
        results: { summary: livePlan.summary, coverage: livePlan.coverage },
        notes: ar ? 'محفوظ من الخطة الحية' : 'Saved from live plan',
      });
      setLpSaveMsg(ar ? '✅ حُفظ السيناريو' : '✅ Scenario saved');
      loadSavedScenarios();
    } catch {
      setLpSaveMsg(ar ? '✗ فشل الحفظ' : '✗ Save failed');
    }
    setTimeout(() => setLpSaveMsg(''), 4000);
  };

  /* ── Load functions ────────────────────────────────────────────────────── */
  useEffect(() => {
    apiClient.get('/capacity/functions').then((r: { data: Func[] }) => {
      setFunctions((r.data ?? []).filter(f => !EXCLUDED_FN.test(f.name) && !EXCLUDED_FN.test(f.name_ar ?? '')));
    }).catch(() => {});
  }, []);

  /* ── Load HC overview ──────────────────────────────────────────────────── */
  const loadOverview = useCallback(() => {
    setOverviewLoading(true);
    apiClient.get(`/capacity/hc-overview?date=${date}`).then((r: { data: HcOverviewRow[] }) => {
      setOverview((r.data ?? []).filter(row => !EXCLUDED_FN.test(row.func_name ?? '')));
    }).catch(() => {}).finally(() => setOverviewLoading(false));
  }, [date]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  /* ── Regenerate intervals when interval minutes changes ─────────────────── */
  useEffect(() => {
    setIntervals(generateIntervals(6, 24, intervalMinutes));
    setResult(null);
  }, [intervalMinutes]);

  /* ── Select function ───────────────────────────────────────────────────── */
  function selectFunc(fn: Func) {
    setSelectedFunc(fn);
    setResult(null);
    setError('');
    // Update defaults based on channel type
    if (fn.channel_type === 'chat' || fn.channel_type === 'whatsapp') {
      setDefaultAht(420); // 7 min AHT for chat
      setOccupancyTarget(75);
    } else if (fn.channel_type === 'email') {
      setDefaultAht(600); // 10 min per email
      setOccupancyTarget(85);
    } else {
      setDefaultAht(300); // 5 min AHT for voice
      setOccupancyTarget(85);
    }
  }

  /* ── Calculate ─────────────────────────────────────────────────────────── */
  async function calculate() {
    if (!selectedFunc) return;
    setCalculating(true);
    setError('');
    setResult(null);

    try {
      const ct = selectedFunc.channel_type;
      let endpoint = '/capacity/erlang';
      let payload: Record<string, unknown> = {};

      const baseInputs = {
        intervalMinutes,
        defaultAht,
        shrinkage: shrinkage / 100,
        occupancyTarget: occupancyTarget / 100,
        internFactor: internFactor / 100,
        intervals: intervals.map(r => ({
          intervalStart: r.intervalStart,
          volume: r.volume || 0,
          ...(r.aht ? { aht: r.aht } : {}),
        })),
      };

      if (ct === 'voice') {
        endpoint = '/capacity/erlang';
        payload = {
          functionId: selectedFunc.id, date,
          inputs: { ...baseInputs, targetSL: targetSL / 100, targetAnswerSec },
        };
      } else if (ct === 'chat' || ct === 'whatsapp') {
        endpoint = '/capacity/concurrent';
        payload = {
          functionId: selectedFunc.id, date,
          inputs: { ...baseInputs, concurrency: selectedFunc.concurrency || 4, targetResponseSec: targetAnswerSec },
        };
      } else if (ct === 'email') {
        endpoint = '/capacity/email';
        payload = {
          functionId: selectedFunc.id, date,
          inputs: { ...baseInputs, slaHours: 24, openingBacklog },
        };
      }

      const r = await apiClient.post(endpoint, payload);
      setResult(r.data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (ar ? 'فشل الحساب' : 'Calculation failed');
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setCalculating(false);
    }
  }

  /* ── CPO Forecast ───────────────────────────────────────────────────────── */
  async function calcCpo() {
    if (!cpoOrders) return;
    setCpoLoading(true);
    try {
      const r = await apiClient.post('/kpi-source/cpo/forecast', {
        orders: cpoOrders,
        cpoPct: cpoPct / 100,
      });
      setCpoResult(r.data);
    } catch {
      const calls = Math.round(cpoOrders * (cpoPct / 100));
      setCpoResult({ forecastedCalls: calls });
    } finally {
      setCpoLoading(false);
    }
  }

  function pushCpoToIntervals() {
    if (!cpoResult) return;
    const totalCalls = cpoResult.forecastedCalls;
    const activeIntervals = intervals.filter(r => r.intervalStart >= '07:00' && r.intervalStart <= '22:00');
    const perInterval = Math.round(totalCalls / (activeIntervals.length || 1));
    setIntervals(prev => prev.map(r => {
      const inActive = r.intervalStart >= '07:00' && r.intervalStart <= '22:00';
      return { ...r, volume: inActive ? perInterval : r.volume };
    }));
  }

  /* ─────────────────────────────────────────────────────────────────────────
   *  RENDER
   * ────────────────────────────────────────────────────────────────────────*/
  const t = T(dark);
  return (
    <div className="min-h-screen p-5 sm:p-6" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)', color: t.tBody }}>
      {/* Header — modern icon-chip style, consistent with the rest of the app */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.22)' }}>
            <Calculator size={20} style={{ color: '#3b82f6' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>
              {ar ? 'تخطيط الطاقة الاستيعابية' : 'Capacity Planning'}
            </h1>
            <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>
              {ar ? 'Erlang-C · نماذج التزامن · باكلوج الإيميل · سيناريو ذروة P99' : 'Erlang-C · Concurrency · Email Backlog · P99 Surge'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="text-xs rounded-xl px-3 py-2 outline-none"
            style={{ background: t.input, border: `1px solid ${t.inputBorder}`, color: t.tBody }}
          />
          <button onClick={loadOverview}
            className="flex items-center justify-center w-9 h-9 rounded-xl"
            style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)' }}>
            <RefreshCw size={15} className={overviewLoading ? 'animate-spin' : ''} style={{ color: '#60a5fa' }} />
          </button>
        </div>
      </div>

      {/* Function picker */}
      <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
        {ar ? 'اختر قسماً للحساب' : 'Pick a function to size'}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-6">
        {overview.length === 0 && (
          <div className="col-span-full text-center py-6 text-sm" style={{ color: '#475569' }}>
            {ar ? 'لا توجد بيانات هيدكاونت لهذا اليوم' : 'No scheduled HC for this date'}
          </div>
        )}
        {overview.map(row => {
          const meta = channelMeta(row.channel_type);
          const Icon = meta.icon;
          const sel = selectedFunc?.id === row.function_id;
          return (
            <button
              key={row.function_id}
              onClick={() => { const fn = functions.find(f => f.id === row.function_id); if (fn) selectFunc(fn); }}
              className="rounded-2xl p-3 text-start transition-all"
              style={{
                background: sel ? 'rgba(59,130,246,0.12)' : t.cardSoft,
                border: `1px solid ${sel ? 'rgba(59,130,246,0.45)' : t.borderSoft}`,
                boxShadow: sel ? '0 4px 16px rgba(59,130,246,0.15)' : 'none',
              }}>
              <div className="flex items-center justify-between mb-2">
                <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: t.chip }}>
                  <Icon size={14} className={meta.color} />
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded uppercase font-mono" style={{ background: t.chip2, color: '#64748b' }}>{row.channel_type}</span>
              </div>
              <div className="font-semibold text-sm truncate mb-1.5" style={{ color: tp(dark) }}>{row.func_name}</div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-2xl font-bold leading-none" style={{ color: sel ? '#60a5fa' : tp(dark) }}>{row.scheduled_hc}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: '#64748b' }}>{ar ? 'مجدول اليوم' : 'scheduled'}</div>
                </div>
                <div className="text-end text-[10px]" style={{ color: '#64748b' }}>
                  <div>WFH {row.wfh_hc}</div>
                  <div>{ar ? 'مكتب' : 'Office'} {row.office_hc}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── LIVE PLAN — Erlang-C on measured Sprinklr workload ─────────────── */}
      <div className={`rounded-2xl p-4 mb-4 border ${dark ? 'bg-white/[0.02] border-white/[0.08]' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Activity size={16} className="text-emerald-400" />
          <span className={`text-sm font-semibold ${dark ? 'text-slate-200' : 'text-slate-700'}`}>
            {ar ? 'الخطة الحية — من الحمل المُقاس فعلياً' : 'Live Plan — from measured workload'}
          </span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${dark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'}`}>
            Erlang-C · {ar ? 'سبرينكلر' : 'Sprinklr'}
          </span>
          <span className={`text-[10px] hidden sm:inline ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
            {ar ? 'مطلوب مقابل مجدول لكل فترة — من الحمل المُقاس فعلاً، ليس من توقع' : 'required vs scheduled per interval — from actually-measured workload, not a forecast'}
          </span>
          <button onClick={loadLivePlan} disabled={livePlanLoading}
            className={`ms-auto flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold ${dark ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            <RefreshCw size={12} className={livePlanLoading ? 'animate-spin' : ''} />
            {ar ? 'تحديث' : 'Refresh'}
          </button>
          <button onClick={saveLivePlanScenario} disabled={!livePlan}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
            {ar ? 'حفظ كسيناريو' : 'Save scenario'}
          </button>
          {lpSaveMsg && <span className="text-xs font-bold text-emerald-400">{lpSaveMsg}</span>}
        </div>

        {savedScenarios.length > 0 && (
          <div className="mb-3 rounded-xl p-3" style={{ background: t.panel2, border: `0.5px solid ${t.panel2Bd}` }}>
            <div className="text-xs font-semibold mb-2" style={{ color: dark ? '#cbd5e1' : '#475569' }}>{ar ? `السيناريوهات المحفوظة (${savedScenarios.length})` : `Saved scenarios (${savedScenarios.length})`}</div>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
              {savedScenarios.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg px-2.5 py-1.5" style={{ background: t.card, border: `0.5px solid ${t.border2}` }}>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate" style={{ color: t.tRow }}>{s.name}</div>
                    <div className="text-[10px]" style={{ color: dark ? '#64748b' : '#94a3b8' }}>
                      {s.channel} · {s.scenario_type || 'base'}
                      {s.results?.summary?.peakErlangs != null && ` · ${ar ? 'ذروة' : 'peak'} ${s.results.summary.peakErlangs}`}
                      {s.created_by_name && ` · ${s.created_by_name}`}
                    </div>
                  </div>
                  <button onClick={() => deleteScenario(s.id)} className="text-[10px] px-1.5 py-0.5 rounded shrink-0 ms-2" style={{ background: 'rgba(244,63,94,0.12)', color: '#f43f5e' }}>{ar ? 'حذف' : 'del'}</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {!livePlan ? (
          <p className={`text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
            {livePlanLoading ? (ar ? 'جاري الحساب…' : 'Computing…') : (ar ? 'لا توجد بيانات سبرينكلر لهذا اليوم' : 'No Sprinklr data for this date')}
          </p>
        ) : (
          <>
            {/* Summary KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
              {[
                { l: ar ? 'ذروة الحمل (إرلانج)' : 'Peak Erlangs', v: livePlan.summary.peakErlangs, c: 'text-indigo-400' },
                { l: ar ? 'ذروة المطلوب' : 'Peak Required HC', v: livePlan.summary.peakRequiredHc, c: 'text-amber-400' },
                { l: ar ? 'متوسط المطلوب' : 'Avg Required', v: livePlan.summary.avgRequiredHc, c: 'text-sky-400' },
                { l: ar ? 'متوسط المجدول' : 'Avg Scheduled', v: livePlan.summary.avgScheduledHc, c: 'text-slate-300' },
                { l: ar ? 'أسوأ عجز' : 'Worst Gap', v: livePlan.summary.worstGap, c: livePlan.summary.worstGap > 0 ? 'text-red-400' : 'text-emerald-400' },
              ].map(k => (
                <div key={k.l} className={`rounded-lg p-2.5 text-center ${dark ? 'bg-white/[0.03]' : 'bg-slate-50'}`}>
                  <div className={`text-xl font-black tabular-nums ${k.c}`}>{k.v}</div>
                  <div className={`text-[10px] mt-0.5 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{k.l}</div>
                </div>
              ))}
            </div>

            {/* Interval bars: required vs scheduled */}
            <div className="flex items-end gap-0.5 overflow-x-auto pb-1" style={{ height: 110 }}>
              {livePlan.intervals.filter((x: any) => x.measured).map((iv: any) => {
                const maxV = Math.max(1, livePlan.summary.peakRequiredHc);
                return (
                  <div key={iv.interval} className="flex flex-col items-center gap-0.5" style={{ minWidth: 30 }}
                    title={`${iv.interval} — ${ar ? 'مطلوب' : 'req'} ${iv.requiredHc} / ${ar ? 'مجدول' : 'sched'} ${iv.scheduledHc} | ${iv.totalErlangs} Erlangs | ${iv.channels.map((c: any) => `${c.channel}:${c.erlangs}`).join(' ')}`}>
                    <div className="flex items-end gap-px" style={{ height: 80 }}>
                      <div className="rounded-t" style={{ width: 11, height: Math.max(2, (iv.requiredHc / maxV) * 80), background: iv.risk === 'critical' ? '#ef4444' : iv.risk === 'warning' ? '#f59e0b' : '#34d399' }} />
                      <div className="rounded-t" style={{ width: 11, height: Math.max(2, (iv.scheduledHc / maxV) * 80), background: 'rgba(129,140,248,0.5)' }} />
                    </div>
                    <span className={`text-[8px] tabular-nums ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{iv.interval}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-1">
              <span className={`text-[10px] flex items-center gap-1 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                <span className="w-2 h-2 rounded-sm inline-block bg-emerald-400" /> {ar ? 'مطلوب (Erlang-C + انكماش)' : 'Required (Erlang-C + shrinkage)'}
              </span>
              <span className={`text-[10px] flex items-center gap-1 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(129,140,248,0.6)' }} /> {ar ? 'مجدول' : 'Scheduled'}
              </span>
              <span className={`text-[10px] ms-auto ${dark ? 'text-slate-600' : 'text-slate-400'}`}>
                {livePlan.assumptions.method} · SL {Math.round(livePlan.assumptions.targetSL * 100)}%/{livePlan.assumptions.targetAnswerSec}s · {ar ? 'انكماش' : 'shrink'} {Math.round(livePlan.assumptions.shrinkage * 100)}% · {ar ? 'تزامن' : 'conc'} ×{livePlan.assumptions.concurrency}
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── HC BY FUNCTION × HOUR ───────────────────────────────────────────── */}
      <div className={`rounded-2xl p-4 mb-4 border ${dark ? 'bg-white/[0.02] border-white/[0.08]' : 'bg-white border-slate-200'}`}>
        <button onClick={() => setFnHourlyOpen(o => !o)} className="w-full flex items-center gap-2 text-start">
          <Users size={16} className="text-sky-400" />
          <span className={`text-sm font-semibold ${dark ? 'text-slate-200' : 'text-slate-700'}`}>
            {ar ? 'الهيدكاونت حسب الوظيفة × الساعة' : 'Headcount by Function × Hour'}
          </span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${dark ? 'bg-sky-500/15 text-sky-300' : 'bg-sky-50 text-sky-600 border border-sky-200'}`}>
            {ar ? 'مطلوب · مجدول · فعلي · فجوة' : 'Required · Scheduled · Actual · Gap'}
          </span>
          <span className={`text-[10px] hidden sm:inline ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
            {ar ? 'أين تقف كل ساعة اليوم — مع أعلى الفنكشنز المساهمة' : 'where every hour of today stands — with the top contributing functions'}
          </span>
          <span className={`ms-auto text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{fnHourlyOpen ? '▲' : '▼'}</span>
        </button>

        {fnHourlyOpen && fnHourly && (
          <div className="mt-3 overflow-x-auto" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse', minWidth: 760 }}>
              <thead className="sticky top-0 z-10">
                <tr className={dark ? 'bg-[#0d1120]' : 'bg-slate-100'}>
                  {[ar ? 'الساعة' : 'Hour', ar ? 'المطلوب' : 'Required', ar ? 'المجدول' : 'Scheduled',
                    ar ? 'الفعلي الآن' : 'Actual', ar ? 'الفجوة' : 'Gap', ar ? 'الحالة' : 'Status',
                    ar ? 'أعلى الوظائف (مجدول/فعلي)' : 'Top functions (sched/actual)'].map(hd => (
                    <th key={hd} className={`px-2 py-1.5 text-[10px] font-bold whitespace-nowrap ${dark ? 'text-slate-400' : 'text-slate-500'}`}
                      style={{ textAlign: 'start' }}>{hd}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fnHourly.hours.map((h: any) => {
                  const t = h.totals;
                  const riskColor = t.risk === 'critical' ? '#ef4444' : t.risk === 'warning' ? '#f59e0b'
                    : t.risk === 'ok' ? '#22c55e' : (dark ? '#334155' : '#cbd5e1');
                  const topFns = h.functions
                    .filter((f: any) => f.scheduled > 0 || (f.actual ?? 0) > 0)
                    .sort((a: any, b: any) => (b.scheduled + (b.actual ?? 0)) - (a.scheduled + (a.actual ?? 0)))
                    .slice(0, 4);
                  return (
                    <tr key={h.hour} className={dark ? 'border-b border-slate-700/40' : 'border-b border-slate-100'}
                      style={{ background: t.risk === 'critical' ? 'rgba(239,68,68,0.05)' : undefined }}>
                      <td className={`px-2 py-1.5 font-mono font-bold ${dark ? 'text-slate-300' : 'text-slate-600'}`}>{h.hour}</td>
                      <td className="px-2 py-1.5 font-bold tabular-nums" style={{ color: '#f59e0b' }}>{t.required ?? '—'}</td>
                      <td className="px-2 py-1.5 font-bold tabular-nums" style={{ color: '#818cf8' }}>{t.scheduled}</td>
                      <td className="px-2 py-1.5 font-bold tabular-nums" style={{ color: '#34d399' }}>{t.actual ?? '—'}</td>
                      <td className="px-2 py-1.5 font-black tabular-nums" style={{ color: (t.gap ?? 0) > 0 ? '#ef4444' : '#22c55e' }}>
                        {t.gap != null ? (t.gap > 0 ? `−${t.gap}` : `+${-t.gap}`) : '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${riskColor}1c`, color: riskColor }}>
                          {t.risk === 'critical' ? (ar ? 'حرج' : 'Critical') : t.risk === 'warning' ? (ar ? 'تحذير' : 'Warning')
                            : t.risk === 'ok' ? (ar ? 'آمن' : 'Safe') : (ar ? 'لا قياس' : 'No data')}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex gap-1 flex-wrap">
                          {topFns.map((f: any) => (
                            <span key={f.functionId} className={`text-[9px] px-1.5 py-0.5 rounded ${dark ? 'bg-slate-700/60 text-slate-300' : 'bg-slate-100 text-slate-600'}`}
                              title={`${f.functionName} (${f.channel})`}>
                              {f.functionName}: <b style={{ color: '#818cf8' }}>{f.scheduled}</b>/<b style={{ color: '#34d399' }}>{f.actual ?? '—'}</b>
                            </span>
                          ))}
                          {h.unmappedActual ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}>
                              {ar ? 'غير مرتبط' : 'unmapped'}: {h.unmappedActual}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className={`text-[10px] mt-2 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
              {ar ? 'ملاحظة: المجدول في ساعات الفجر لا يشمل ذيول شفتات MD من اليوم السابق (قيد التحسين). "غير مرتبط" = متصلون لم يُربطوا بموظف بعد — ادمج التكرارات في Employee Merge.'
                  : 'Note: night-hour scheduled excludes prior-day MD tails (known). "Unmapped" = online agents not yet linked — merge duplicates in Employee Merge.'}
            </p>
          </div>
        )}
      </div>

      {/* CPO Forecaster */}
      <div className={`rounded-2xl p-4 mb-4 border ${dark ? 'bg-white/[0.02] border-white/[0.08]' : 'bg-white border-slate-200'}`}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <ShoppingBag size={16} className="text-amber-400" />
            <span className={`text-sm font-semibold ${dark ? 'text-slate-200' : 'text-slate-700'}`}>
              {ar ? 'متنبّئ CPO' : 'CPO Forecaster'}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${dark ? 'bg-amber-500/15 text-amber-300' : 'bg-amber-50 text-amber-600 border border-amber-200'}`}>
              {ar ? 'مكالمات لكل طلب' : 'Calls Per Order'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 flex-1">
            {/* Orders input */}
            <div className="flex items-center gap-2">
              <label className={`text-xs whitespace-nowrap ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                {ar ? 'الطلبات اليومية' : 'Daily Orders'}
              </label>
              <input
                type="number" min={0} value={cpoOrders || ''}
                onChange={e => { setCpoOrders(+e.target.value); setCpoResult(null); }}
                placeholder={ar ? 'مثال: 1000' : 'e.g. 1000'}
                className={`w-28 text-center px-2 py-1.5 rounded-lg border text-sm font-mono ${dark ? 'bg-white/[0.04] border-white/10 text-white' : 'bg-white border-slate-300'}`}
              />
            </div>

            {/* CPO% slider */}
            <div className="flex items-center gap-2">
              <label className={`text-xs whitespace-nowrap ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                CPO%
              </label>
              <input
                type="range" min={1} max={100} value={cpoPct}
                onChange={e => { setCpoPct(+e.target.value); setCpoResult(null); }}
                className="w-24 accent-amber-500"
              />
              <input
                type="number" min={1} max={100} value={cpoPct}
                onChange={e => { setCpoPct(+e.target.value); setCpoResult(null); }}
                className={`w-16 text-center px-2 py-1.5 rounded-lg border text-sm font-mono ${dark ? 'bg-slate-700 border-slate-600 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-700'}`}
              />
              <span className={`text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>%</span>
            </div>

            {/* Calculate button */}
            <button
              onClick={calcCpo}
              disabled={!cpoOrders || cpoLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                !cpoOrders
                  ? (dark ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-slate-100 text-slate-400 cursor-not-allowed')
                  : (dark ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30' : 'bg-amber-500 text-white hover:bg-amber-600')
              }`}
            >
              {cpoLoading ? <RefreshCw size={13} className="animate-spin" /> : <Calculator size={13} />}
              {ar ? 'تنبّأ' : 'Forecast'}
            </button>

            {/* Result */}
            {cpoResult && (
              <div className="flex items-center gap-3">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border font-mono ${dark ? 'bg-white/[0.04] border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{cpoOrders.toLocaleString()} {ar ? 'طلب' : 'orders'} × {cpoPct}%</span>
                  <ArrowRight size={12} className={dark ? 'text-slate-500' : 'text-slate-400'} />
                  <span className={`text-base font-bold ${dark ? 'text-amber-300' : 'text-amber-600'}`}>
                    {cpoResult.forecastedCalls.toLocaleString()}
                  </span>
                  <span className={`text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{ar ? 'مكالمات متوقعة' : 'forecasted calls'}</span>
                </div>
                {selectedFunc && (
                  <button
                    onClick={pushCpoToIntervals}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      dark
                        ? 'bg-blue-500/15 border-blue-500/30 text-blue-300 hover:bg-blue-500/25'
                        : 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100'
                    }`}
                    title={ar ? 'وزّع المكالمات المتوقعة بالتساوي على فترات 07:00–22:00' : 'Distribute forecasted calls evenly across 07:00–22:00 intervals'}
                  >
                    <ArrowRight size={11} />
                    {ar ? 'دفع إلى الفترات' : 'Push to intervals'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Formula tooltip */}
          <div className={`text-xs shrink-0 ${dark ? 'text-slate-500' : 'text-slate-400'}`} title={ar ? 'المكالمات المتوقعة = الطلبات × CPO%' : 'Expected Calls = Orders × CPO%'}>
            <Info size={13} />
          </div>
        </div>

        {cpoResult && (
          <div className={`mt-2 text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
            {ar ? 'المعادلة:' : 'Formula:'} {cpoOrders.toLocaleString()} {ar ? 'طلب' : 'orders'} × {cpoPct}% CPO = <strong className={dark ? 'text-amber-300' : 'text-amber-600'}>{cpoResult.forecastedCalls.toLocaleString()} {ar ? 'مكالمة متوقعة' : 'expected calls'}</strong>
            {selectedFunc && !result && <span className="ml-2 italic">{ar ? '— اضغط "دفع إلى الفترات" لتوزيعها على شبكة الحجم، ثم احسب' : '— click "Push to intervals" to distribute across the volume grid, then Calculate'}</span>}
          </div>
        )}
      </div>

      {/* Main calculator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left panel — inputs */}
        <div className="lg:col-span-4 space-y-4">
          {/* Function selector (if not picked from overview) */}
          {functions.length > 0 && (
            <div className={`rounded-xl border p-4 ${dark ? 'bg-white/[0.02] border-white/[0.08]' : 'bg-white border-slate-200'}`}>
              <div className={`text-xs font-semibold mb-3 uppercase tracking-wide ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                {ar ? 'اختر القسم' : 'Select Function'}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {functions.map(fn => {
                  const meta = channelMeta(fn.channel_type);
                  const Icon = meta.icon;
                  return (
                    <button
                      key={fn.id}
                      onClick={() => selectFunc(fn)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all text-left ${
                        selectedFunc?.id === fn.id
                          ? (dark ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-blue-400 bg-blue-50 text-blue-700')
                          : (dark ? 'border-slate-600 hover:border-slate-500 text-slate-300' : 'border-slate-200 hover:border-slate-300 text-slate-600')
                      }`}
                    >
                      <Icon size={14} className={meta.color} />
                      <span className="truncate font-medium">{fn.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Model parameters */}
          {selectedFunc && (
            <div className={`rounded-xl border p-4 ${dark ? 'bg-white/[0.02] border-white/[0.08]' : 'bg-white border-slate-200'}`}>
              <div className={`text-xs font-semibold mb-3 uppercase tracking-wide flex items-center gap-1.5 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                <Zap size={12} />
                {ar ? 'معاملات النموذج' : 'Model Parameters'} — {selectedFunc.name}
              </div>

              <div className="space-y-3 text-sm">
                {/* Interval */}
                <div className="flex items-center justify-between">
                  <label className={dark ? 'text-slate-400' : 'text-slate-500'}>{ar ? 'الفترة (دقيقة)' : 'Interval (min)'}</label>
                  <select
                    value={intervalMinutes}
                    onChange={e => setIntervalMinutes(+e.target.value)}
                    className={`w-24 px-2 py-1.5 rounded-lg border text-sm ${dark ? 'bg-white/[0.04] border-white/10 text-white' : 'bg-white border-slate-300'}`}
                  >
                    <option value={15}>{ar ? '15 دقيقة' : '15 min'}</option>
                    <option value={30}>{ar ? '30 دقيقة' : '30 min'}</option>
                    <option value={60}>{ar ? '60 دقيقة' : '60 min'}</option>
                  </select>
                </div>

                {/* Default AHT */}
                <div className="flex items-center justify-between">
                  <label className={dark ? 'text-slate-400' : 'text-slate-500'}>
                    {ar ? 'متوسط المعالجة الافتراضي (ث)' : 'Default AHT (sec)'}
                    <span className={`ml-1 text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{Math.floor(defaultAht / 60)}m {defaultAht % 60}s</span>
                  </label>
                  <input
                    type="number" min={30} max={3600} value={defaultAht}
                    onChange={e => setDefaultAht(+e.target.value)}
                    className={`w-20 text-center px-2 py-1.5 rounded-lg border text-sm ${dark ? 'bg-white/[0.04] border-white/10 text-white' : 'bg-white border-slate-300'}`}
                  />
                </div>

                {/* Voice-specific: Target SL + Answer time */}
                {selectedFunc.channel_type === 'voice' && (
                  <>
                    <div className="flex items-center justify-between">
                      <label className={dark ? 'text-slate-400' : 'text-slate-500'}>
                        {ar ? 'هدف SL (%)' : 'Target SL (%)'}
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="range" min={50} max={99} value={targetSL}
                          onChange={e => setTargetSL(+e.target.value)}
                          className="w-20"
                        />
                        <span className={`w-10 text-center text-sm font-mono ${dark ? 'text-blue-300' : 'text-blue-600'}`}>{targetSL}%</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className={dark ? 'text-slate-400' : 'text-slate-500'}>
                        {ar ? 'هدف وقت الرد (ث)' : 'Target Answer (sec)'}
                      </label>
                      <input
                        type="number" min={5} max={120} value={targetAnswerSec}
                        onChange={e => setTargetAnswerSec(+e.target.value)}
                        className={`w-20 text-center px-2 py-1.5 rounded-lg border text-sm ${dark ? 'bg-white/[0.04] border-white/10 text-white' : 'bg-white border-slate-300'}`}
                      />
                    </div>
                  </>
                )}

                {/* Chat/WA: Target response time */}
                {(selectedFunc.channel_type === 'chat' || selectedFunc.channel_type === 'whatsapp') && (
                  <>
                    <div className="flex items-center justify-between">
                      <label className={dark ? 'text-slate-400' : 'text-slate-500'}>{ar ? 'التزامن' : 'Concurrency'}</label>
                      <span className={`text-sm font-bold ${dark ? 'text-emerald-300' : 'text-emerald-600'}`}>{selectedFunc.concurrency || 4}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className={dark ? 'text-slate-400' : 'text-slate-500'}>{ar ? 'هدف وقت الاستجابة (ث)' : 'Target Response (sec)'}</label>
                      <input
                        type="number" min={30} max={600} value={targetAnswerSec}
                        onChange={e => setTargetAnswerSec(+e.target.value)}
                        className={`w-20 text-center px-2 py-1.5 rounded-lg border text-sm ${dark ? 'bg-white/[0.04] border-white/10 text-white' : 'bg-white border-slate-300'}`}
                      />
                    </div>
                  </>
                )}

                {/* Email: Opening backlog */}
                {selectedFunc.channel_type === 'email' && (
                  <div className="flex items-center justify-between">
                    <label className={dark ? 'text-slate-400' : 'text-slate-500'}>{ar ? 'الباكلوج الافتتاحي' : 'Opening Backlog'}</label>
                    <input
                      type="number" min={0} value={openingBacklog}
                      onChange={e => setOpeningBacklog(+e.target.value)}
                      className={`w-20 text-center px-2 py-1.5 rounded-lg border text-sm ${dark ? 'bg-white/[0.04] border-white/10 text-white' : 'bg-white border-slate-300'}`}
                    />
                  </div>
                )}

                {/* Shrinkage */}
                <div className="flex items-center justify-between">
                  <label className={dark ? 'text-slate-400' : 'text-slate-500'}>{ar ? 'الانكماش (%)' : 'Shrinkage (%)'}</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="range" min={0} max={50} value={shrinkage}
                      onChange={e => setShrinkage(+e.target.value)}
                      className="w-20"
                    />
                    <span className={`w-10 text-center text-sm font-mono ${dark ? 'text-yellow-300' : 'text-yellow-600'}`}>{shrinkage}%</span>
                  </div>
                </div>

                {/* Occupancy target */}
                <div className="flex items-center justify-between">
                  <label className={dark ? 'text-slate-400' : 'text-slate-500'}>{ar ? 'هدف الإشغال (%)' : 'Occupancy Target (%)'}</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="range" min={60} max={95} value={occupancyTarget}
                      onChange={e => setOccupancyTarget(+e.target.value)}
                      className="w-20"
                    />
                    <span className={`w-10 text-center text-sm font-mono ${dark ? 'text-orange-300' : 'text-orange-600'}`}>{occupancyTarget}%</span>
                  </div>
                </div>

                {/* Intern factor */}
                <div className="flex items-center justify-between">
                  <label className={`flex items-center gap-1 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {ar ? 'إنتاجية المتدرب' : 'Intern Productivity'}
                    <span title={ar ? 'المتدرب = 70% من الموظف الكامل افتراضياً' : 'Intern = 70% of full agent by default'} className="cursor-help">
                      <Info size={11} className={dark ? 'text-slate-500' : 'text-slate-400'} />
                    </span>
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="range" min={40} max={100} value={internFactor}
                      onChange={e => setInternFactor(+e.target.value)}
                      className="w-20"
                    />
                    <span className={`w-10 text-center text-sm font-mono ${dark ? 'text-purple-300' : 'text-purple-600'}`}>{internFactor}%</span>
                  </div>
                </div>
              </div>

              {/* Assumptions info box */}
              <div className={`mt-3 rounded-lg p-2.5 text-xs border ${dark ? 'bg-white/[0.03] border-white/[0.08] text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                <div className="flex items-center gap-1 mb-1 font-medium"><Info size={10} /> {ar ? 'افتراضات النموذج' : 'Model assumptions'}</div>
                <div>• {ar ? 'الانكماش يُطبّق كمعامل توظيف إجمالي' : 'Shrinkage applied as gross staffing factor'}</div>
                <div>• {ar ? 'Erlang-C يفترض حالة مستقرة ووصولاً عشوائياً' : 'Erlang-C assumes steady-state, random arrivals'}</div>
                {(selectedFunc.channel_type === 'chat' || selectedFunc.channel_type === 'whatsapp') && (
                  <div>• {ar ? `التزامن = ${selectedFunc.concurrency || 4} محادثات متزامنة لكل موظف` : `Concurrency = ${selectedFunc.concurrency || 4} simultaneous conversations per agent`}</div>
                )}
                <div>• {ar ? 'معامل المتدرب يقلل الوقت الإنتاجي الفعّال' : 'Intern factor reduces effective productive time'}</div>
              </div>
            </div>
          )}
        </div>

        {/* Right panel — volume input + results */}
        <div className="lg:col-span-8 space-y-4">
          {!selectedFunc ? (
            <div className={`rounded-xl border p-12 flex flex-col items-center justify-center ${dark ? 'bg-white/[0.02] border-white/[0.08]' : 'bg-white border-slate-200'}`}>
              <Calculator size={48} className={`mb-3 ${dark ? 'text-slate-600' : 'text-slate-300'}`} />
              <div className={`text-lg font-semibold mb-1 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                {ar ? 'اختر قسماً للبدء' : 'Select a function to start'}
              </div>
              <div className={`text-sm ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                {ar ? 'اضغط إحدى بطاقات الهيدكاونت أعلاه أو اختر من قائمة الأقسام' : 'Click one of the HC cards above or select from the function list'}
              </div>
            </div>
          ) : (
            <>
              {/* Volume input */}
              <div className={`rounded-xl border p-4 ${dark ? 'bg-white/[0.02] border-white/[0.08]' : 'bg-white border-slate-200'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                    <Clock size={12} />
                    {ar ? 'توقّع الحجم' : 'Volume Forecast'} — {selectedFunc.name}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                      {selectedFunc.channel_type === 'email' ? (ar ? 'إيميل/فترة' : 'emails/interval') :
                       selectedFunc.channel_type === 'voice' ? (ar ? 'مكالمات/فترة' : 'calls/interval') : (ar ? 'محادثات/فترة' : 'chats/interval')}
                    </span>
                  </div>
                </div>
                <VolumeGrid
                  rows={intervals}
                  onChange={setIntervals}
                  dark={dark}
                  globalAht={defaultAht}
                  ar={ar}
                />
              </div>

              {/* Calculate button */}
              <button
                onClick={calculate}
                disabled={calculating}
                className={`w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all ${
                  calculating
                    ? (dark ? 'bg-blue-600/50 cursor-not-allowed text-blue-300' : 'bg-blue-300 cursor-not-allowed text-white')
                    : (dark ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/30' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200')
                }`}
              >
                {calculating ? (
                  <><RefreshCw size={16} className="animate-spin" /> {ar ? 'جاري الحساب…' : 'Calculating…'}</>
                ) : (
                  <><Calculator size={16} /> {ar ? 'احسب الهيدكاونت المطلوب' : 'Calculate Required HC'}</>
                )}
              </button>

              {error && (
                <div className={`rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${dark ? 'bg-red-500/10 border border-red-500/30 text-red-300' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                  <AlertTriangle size={14} />
                  {error}
                </div>
              )}

              {/* Results */}
              {result && (
                <div className={`rounded-xl border p-4 ${dark ? 'bg-white/[0.02] border-white/[0.08]' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                      <BarChart3 size={12} />
                      {ar ? 'النتائج' : 'Results'} — {result.functionName}
                      <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
                        {result.channelType}
                      </span>
                    </div>
                    <span className={`text-xs flex items-center gap-1 ${result.slaAtRisk ? 'text-red-400' : 'text-emerald-400'}`}>
                      {result.slaAtRisk ? <AlertTriangle size={12} /> : <CheckCircle size={12} />}
                      {result.slaAtRisk ? (ar ? 'SLA في خطر' : 'SLA at risk') : (ar ? 'SLA آمن' : 'SLA safe')}
                    </span>
                  </div>
                  <ResultsTable result={result} dark={dark} ar={ar} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className={`mt-6 rounded-xl border p-3 flex flex-wrap gap-4 text-xs ${dark ? 'bg-slate-800/50 border-slate-700 text-slate-500' : 'bg-white border-slate-200 text-slate-400'}`}>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> {ar ? 'المطلوب = حاجة التوظيف الصافية (بدون انكماش)' : 'Required HC = pure staffing need (no shrinkage)'}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" /> {ar ? '+انكماش = الهيدكاونت الإجمالي المطلوب على الروستر' : '+Shrinkage = gross HC needed on roster'}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> {ar ? 'حرج = فجوة > 3 موظفين' : 'Critical = gap > 3 agents'}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> {ar ? 'تحذير = فجوة 1–3 موظفين' : 'Warning = gap 1–3 agents'}</span>
        <span className="flex items-center gap-1.5"><Minus size={10} /> {ar ? 'الحمل = كثافة المرور (إرلانج) للصوت؛ حمل متزامن مُطبَّع للشات' : 'Workload = Traffic Intensity (Erlangs) for voice; normalized concurrent load for chat'}</span>
      </div>
    </div>
  );
}
