import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2, Sigma, SlidersHorizontal, RefreshCw, ChevronDown, ChevronUp, Info, Save,
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
  const [date, setDate] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [ordersScale, setOrdersScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showParams, setShowParams] = useState(false);
  const [drill, setDrill] = useState<{ fn: string; h: HourReq } | null>(null);
  const [dirty, setDirty] = useState<Record<string, Partial<Params>>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, r] = await Promise.all([
        apiClient.get('/capacity/staffing/params'),
        apiClient.get('/capacity/staffing/requirement', { params: { from: date, to: date, ordersScale } }),
      ]);
      setParams(p.data); setReq(r.data);
    } catch { /* keep last */ }
    setLoading(false);
  }, [date, ordersScale]);
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

  const day = req?.days?.[0];
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
          <div className="ms-auto flex items-center gap-3">
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="text-xs rounded-lg px-2 py-1.5"
              style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)', color: tPri, border: `1px solid ${border}` }} />
            <button onClick={load} className="p-1.5 rounded-lg" title={ar ? 'تحديث' : 'Refresh'}
              style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)' }}>
              <RefreshCw size={14} style={{ color: tSec }} />
            </button>
          </div>
        </div>

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
            {ar ? `المطلوب جدولته لكل فنكشن × ساعة — ${date}` : `Required scheduled HC per function × hour — ${date}`}
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
                        title={`${String(h.hour).padStart(2, '0')}:00 — vol ${h.volume} · ${h.requiredScheduledHc} HC`}
                        style={{ background: heat(h.requiredScheduledHc, maxCell, dark), color: h.requiredScheduledHc > maxCell * 0.55 ? '#fff' : tPri, height: 26 }}>
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
