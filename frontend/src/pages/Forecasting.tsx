import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, Loader2, Target, BarChart3, Activity, Download, Save } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { useInjectDsStyles } from '@/components/ds';
import EmptyState from '@/components/EmptyState';
import { fmtLocalDate } from '@/utils/format';

interface Interval { date: string; hour: number; channel: string; forecast: number; basis: number; requiredHc: number | null; occupancy: number | null; isOverride?: boolean; overrideReason?: string | null }
interface SavedRow { id: string; name: string | null; rangeFrom: string; rangeTo: string; channel: string | null; dataPoints: number; overrides: number; createdAt: string }
interface Daily { date: string; channel: string; total: number; peakRequiredHc: number | null }
interface FEvent { from: string; to: string; label: string; multiplier: number; color: string | null }
interface VolumeResp {
  range: { from: string; to: string };
  historyWindow: { from: string; to: string; weeks: number };
  channels: string[]; ahtSeconds: number | null; dataPoints: number;
  staffing: { targetSL: number; targetSec: number; shrinkage: number } | null;
  events?: FEvent[];
  model: string; intervals: Interval[]; daily: Daily[];
}
interface AccResp {
  range: { from: string; to: string }; dataPoints: number;
  mape: number | null; wape: number | null; bias: number | null; matched: number; totalActual: number;
}

const todayStr = () => fmtLocalDate(new Date());
const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

export default function ForecastingPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [channels, setChannels] = useState<string[]>([]);
  const [channel, setChannel] = useState('');
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(addDays(todayStr(), 6));
  const [weeks, setWeeks] = useState(8);
  const [slPct, setSlPct] = useState(80);
  const [shrinkPct, setShrinkPct] = useState(30);
  const [data, setData] = useState<VolumeResp | null>(null);
  const [acc, setAcc] = useState<AccResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [accLoading, setAccLoading] = useState(false);
  const [pickDay, setPickDay] = useState('');
  const [saved, setSaved] = useState<SavedRow[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refreshSaved = useCallback(() => {
    apiClient.get<SavedRow[]>('/forecasting/saved').then(r => setSaved(r.data || [])).catch(() => setSaved([]));
  }, []);

  useEffect(() => {
    apiClient.get<string[]>('/forecasting/channels')
      .then(r => setChannels(r.data || [])).catch(() => setChannels([]));
    refreshSaved();
  }, [refreshSaved]);

  // Adapt a saved-forecast payload into the live display shape (effective = override ?? model).
  const adaptSaved = (s: any): VolumeResp => {
    const intervals: Interval[] = (s.intervals || []).map((i: any) => ({
      date: i.date, hour: i.hour, channel: i.channel,
      forecast: i.override != null ? Number(i.override) : Number(i.forecast),
      basis: 0, requiredHc: i.requiredHc, occupancy: null,
      isOverride: i.override != null, overrideReason: i.overrideReason,
    }));
    const dmap = new Map<string, number>(), peak = new Map<string, number>();
    intervals.forEach(i => {
      dmap.set(i.date, (dmap.get(i.date) ?? 0) + i.forecast);
      if (i.requiredHc != null) peak.set(i.date, Math.max(peak.get(i.date) ?? 0, i.requiredHc));
    });
    return {
      range: { from: s.rangeFrom, to: s.rangeTo },
      historyWindow: { from: '', to: '', weeks: s.historyWeeks },
      channels: [...new Set(intervals.map(i => i.channel))].sort(),
      ahtSeconds: s.ahtSeconds, dataPoints: s.dataPoints,
      staffing: s.targetSL != null ? { targetSL: Number(s.targetSL), targetSec: Number(s.targetSec), shrinkage: Number(s.shrinkage) } : null,
      model: s.model,
      intervals,
      daily: [...dmap.entries()].map(([date, total]) => ({
        date, channel: s.channel || 'all', total: Math.round(total * 10) / 10, peakRequiredHc: peak.get(date) ?? null,
      })),
    };
  };

  const saveCurrent = useCallback(async () => {
    setSaving(true);
    try {
      await apiClient.post('/forecasting/save', {
        from, to, channel: channel || undefined, historyWeeks: weeks, targetSL: slPct / 100, shrinkage: shrinkPct / 100,
      });
      refreshSaved();
    } catch { /* noop */ } finally { setSaving(false); }
  }, [from, to, channel, weeks, slPct, shrinkPct, refreshSaved]);

  const openSaved = useCallback(async (id: string) => {
    setLoading(true); setAcc(null);
    try {
      const { data } = await apiClient.get(`/forecasting/saved/${id}`);
      const adapted = adaptSaved(data);
      setData(adapted); setSavedId(id);
      setPickDay(adapted.daily[0]?.date ?? '');
      if (data.channel) setChannel(data.channel);
    } catch { /* noop */ } finally { setLoading(false); }
  }, []);

  const doOverride = useCallback(async (date: string, hour: number, ch: string, current: number) => {
    if (!savedId) return;
    const raw = window.prompt(ar ? `قيمة جديدة للساعة ${hour}:00 (${ch}) — فارغ للإلغاء:` : `New volume for ${hour}:00 (${ch}) — blank to clear:`, String(current));
    if (raw === null) return;
    const value = raw.trim() === '' ? null : Number(raw);
    if (value !== null && (isNaN(value) || value < 0)) return;
    const reason = value === null ? undefined : (window.prompt(ar ? 'السبب (اختياري):' : 'Reason (optional):', '') || undefined);
    try {
      await apiClient.patch(`/forecasting/saved/${savedId}/override`, { date, hour, channel: ch, value, reason });
      openSaved(savedId);
    } catch { /* noop */ }
  }, [savedId, ar, openSaved]);

  const generate = useCallback(async () => {
    setLoading(true); setAcc(null); setSavedId(null);
    try {
      const { data } = await apiClient.get<VolumeResp>('/forecasting/volume', {
        params: { from, to, channel: channel || undefined, historyWeeks: weeks, targetSL: slPct / 100, shrinkage: shrinkPct / 100 },
      });
      setData(data);
      setPickDay(data.daily[0]?.date ?? '');
    } catch { setData(null); } finally { setLoading(false); }
  }, [from, to, channel, weeks, slPct, shrinkPct]);

  const backtest = useCallback(async () => {
    // Backtest the 7 days immediately before `from` (already actuals).
    setAccLoading(true);
    try {
      const bFrom = addDays(from, -7), bTo = addDays(from, -1);
      const { data } = await apiClient.get<AccResp>('/forecasting/accuracy', {
        params: { from: bFrom, to: bTo, channel: channel || undefined, historyWeeks: weeks },
      });
      setAcc(data);
    } catch { setAcc(null); } finally { setAccLoading(false); }
  }, [from, channel, weeks]);

  const exportXlsx = useCallback(async () => {
    const r = await apiClient.get('/forecasting/export', {
      params: { from, to, channel: channel || undefined, historyWeeks: weeks, targetSL: slPct / 100, shrinkage: shrinkPct / 100 },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(r.data as Blob);
    const a = document.createElement('a');
    a.href = url; a.download = `forecast-${from}_${to}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  }, [from, to, channel, weeks, slPct, shrinkPct]);

  const label = { color: dark ? '#94a3b8' : '#64748b', fontSize: 12, fontWeight: 600 };
  const inp: React.CSSProperties = {
    background: dark ? 'rgba(255,255,255,0.04)' : '#fff',
    border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
    borderRadius: 10, padding: '7px 10px', fontSize: 13, color: dark ? '#e2e8f0' : '#0f172a',
  };

  // Daily totals (sum across channels per day) for the bar row
  const byDay = new Map<string, number>();
  (data?.daily ?? []).forEach(d => byDay.set(d.date, (byDay.get(d.date) ?? 0) + d.total));
  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const maxDay = Math.max(1, ...days.map(d => d[1]));

  // Hour profile for the picked day (sum across channels) — volume + required agents
  const hours = Array.from({ length: 24 }, (_, h) => {
    const cells = (data?.intervals ?? []).filter(i => i.date === pickDay && i.hour === h);
    const v = cells.reduce((s, i) => s + i.forecast, 0);
    const req = cells.reduce((s, i) => s + (i.requiredHc ?? 0), 0);
    const over = cells.some(i => i.isOverride);
    return { h, v, req, over };
  });
  const editable = !!savedId && !!channel; // override needs a single channel to target a cell
  const maxHour = Math.max(1, ...hours.map(h => h.v));
  const maxReq = Math.max(1, ...hours.map(h => h.req));
  const peakReq = data?.daily.find(d => d.date === pickDay)?.peakRequiredHc ?? null;

  return (
    <div className="page-enter space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8' }}>
          <TrendingUp size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">{ar ? 'التنبؤ بالحجم' : 'Volume Forecasting'}</h1>
          <p className="text-xs" style={{ color: '#94a3b8' }}>
            {ar ? 'تنبؤ بحجم التواصل بالساعة والقناة من التاريخ الفعلي (نموذج موسمي مرجّح)'
                : 'Interval volume forecast by hour & channel from real history (seasonal recency-weighted)'}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span style={label}>{ar ? 'القناة' : 'Channel'}</span>
          <select value={channel} onChange={e => setChannel(e.target.value)} style={{ ...inp, minWidth: 150 }}>
            <option value="">{ar ? 'كل القنوات' : 'All channels'}</option>
            {channels.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span style={label}>{ar ? 'من' : 'From'}</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} />
        </div>
        <div className="flex flex-col gap-1">
          <span style={label}>{ar ? 'إلى' : 'To'}</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp} />
        </div>
        <div className="flex flex-col gap-1">
          <span style={label}>{ar ? 'أسابيع التاريخ' : 'History weeks'}</span>
          <input type="number" min={2} max={52} value={weeks} onChange={e => setWeeks(parseInt(e.target.value) || 8)} style={{ ...inp, width: 90 }} />
        </div>
        <div className="flex flex-col gap-1">
          <span style={label}>{ar ? 'هدف SL %' : 'Target SL %'}</span>
          <input type="number" min={50} max={99} value={slPct} onChange={e => setSlPct(parseInt(e.target.value) || 80)} style={{ ...inp, width: 80 }} />
        </div>
        <div className="flex flex-col gap-1">
          <span style={label}>{ar ? 'الهدر %' : 'Shrinkage %'}</span>
          <input type="number" min={0} max={80} value={shrinkPct} onChange={e => setShrinkPct(parseInt(e.target.value) || 30)} style={{ ...inp, width: 80 }} />
        </div>
        <button onClick={generate} disabled={loading} className="btn-primary text-sm">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <BarChart3 size={15} />}
          {ar ? 'توليد التنبؤ' : 'Generate'}
        </button>
        {data && data.dataPoints > 0 && (
          <>
            <button onClick={exportXlsx} className="btn-secondary text-sm">
              <Download size={15} /> {ar ? 'تصدير Excel' : 'Export Excel'}
            </button>
            {!savedId && (
              <button onClick={saveCurrent} disabled={saving} className="btn-secondary text-sm">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {ar ? 'حفظ' : 'Save'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Saved forecasts */}
      {saved.length > 0 && (
        <div className="card p-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider" style={{ color: '#64748b' }}>{ar ? 'محفوظة' : 'Saved'}</span>
          {saved.slice(0, 8).map(s => (
            <button key={s.id} onClick={() => openSaved(s.id)}
              className="text-[11px] px-2.5 py-1 rounded-lg transition-all"
              style={{
                background: savedId === s.id ? 'rgba(99,102,241,0.16)' : (dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'),
                color: savedId === s.id ? '#a5b4fc' : '#94a3b8',
                border: `1px solid ${savedId === s.id ? 'rgba(99,102,241,0.4)' : 'transparent'}`,
              }}>
              {s.rangeFrom.slice(5)}→{s.rangeTo.slice(5)} {s.channel ? `· ${s.channel}` : ''}
              {s.overrides > 0 && <span style={{ color: '#fbbf24' }}> · {s.overrides}✎</span>}
            </button>
          ))}
        </div>
      )}

      {!data ? (
        <EmptyState icon={TrendingUp}
          titleAr="لم يُولَّد تنبؤ بعد" titleEn="No forecast generated yet"
          subAr="اختر القناة والفترة ثم اضغط «توليد التنبؤ»." subEn="Pick a channel and range, then press Generate." />
      ) : data.dataPoints === 0 ? (
        <EmptyState icon={Activity}
          titleAr="لا توجد بيانات تواصل تاريخية" titleEn="No historical contact data"
          subAr={`لا توجد سجلات في ops_contacts للنافذة ${data.historyWindow.from} → ${data.historyWindow.to}. استورد بيانات العمليات أولاً.`}
          subEn={`No ops_contacts rows in the window ${data.historyWindow.from} → ${data.historyWindow.to}. Import operations data first.`} />
      ) : (
        <>
          {/* Meta */}
          <div className="flex flex-wrap gap-2 text-[11px]" style={{ color: '#94a3b8' }}>
            <span className="px-2 py-1 rounded-lg" style={{ background: 'rgba(99,102,241,0.08)', color: '#a5b4fc' }}>{data.model}</span>
            <span className="px-2 py-1 rounded-lg" style={{ background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
              {ar ? 'نافذة التاريخ' : 'history'}: {data.historyWindow.from} → {data.historyWindow.to} ({data.historyWindow.weeks}w)
            </span>
            <span className="px-2 py-1 rounded-lg" style={{ background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
              {data.dataPoints} {ar ? 'نقطة تاريخية' : 'history points'}
            </span>
            {data.ahtSeconds != null && (
              <span className="px-2 py-1 rounded-lg" style={{ background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                {ar ? 'متوسط AHT' : 'avg AHT'}: {Math.round(data.ahtSeconds)}s
              </span>
            )}
            {(data.events ?? []).map((e, i) => (
              <span key={i} className="px-2 py-1 rounded-lg font-medium" title={`${e.from} → ${e.to}`}
                style={{ background: `${e.color || '#f59e0b'}1f`, color: e.color || '#f59e0b' }}>
                🎯 {e.label} ×{e.multiplier.toFixed(2)}
              </span>
            ))}
          </div>

          {/* Daily totals */}
          <div className="card p-4">
            <div className="text-sm font-semibold mb-3 text-slate-700 dark:text-slate-200">{ar ? 'إجمالي الحجم المتوقّع يومياً' : 'Forecast daily volume'}</div>
            <div className="flex items-end gap-2" style={{ height: 140 }}>
              {days.map(([d, v]) => (
                <button key={d} onClick={() => setPickDay(d)}
                  className="flex-1 flex flex-col items-center justify-end gap-1 group" style={{ minWidth: 24 }}>
                  <span className="text-[10px] tnum" style={{ color: '#94a3b8' }}>{Math.round(v)}</span>
                  <div style={{
                    width: '78%', height: `${(v / maxDay) * 100}%`, minHeight: 3, borderRadius: '6px 6px 0 0',
                    background: d === pickDay ? 'linear-gradient(180deg,#6366f1,#7c3aed)' : (dark ? 'rgba(99,102,241,0.35)' : 'rgba(99,102,241,0.45)'),
                    transition: 'all .2s',
                  }} />
                  <span className="text-[9px]" style={{ color: d === pickDay ? '#a5b4fc' : '#64748b' }}>{d.slice(5)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Hour profile for picked day — volume + required agents */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {ar ? 'منحنى الساعة' : 'Hour-of-day curve'} — <span style={{ color: '#a5b4fc' }}>{pickDay}</span>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1" style={{ color: '#22d3ee' }}>● {ar ? 'الحجم' : 'volume'}</span>
                {data.staffing && <span className="flex items-center gap-1" style={{ color: '#818cf8' }}>● {ar ? 'الوكلاء المطلوبون' : 'required agents'}</span>}
                {peakReq != null && (
                  <span className="px-2 py-0.5 rounded-lg font-semibold" style={{ background: 'rgba(99,102,241,0.14)', color: '#a5b4fc' }}>
                    {ar ? 'ذروة' : 'peak'} {peakReq} {ar ? 'وكيل' : 'agents'}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-end gap-[3px]" style={{ height: 120 }}>
              {hours.map(({ h, v, req, over }) => (
                <div key={h}
                  onClick={editable ? () => doOverride(pickDay, h, channel, Math.round(v * 10) / 10) : undefined}
                  className={`flex-1 flex flex-col items-center justify-end gap-[2px] ${editable ? 'cursor-pointer' : ''}`}
                  title={`${hh(h)} — ${Math.round(v * 10) / 10} ${ar ? 'تواصل' : 'contacts'}${data.staffing ? ` · ${req} ${ar ? 'وكيل' : 'agents'}` : ''}${over ? (ar ? ' · معدّل يدوياً' : ' · overridden') : ''}${editable ? (ar ? ' · اضغط للتعديل' : ' · click to override') : ''}`}>
                  {data.staffing && (
                    <div style={{
                      width: '70%', height: `${(req / maxReq) * 34}%`, minHeight: req > 0 ? 2 : 0, borderRadius: '3px 3px 0 0',
                      background: dark ? 'rgba(129,140,248,0.7)' : 'rgba(99,102,241,0.6)',
                    }} />
                  )}
                  <div style={{
                    width: '70%', height: `${(v / maxHour) * 66}%`, minHeight: v > 0 ? 2 : 0, borderRadius: '3px 3px 0 0',
                    background: over ? '#fbbf24' : (dark ? 'rgba(6,182,212,0.5)' : 'rgba(6,182,212,0.55)'),
                  }} />
                  {h % 3 === 0 && <span className="text-[8px] mt-1" style={{ color: '#64748b' }}>{h}</span>}
                </div>
              ))}
            </div>
            {editable && <div className="text-[10px] mt-2" style={{ color: '#94a3b8' }}>{ar ? '✎ اضغط أي ساعة لتعديل الحجم يدوياً (مع تدقيق)' : '✎ Click any hour to override its volume (audited)'}</div>}
          </div>

          {/* Accuracy backtest */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <Target size={15} style={{ color: '#34d399' }} />
                {ar ? 'دقة النموذج (اختبار رجعي على الأسبوع السابق)' : 'Model accuracy (backtest on the prior week)'}
              </div>
              <button onClick={backtest} disabled={accLoading} className="btn-secondary text-xs">
                {accLoading ? <Loader2 size={13} className="animate-spin" /> : <Target size={13} />}
                {ar ? 'اختبار' : 'Run backtest'}
              </button>
            </div>
            {!acc ? (
              <div className="text-xs" style={{ color: '#94a3b8' }}>
                {ar ? 'اضغط «اختبار» لقياس WAPE/MAPE/الانحياز مقابل الفعلي.' : 'Press “Run backtest” to measure WAPE/MAPE/bias vs actuals.'}
              </div>
            ) : acc.matched === 0 ? (
              <div className="text-xs" style={{ color: '#fbbf24' }}>
                {ar ? 'لا توجد بيانات فعلية كافية في الأسبوع السابق للمقارنة.' : 'Not enough actuals in the prior week to compare.'}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { k: 'WAPE', v: acc.wape, hint: ar ? 'الخطأ المرجّح' : 'weighted error', good: (acc.wape ?? 99) < 25 },
                  { k: 'MAPE', v: acc.mape, hint: ar ? 'متوسط الخطأ %' : 'mean abs % err', good: (acc.mape ?? 99) < 30 },
                  { k: ar ? 'الانحياز' : 'Bias', v: acc.bias, hint: ar ? '+ زائد / − ناقص' : '+over / −under', good: Math.abs(acc.bias ?? 99) < 10 },
                ].map(m => (
                  <div key={m.k} className="rounded-xl p-3" style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: '#64748b' }}>{m.k}</div>
                    <div className="text-xl font-bold tnum" style={{ color: m.v == null ? '#64748b' : m.good ? '#34d399' : '#fbbf24' }}>
                      {m.v == null ? '—' : `${m.v}%`}
                    </div>
                    <div className="text-[10px]" style={{ color: '#94a3b8' }}>{m.hint}</div>
                  </div>
                ))}
                <div className="rounded-xl p-3" style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: '#64748b' }}>{ar ? 'فترات مطابَقة' : 'Matched cells'}</div>
                  <div className="text-xl font-bold tnum text-slate-700 dark:text-slate-200">{acc.matched}</div>
                  <div className="text-[10px]" style={{ color: '#94a3b8' }}>{Math.round(acc.totalActual)} {ar ? 'فعلي' : 'actual'}</div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
