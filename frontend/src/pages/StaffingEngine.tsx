import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Loader2, Sigma, SlidersHorizontal, RefreshCw, ChevronDown, ChevronUp, Info, Save,
  CalendarRange, Download, Upload, UserPlus,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';

/* ═════════════════════════════════════════════════════════════════════════════
 *  STAFFING ENGINE — the forecast → Erlang → generator chain, visible.
 *  Left: per-function parameters (CPO/AHT/ACW/Hold/SL/occupancy/shrinkage/
 *  productivity/concurrency — every knob editable, saved per function).
 *  Right: the hourly requiredScheduledHc heatmap the generator consumes,
 *  with a full math drill-down per cell (vol → ahtEff → Erlangs → agents →
 *  occupancy → productivity → shrinkage). Orders slider = CPO scenario.
 * ════════════════════════════════════════════════════════════════════════════ */

interface Params {
  functionKey: string; channelMix: Record<string, number>; model: string;
  cpoPct: number | null; ahtSec: number | null; acwSec: number; holdSec: number;
  targetSl: number; targetAnswerSec: number; occupancyCap: number;
  shrinkage: number; productivity: number; concurrency: number; marginalEff: number;
  isStaffed: boolean;
}
interface HourReq {
  hour: number; volume: number; ahtEffSec: number; erlangs: number;
  agentsForSl: number; occupancyAtN: number; afterProductivity: number; requiredScheduledHc: number;
}
interface FnDay { functionKey: string; model: string; hours: HourReq[]; dayTotalRequired: number; dayContacts: number }
interface ReqResp {
  from: string; to: string; ordersScale: number; basis: string;
  measuredAht: Record<string, number>;
  ordersPeriod: { period_label: string; count: number } | null;
  days: { date: string; functions: FnDay[]; totalCurve48: number[] }[];
}

const NUM_FIELDS: { key: keyof Params; ar: string; en: string; step: number; pct?: boolean }[] = [
  { key: 'acwSec',          ar: 'ACW (ث)',        en: 'ACW (s)',       step: 5 },
  { key: 'holdSec',         ar: 'Hold (ث)',       en: 'Hold (s)',      step: 5 },
  { key: 'targetSl',        ar: 'هدف SL',         en: 'SL target',     step: 0.05, pct: true },
  { key: 'targetAnswerSec', ar: 'زمن الرد (ث)',   en: 'Answer (s)',    step: 5 },
  { key: 'occupancyCap',    ar: 'سقف الإشغال',    en: 'Occupancy cap', step: 0.05, pct: true },
  { key: 'shrinkage',       ar: 'شرينكج',         en: 'Shrinkage',     step: 0.05, pct: true },
  { key: 'productivity',    ar: 'إنتاجية',        en: 'Productivity',  step: 0.05, pct: true },
  { key: 'concurrency',     ar: 'تزامن',          en: 'Concurrency',   step: 1 },
];

interface EventFnVerdict {
  functionKey: string; error?: string; requiredPeak: number; availableAgents: number;
  gapAgents: number; internsToHire: number; projectedSlNow: number; projectedSlAfterHire: number;
  worstDay: string | null; targetSl: number;
}

function EventForecastSection({ dark, ar, surface, border, tPri, tSec }: {
  dark: boolean; ar: boolean; surface: string; border: string; tPri: string; tSec: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ name: string; from: string; to: string; perFunction: EventFnVerdict[] } | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) apiClient.get('/capacity/staffing/event-forecasts').then(r => setHistory(r.data)).catch(() => {});
  }, [open, result]);

  const download = async () => {
    const r = await apiClient.get('/capacity/staffing/event-template', { responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = url; a.download = 'WFM_Event_Forecast_Template.xlsx'; a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (f: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('name', f.name.replace(/\.xlsx?$/i, ''));
      const r = await apiClient.post('/capacity/staffing/event-forecast', fd);
      setResult(r.data);
    } catch { /* surfaced by empty result */ }
    setBusy(false);
  };

  return (
    <div className="rounded-2xl" style={{ background: surface, border: `1px solid ${border}` }}>
      <button onClick={() => setOpen(s => !s)} className="w-full flex items-center gap-2 p-3">
        <CalendarRange size={14} style={{ color: '#34d399' }} />
        <span className="font-bold text-xs" style={{ color: tPri }}>
          {ar ? 'فوركاست فترة / إيفنت — نزّل القالب، عبّيه، ارفعه: كم إنترن لازم توظف + الـSL المتوقع' : 'Event / period forecast — download, fill, upload: interns to hire + projected SL'}
        </span>
        <span className="ms-auto">{open ? <ChevronUp size={14} color={tSec} /> : <ChevronDown size={14} color={tSec} />}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={download} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg"
              style={{ background: dark ? 'rgba(52,211,153,0.12)' : 'rgba(16,185,129,0.08)', color: '#34d399' }}>
              <Download size={12} /> {ar ? 'تنزيل القالب' : 'Download template'}
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={busy}
              className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg"
              style={{ background: '#6366f1', color: '#fff' }}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {ar ? 'رفع الملف المعبّى' : 'Upload filled file'}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ''; }} />
            <span className="text-[9px]" style={{ color: tSec }}>
              {ar ? 'شيت Daily_Forecast: الطلبات + كونتاكتس كل فنكشن يوم بيوم · شيت Available_Agents: المتاحين + إنتاجية الإنترن'
                  : 'Daily_Forecast: orders + contacts per function per day · Available_Agents: current agents + intern productivity'}
            </span>
          </div>

          {result && (
            <div style={{ overflowX: 'auto' }}>
              <div className="text-[10px] font-black mb-1.5" style={{ color: tPri }}>
                {result.name} — {result.from} → {result.to}
              </div>
              <table className="w-full text-[10px]" style={{ borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${border}` }}>
                    {[ar ? 'الفنكشن' : 'Function', ar ? 'المطلوب (ذروة)' : 'Required (peak)', ar ? 'المتاح' : 'Available',
                      ar ? 'الفجوة' : 'Gap', ar ? '⬅ إنترنز للتوظيف' : '⬅ Interns to hire',
                      ar ? 'SL الآن' : 'SL now', ar ? 'SL بعد التوظيف' : 'SL after', ar ? 'أسوأ يوم' : 'Worst day'].map((h, i) => (
                      <th key={i} className="px-2 py-1.5 font-bold text-center" style={{ color: tSec }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.perFunction.filter(f => !f.error).map(f => (
                    <tr key={f.functionKey} style={{ borderBottom: `1px solid ${border}` }}>
                      <td className="px-2 py-1.5 font-bold" style={{ color: tPri }}>{f.functionKey}</td>
                      <td className="px-2 py-1.5 text-center font-bold tabular-nums" style={{ color: '#f59e0b' }}>{f.requiredPeak}</td>
                      <td className="px-2 py-1.5 text-center tabular-nums" style={{ color: tPri }}>{f.availableAgents}</td>
                      <td className="px-2 py-1.5 text-center font-bold tabular-nums" style={{ color: f.gapAgents > 0 ? '#f87171' : '#4ade80' }}>{f.gapAgents}</td>
                      <td className="px-2 py-1.5 text-center font-black tabular-nums" style={{ color: f.internsToHire > 0 ? '#f87171' : '#4ade80' }}>
                        {f.internsToHire > 0 ? <span className="inline-flex items-center gap-1"><UserPlus size={11} />{f.internsToHire}</span> : '✓'}
                      </td>
                      <td className="px-2 py-1.5 text-center font-bold tabular-nums"
                        style={{ color: f.projectedSlNow >= f.targetSl ? '#4ade80' : '#f87171' }}>{Math.round(f.projectedSlNow * 100)}%</td>
                      <td className="px-2 py-1.5 text-center font-bold tabular-nums"
                        style={{ color: f.projectedSlAfterHire >= f.targetSl ? '#4ade80' : '#f59e0b' }}>{Math.round(f.projectedSlAfterHire * 100)}%</td>
                      <td className="px-2 py-1.5 text-center" style={{ color: tSec }}>{f.worstDay ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!result && history.length > 0 && (
            <div className="text-[9px]" style={{ color: tSec }}>
              {ar ? 'رفعات سابقة: ' : 'Previous uploads: '}
              {history.slice(0, 5).map((h: any) => `${h.name} (${h.from}→${h.to})`).join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LearnedSection({ dark, ar, surface, border, tPri, tSec }: {
  dark: boolean; ar: boolean; surface: string; border: string; tPri: string; tSec: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<any>(null);
  const [ch, setCh] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const loadLearned = useCallback(async () => {
    const r = await apiClient.get('/capacity/staffing/learned').catch(() => null);
    if (r) { setData(r.data); const keys = Object.keys(r.data.channels ?? {}); setCh(c => keys.includes(c) ? c : (keys[0] ?? '')); }
  }, []);
  useEffect(() => { if (open) loadLearned(); }, [open, loadLearned]);

  const rollNow = async () => {
    setBusy(true);
    await apiClient.post('/capacity/staffing/observations/rollup?hoursBack=336').catch(() => {});
    await loadLearned();
    setBusy(false);
  };

  const grid: (number | null)[][] | null = data?.channels?.[ch]?.grid ?? null;
  const maxV = grid ? Math.max(1, ...grid.flat().map(v => v ?? 0)) : 1;
  const DOWS = ar ? ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="rounded-2xl" style={{ background: surface, border: `1px solid ${border}` }}>
      <button onClick={() => setOpen(s => !s)} className="w-full flex items-center gap-2 p-3">
        <span style={{ color: '#34d399', fontSize: 13 }}>⚡</span>
        <span className="font-bold text-xs" style={{ color: tPri }}>
          {ar ? 'التعلم الآلي — الحمل المقاس من سبرينكلر (المحرك لا يوظف أبدًا أقل منه)' : 'Machine learning — measured Sprinklr load (the engine never staffs below it)'}
        </span>
        {data && <span className="text-[9px]" style={{ color: tSec }}>
          {data.cells} {ar ? 'خلية متعلمة' : 'learned cells'} · {data.total_samples} {ar ? 'عينة' : 'samples'}
        </span>}
        <span className="ms-auto">{open ? <ChevronUp size={14} color={tSec} /> : <ChevronDown size={14} color={tSec} />}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {Object.keys(data?.channels ?? {}).map(c => (
              <button key={c} onClick={() => setCh(c)}
                className="text-[10px] font-bold px-2.5 py-1 rounded-lg"
                style={{ background: c === ch ? '#34d399' : (dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)'), color: c === ch ? '#052e22' : tSec }}>
                {c} <span style={{ opacity: 0.75 }}>({data.channels[c].cells})</span>
              </button>
            ))}
            <button onClick={rollNow} disabled={busy}
              className="ms-auto flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg"
              style={{ background: dark ? 'rgba(52,211,153,0.12)' : 'rgba(16,185,129,0.08)', color: '#34d399' }}>
              {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              {ar ? 'تعلّم الآن (آخر 14 يوم)' : 'Learn now (last 14 days)'}
            </button>
          </div>
          {!grid ? (
            <div className="text-[10px] py-3" style={{ color: tSec }}>
              {ar ? 'لا توجد ملاحظات بعد — خلّي جسر سبرينكلر شغال؛ الراصد يتعلم كل ساعة تلقائيًا.' : 'No observations yet — keep the Sprinklr bridge running; the observer learns hourly.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
                <thead>
                  <tr>
                    <th className="text-[8px] font-bold px-1" style={{ color: tSec }}></th>
                    {Array.from({ length: 24 }, (_, h) => (
                      <th key={h} className="text-[8px] font-bold" style={{ color: tSec, minWidth: 24 }}>{String(h).padStart(2, '0')}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.map((row, dow) => (
                    <tr key={dow}>
                      <td className="text-[8px] font-bold px-1 whitespace-nowrap" style={{ color: tSec }}>{DOWS[dow]}</td>
                      {row.map((v, h) => (
                        <td key={h} className="text-center text-[8px] font-bold rounded tabular-nums"
                          title={v != null ? `${DOWS[dow]} ${String(h).padStart(2, '0')}:00 — P90 ${v} Erlang` : (ar ? 'لم يُقس بعد' : 'not measured yet')}
                          style={{
                            height: 20, minWidth: 24,
                            background: v == null ? (dark ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.02)') : `rgba(52,211,153,${0.12 + 0.7 * (v / maxV)})`,
                            color: v != null && v / maxV > 0.5 ? '#052e22' : tSec,
                          }}>
                          {v != null ? Math.round(v) : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-[9px] mt-1" style={{ color: tSec }}>
                {ar ? 'P90 للحمل المتزامن المقاس (Erlang شامل الانتظار) لكل يوم×ساعة — الخلايا الخضراء بالهيت-ماب فوق ⚡ = ساعة رفعتها الأرضية المتعلمة. AHT/ACW/Hold بيتعلموا بنفس الطريقة أول ما الجسر يلقط إحصائيات المعالجة.'
                    : 'P90 measured concurrent load (Erlangs incl. waiting) per weekday×hour — ⚡-ringed heatmap cells above were raised by the learned floor. AHT/ACW/Hold learn the same way once the bridge captures handle stats.'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const heat = (v: number, max: number, dark: boolean) => {
  if (v <= 0) return dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)';
  const t = Math.min(v / Math.max(max, 1), 1);
  return `rgba(${Math.round(99 + t * 140)}, ${Math.round(102 - t * 40)}, ${Math.round(241 - t * 130)}, ${0.25 + t * 0.65})`;
};

export default function StaffingEnginePage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  const [params, setParams] = useState<Params[]>([]);
  const [req, setReq] = useState<ReqResp | null>(null);
  const [from, setFrom] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [viewDate, setViewDate] = useState<string | null>(null);   // which day of the range is displayed
  const [ordersScale, setOrdersScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showParams, setShowParams] = useState(false);
  const [drill, setDrill] = useState<{ fn: string; h: HourReq } | null>(null);
  const [dirty, setDirty] = useState<Record<string, Partial<Params>>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const f = from, t = to >= from ? to : from;
      const [p, r] = await Promise.all([
        apiClient.get('/capacity/staffing/params'),
        apiClient.get('/capacity/staffing/requirement', { params: { from: f, to: t, ordersScale } }),
      ]);
      setParams(p.data); setReq(r.data);
      setViewDate(v => (v && r.data.days.some((d: any) => d.date === v)) ? v : r.data.days[0]?.date ?? null);
    } catch { /* keep last */ }
    setLoading(false);
  }, [from, to, ordersScale]);
  useEffect(() => { load(); }, [load]);

  const saveDirty = async () => {
    setSaving(true);
    try {
      for (const [fn, patch] of Object.entries(dirty)) {
        await apiClient.patch(`/capacity/staffing/params/${encodeURIComponent(fn)}`, patch);
      }
      setDirty({});
      await load();
    } catch { /* surface via reload */ }
    setSaving(false);
  };

  const edit = (fn: string, key: keyof Params, val: any) => {
    setParams(ps => ps.map(p => p.functionKey === fn ? { ...p, [key]: val } : p));
    setDirty(d => ({ ...d, [fn]: { ...(d[fn] ?? {}), [key]: val } }));
  };

  const day = useMemo(() => req?.days?.find(d => d.date === viewDate) ?? req?.days?.[0], [req, viewDate]);
  const staffedFns = useMemo(() => (day?.functions ?? []).filter(f => f.dayContacts > 0 || f.dayTotalRequired > 0), [day]);
  const maxCell = useMemo(() => Math.max(1, ...staffedFns.flatMap(f => f.hours.map(h => h.requiredScheduledHc))), [staffedFns]);

  const surface = dark ? 'rgba(255,255,255,0.03)' : '#ffffff';
  const border = dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
  const tPri = dark ? '#e2e8f0' : '#0f172a';
  const tSec = '#64748b';

  return (
    <div className="space-y-4" dir={ar ? 'rtl' : 'ltr'}>
      {/* ── Header: the chain, the scenario lever, the measured facts ─────── */}
      <div className="rounded-2xl p-4" style={{ background: surface, border: `1px solid ${border}` }}>
        <div className="flex flex-wrap items-center gap-3">
          <Sigma size={18} style={{ color: '#818cf8' }} />
          <div className="min-w-0">
            <div className="font-black text-sm" style={{ color: tPri }}>
              {ar ? 'محرك التوظيف — من التوقع إلى الجدول' : 'Staffing Engine — forecast to schedule'}
            </div>
            <div className="text-[10px]" style={{ color: tSec }}>
              {ar
                ? 'فوليوم × AHT فعّال (كلام+هولد+ACW) → Erlang-C عند هدف الـSL وسقف الإشغال → ÷ إنتاجية → ÷ (1−شرينكج) = المطلوب جدولته — هذا ما يستهلكه مولّد الجدول'
                : 'volume × effective AHT (talk+hold+ACW) → Erlang-C @ SL & occupancy cap → ÷ productivity → ÷ (1−shrinkage) = scheduled requirement — exactly what the generator consumes'}
            </div>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <span className="text-[9px] font-bold" style={{ color: tSec }}>{ar ? 'من' : 'From'}</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="text-xs rounded-lg px-2 py-1.5"
              style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)', color: tPri, border: `1px solid ${border}` }} />
            <span className="text-[9px] font-bold" style={{ color: tSec }}>{ar ? 'إلى' : 'To'}</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="text-xs rounded-lg px-2 py-1.5"
              style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)', color: tPri, border: `1px solid ${border}` }} />
            <button onClick={load} className="p-1.5 rounded-lg" title={ar ? 'تحديث' : 'Refresh'}
              style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)' }}>
              <RefreshCw size={14} style={{ color: tSec }} />
            </button>
          </div>
        </div>

        {/* day switcher across the range */}
        {(req?.days?.length ?? 0) > 1 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {req!.days.map(d => (
              <button key={d.date} onClick={() => setViewDate(d.date)}
                className="text-[9px] font-bold px-2 py-1 rounded-lg tabular-nums"
                style={{
                  background: d.date === day?.date ? '#6366f1' : (dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)'),
                  color: d.date === day?.date ? '#fff' : tSec,
                }}>
                {d.date.slice(5)} · {ar
                  ? ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'][(d as any).dow ?? new Date(d.date).getDay()]
                  : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][(d as any).dow ?? new Date(d.date).getDay()]}
                <span className="ms-1" style={{ opacity: 0.7 }}>({Math.max(...d.totalCurve48)})</span>
              </button>
            ))}
          </div>
        )}

        {/* orders scenario slider + measured AHT chips */}
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold" style={{ color: tSec }}>
              {ar ? `سيناريو الطلبات ×${ordersScale.toFixed(2)}` : `Orders scenario ×${ordersScale.toFixed(2)}`}
            </span>
            <input type="range" min={0.5} max={2} step={0.05} value={ordersScale}
              onChange={e => setOrdersScale(+e.target.value)} className="w-40 accent-indigo-500" />
            {req?.ordersPeriod && (
              <span className="text-[9px]" style={{ color: tSec }}>
                {ar ? 'آخر فترة طلبات' : 'orders'} {req.ordersPeriod.period_label}: <b style={{ color: tPri }}>{req.ordersPeriod.count.toLocaleString()}</b>
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 ms-auto">
            {Object.entries(req?.measuredAht ?? {}).map(([ch, v]) => (
              <span key={ch} className="text-[9px] px-2 py-0.5 rounded-full font-bold"
                style={{ background: dark ? 'rgba(129,140,248,0.12)' : 'rgba(99,102,241,0.08)', color: '#818cf8' }}>
                {ch} AHT {Math.round(v)}s
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Parameters (collapsible editor) ────────────────────────────────── */}
      <div className="rounded-2xl" style={{ background: surface, border: `1px solid ${border}` }}>
        <button onClick={() => setShowParams(s => !s)} className="w-full flex items-center gap-2 p-3">
          <SlidersHorizontal size={14} style={{ color: '#f59e0b' }} />
          <span className="font-bold text-xs" style={{ color: tPri }}>
            {ar ? 'براميترات كل فنكشن (CPO / AHT / ACW / Hold / SL / إشغال / شرينكج / إنتاجية)' : 'Per-function parameters (CPO / AHT / ACW / Hold / SL / occupancy / shrinkage / productivity)'}
          </span>
          {Object.keys(dirty).length > 0 && (
            <button onClick={e => { e.stopPropagation(); saveDirty(); }} disabled={saving}
              className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg"
              style={{ background: '#6366f1', color: '#fff' }}>
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              {ar ? `حفظ (${Object.keys(dirty).length})` : `Save (${Object.keys(dirty).length})`}
            </button>
          )}
          <span className="ms-auto">{showParams ? <ChevronUp size={14} color={tSec} /> : <ChevronDown size={14} color={tSec} />}</span>
        </button>
        {showParams && (
          <div style={{ overflowX: 'auto' }} className="px-3 pb-3">
            <table className="w-full text-[10px]" style={{ borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${border}` }}>
                  <th className="px-2 py-1.5 font-bold" style={{ color: tSec, textAlign: 'start' }}>{ar ? 'الفنكشن' : 'Function'}</th>
                  <th className="px-2 py-1.5 font-bold" style={{ color: tSec }}>{ar ? 'القنوات' : 'Channels'}</th>
                  <th className="px-2 py-1.5 font-bold" style={{ color: tSec }}>Model</th>
                  <th className="px-2 py-1.5 font-bold" style={{ color: tSec }}>AHT</th>
                  {NUM_FIELDS.map(f => (
                    <th key={String(f.key)} className="px-2 py-1.5 font-bold text-center" style={{ color: tSec }}>{ar ? f.ar : f.en}</th>
                  ))}
                  <th className="px-2 py-1.5 font-bold" style={{ color: tSec }}>{ar ? 'مُوظَّف' : 'Staffed'}</th>
                </tr>
              </thead>
              <tbody>
                {params.map(p => (
                  <tr key={p.functionKey} style={{ borderBottom: `1px solid ${border}`, opacity: p.isStaffed ? 1 : 0.45 }}>
                    <td className="px-2 py-1.5 font-bold whitespace-nowrap" style={{ color: tPri }}>{p.functionKey}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: tSec }}>
                      {Object.entries(p.channelMix).map(([c, s]) => `${c} ${Math.round((s as number) * 100)}%`).join(' · ') || '—'}
                    </td>
                    <td className="px-2 py-1.5 text-center" style={{ color: tSec }}>{p.model}</td>
                    <td className="px-2 py-1.5 text-center">
                      <input type="number" placeholder={ar ? 'مقاس' : 'auto'} value={p.ahtSec ?? ''}
                        onChange={e => edit(p.functionKey, 'ahtSec', e.target.value === '' ? null : +e.target.value)}
                        className="w-14 text-center rounded px-1 py-0.5 text-[10px]"
                        style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)', color: tPri, border: `1px solid ${border}` }} />
                    </td>
                    {NUM_FIELDS.map(f => (
                      <td key={String(f.key)} className="px-1 py-1.5 text-center">
                        <input type="number" step={f.step}
                          value={f.pct ? Math.round((p[f.key] as number) * 100) : (p[f.key] as number)}
                          onChange={e => edit(p.functionKey, f.key, f.pct ? +e.target.value / 100 : +e.target.value)}
                          className="w-12 text-center rounded px-1 py-0.5 text-[10px]"
                          style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)', color: tPri, border: `1px solid ${border}` }} />
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-center">
                      <input type="checkbox" checked={p.isStaffed} className="accent-indigo-500"
                        onChange={e => edit(p.functionKey, 'isStaffed', e.target.checked)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[9px] mt-1.5" style={{ color: tSec }}>
              {ar ? 'AHT فاضي = يُقاس تلقائيًا من آخر 28 يوم. النِسَب (SL/إشغال/شرينكج/إنتاجية) تُدخل كنسبة مئوية. حصص القنوات لكل قناة يجب أن تجمع 100% عبر الفنكشنز.'
                  : 'Blank AHT = measured from the last 28 days. Percent fields entered as %. Channel shares must sum to 100% per channel across functions.'}
            </div>
          </div>
        )}
      </div>

      {/* ── The requirement heatmap (what the generator covers) ───────────── */}
      <div className="rounded-2xl p-4" style={{ background: surface, border: `1px solid ${border}` }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="font-black text-xs" style={{ color: tPri }}>
            {ar ? `المطلوب جدولته لكل فنكشن × ساعة — ${day?.date ?? ''}` : `Required scheduled HC per function × hour — ${day?.date ?? ''}`}
          </span>
          <span className="text-[9px] ms-auto flex items-center gap-1" style={{ color: tSec }}>
            <Info size={10} /> {ar ? 'اضغط أي خلية لتفاصيل الحساب الكاملة' : 'click any cell for the full math'}
          </span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="animate-spin" style={{ color: '#818cf8' }} /></div>
        ) : !staffedFns.length ? (
          <div className="text-xs py-6 text-center" style={{ color: tSec }}>
            {ar ? 'لا توجد بيانات فوليوم — ارفع بيانات الكونتاكتس أولاً' : 'No volume data — upload contact volume first'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 2, minWidth: 1000 }}>
              <thead>
                <tr>
                  <th className="text-[9px] font-bold px-2" style={{ color: tSec, textAlign: 'start' }}>{ar ? 'الفنكشن' : 'Function'}</th>
                  {Array.from({ length: 24 }, (_, h) => (
                    <th key={h} className="text-[8px] font-bold" style={{ color: tSec, minWidth: 26 }}>{String(h).padStart(2, '0')}</th>
                  ))}
                  <th className="text-[9px] font-bold px-2" style={{ color: tSec }}>{ar ? 'ذروة' : 'Peak'}</th>
                </tr>
              </thead>
              <tbody>
                {staffedFns.map(f => (
                  <tr key={f.functionKey}>
                    <td className="text-[10px] font-bold px-2 whitespace-nowrap" style={{ color: tPri }}>
                      {f.functionKey}
                      <span className="text-[8px] font-normal ms-1" style={{ color: tSec }}>{f.dayContacts}{ar ? ' كونتاكت' : ' contacts'}</span>
                    </td>
                    {f.hours.map(h => (
                      <td key={h.hour}
                        onClick={() => setDrill({ fn: f.functionKey, h })}
                        className="text-center text-[10px] font-bold rounded cursor-pointer tabular-nums"
                        title={`${String(h.hour).padStart(2, '0')}:00 — vol ${h.volume} · ${h.requiredScheduledHc} HC${(h as any).learned ? (ar ? ' · ⚡ أرضية متعلمة (حمل مقاس)' : ' · ⚡ learned floor (measured load)') : ''}`}
                        style={{
                          background: heat(h.requiredScheduledHc, maxCell, dark),
                          color: h.requiredScheduledHc > maxCell * 0.55 ? '#fff' : tPri, height: 26,
                          boxShadow: (h as any).learned ? 'inset 0 0 0 1.5px #34d399' : undefined,
                        }}>
                        {h.requiredScheduledHc || ''}
                      </td>
                    ))}
                    <td className="text-center text-[10px] font-black px-2" style={{ color: '#f59e0b' }}>{f.dayTotalRequired}</td>
                  </tr>
                ))}
                {/* total row = the generator's curve */}
                <tr>
                  <td className="text-[10px] font-black px-2" style={{ color: '#818cf8' }}>{ar ? 'الإجمالي (منحنى المولّد)' : 'TOTAL (generator curve)'}</td>
                  {Array.from({ length: 24 }, (_, h) => {
                    const v = day?.totalCurve48?.[h * 2] ?? 0;
                    return <td key={h} className="text-center text-[10px] font-black tabular-nums" style={{ color: '#818cf8' }}>{v || ''}</td>;
                  })}
                  <td className="text-center text-[10px] font-black px-2" style={{ color: '#818cf8' }}>
                    {Math.max(...(day?.totalCurve48 ?? [0]))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Event / period forecast: Excel in → hiring verdict out ─────────── */}
      <EventForecastSection dark={dark} ar={ar} surface={surface} border={border} tPri={tPri} tSec={tSec} />

      {/* ── What the machine has LEARNED (Sprinklr measured workload) ──────── */}
      <LearnedSection dark={dark} ar={ar} surface={surface} border={border} tPri={tPri} tSec={tSec} />

      {/* ── Math drill-down ────────────────────────────────────────────────── */}
      {drill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={() => setDrill(null)}>
          <div className="w-full max-w-sm rounded-2xl p-5 space-y-2" dir={ar ? 'rtl' : 'ltr'}
            style={{ background: dark ? '#0f172a' : '#fff', border: `1px solid ${border}` }}
            onClick={e => e.stopPropagation()}>
            <div className="font-black text-sm mb-2" style={{ color: tPri }}>
              {drill.fn} — {String(drill.h.hour).padStart(2, '0')}:00
            </div>
            {[
              [ar ? '١. الفوليوم المتوقع/ساعة' : '1. Forecast volume/h', `${drill.h.volume}`],
              [ar ? '٢. AHT فعّال (كلام+هولد+ACW)' : '2. Effective AHT (talk+hold+ACW)', `${drill.h.ahtEffSec}s`],
              [ar ? '٣. الحمل (Erlangs) = vol×AHT÷3600' : '3. Workload (Erlangs) = vol×AHT÷3600', `${drill.h.erlangs}`],
              [ar ? '٤. وكلاء متاحون (Erlang-C @ SL + سقف الإشغال)' : '4. Agents AVAILABLE (Erlang-C @ SL + occupancy cap)', `${drill.h.agentsForSl}`],
              [ar ? '٥. الإشغال عند هذا العدد' : '5. Occupancy at that N', `${Math.round(drill.h.occupancyAtN * 100)}%`],
              [ar ? '٦. بعد الإنتاجية' : '6. After productivity', `${drill.h.afterProductivity}`],
              [ar ? '٧. المطلوب جدولته = ÷(1−شرينكج)' : '7. SCHEDULED required = ÷(1−shrinkage)', `${drill.h.requiredScheduledHc}`],
            ].map(([k, v], i) => (
              <div key={i} className="flex items-center justify-between text-[11px] py-1"
                style={{ borderBottom: i < 6 ? `1px dashed ${border}` : 'none' }}>
                <span style={{ color: tSec }}>{k}</span>
                <span className="font-black tabular-nums" style={{ color: i === 6 ? '#f59e0b' : tPri }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
