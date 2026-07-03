import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, Activity, Gauge as GaugeIcon, Zap, TrendingUp, TrendingDown, FileSpreadsheet, Waves } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { StatTile, useCountUp } from '@/components/dazzle';

/* ─────────────────────────────────────────────────────────────────────────────
 *  LIVE WEEK FORECAST — "الهيدكاونت المتوقّع بالساعة الحيّ"
 *  Blends reconciled reality (past days) with the schedule plan − approved
 *  requests (future days) into ONE 7×24 headcount picture that fills hour by
 *  hour as the week runs. Three fused views:
 *    1. Staffing River   — a continuous 168-hour flow; solid = lived, hatched = plan,
 *                          split by the bright NOW seam, red pockets under the baseline.
 *    2. Seam Heatmap     — a 7×24 grid, actual rows saturated / plan rows ghosted,
 *                          a glowing divider where reality hands off to plan; hover a
 *                          cell for the full cascade ledger.
 *    3. Realization Dials — one gauge per day: coverage vs required + realized fraction.
 *  Data: GET /attendance-recon/roster-v2/week-forecast (see recon.controller).
 * ───────────────────────────────────────────────────────────────────────────── */

type Cell = { hour: number; mode: string; hc: number; actual: number | null; plan: number; planAfterReq: number; required: number; gap: number; coveragePct: number | null; detail: any };
type Day = { date: string; dayName: string; mode: string; hours: Cell[]; totalHc: number; totalRequired: number; coveragePct: number | null; peakHour: number; peakHc: number; gapHours: number };
type Forecast = { weekStart: string; weekEnd: string; frontier: string; function: string | null; days: Day[]; byHour: any[]; baseline: number[]; summary: any };

const covColor = (v: number | null) => v == null ? '#64748b' : v >= 110 ? '#14b8a6' : v >= 90 ? '#22c55e' : v >= 75 ? '#f59e0b' : '#ef4444';
const hh2 = (n: number) => `${String(n).padStart(2, '0')}`;
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default function ForecastWeekPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const [weekStart, setWeekStart] = useState('');
  const [fn, setFn] = useState('');
  const [d, setD] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [fnList, setFnList] = useState<string[]>([]);
  const [hover, setHover] = useState<{ di: number; hi: number } | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (weekStart) qs.set('weekStart', weekStart);
    if (fn) qs.set('function', fn);
    apiClient.get(`/attendance-recon/roster-v2/week-forecast?${qs}`)
      .then((r: any) => { setD(r.data); if (!weekStart && r.data?.weekStart) setWeekStart(r.data.weekStart); })
      .catch(() => setD(null)).finally(() => setLoading(false));
  }, [weekStart, fn]);
  useEffect(() => { const t = setTimeout(load, 150); return () => clearTimeout(t); }, [load]);
  // function list (once)
  useEffect(() => { apiClient.get('/attendance-recon/roster-v2/hourly').then((r: any) => setFnList(r.data?.functions || [])).catch(() => {}); }, []);

  const panel = { background: 'var(--surface)', border: '1px solid var(--border)' } as React.CSSProperties;
  const s = d?.summary;

  // ── flatten to a 168-hour series for the river ──
  const series = useMemo(() => {
    if (!d) return [];
    const out: { i: number; di: number; hi: number; hc: number; req: number; mode: string }[] = [];
    d.days.forEach((day, di) => day.hours.forEach((c, hi) => out.push({ i: di * 24 + hi, di, hi, hc: c.hc, req: c.required, mode: c.mode })));
    return out;
  }, [d]);
  const seamIdx = (s?.actualDays ?? 0) * 24;             // first plan-hour index (reality→plan handoff)
  const maxY = useMemo(() => Math.max(10, ...series.map(p => Math.max(p.hc, p.req))), [series]);

  const exportXlsx = async () => {
    if (exporting || !d) return; setExporting(true);
    try {
      // reuse the hourly xlsx export for the same window (per-function sheets)
      const qs = new URLSearchParams({ from: d.weekStart, to: d.weekEnd, format: 'xlsx' }); if (fn) qs.set('function', fn);
      const r: any = await apiClient.get(`/attendance-recon/roster-v2/hourly?${qs}`, { responseType: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = `week-forecast_${d.weekStart}.xlsx`; a.click();
    } finally { setExporting(false); }
  };

  return (
    <div className="space-y-4 page-enter">
      {/* ── header ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#0ea5e9,#6366f1)', boxShadow: '0 6px 18px rgba(14,165,233,0.35)' }}><Waves size={20} className="text-white" /></div>
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'توقّع الأسبوع الحيّ' : 'Live Week Forecast'}</h1>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>{ar ? 'الهيدكاونت بالساعة — الماضي فعلي، والقادم خطة ناقص الريكويستات، ويتعبّى أول بأول' : 'hourly headcount — past is actual, future is plan minus approved requests, filling as the week runs'}</p>
        </div>
        {/* week stepper */}
        <div className="flex items-center gap-1 rounded-xl px-1 py-1" style={panel}>
          <button onClick={() => setWeekStart(w => addDays(w || d?.weekStart || '', -7))} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5" style={{ color: 'var(--text-2)' }}>{ar ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
          <span className="flex items-center gap-1.5 px-2 text-xs font-semibold" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}><CalendarRange size={13} style={{ color: '#818cf8' }} />{d ? `${d.weekStart.slice(5)} → ${d.weekEnd.slice(5)}` : '—'}</span>
          <button onClick={() => setWeekStart(w => addDays(w || d?.weekStart || '', 7))} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5" style={{ color: 'var(--text-2)' }}>{ar ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</button>
        </div>
        <select value={fn} onChange={e => setFn(e.target.value)} className="px-2.5 py-2 rounded-lg text-xs outline-none" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>
          <option value="">{ar ? 'كل الفنكشن' : 'All functions'}</option>{fnList.map(x => <option key={x} value={x}>{x}</option>)}</select>
        <button onClick={exportXlsx} disabled={exporting} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}><FileSpreadsheet size={13} />{exporting ? '…' : (ar ? 'Excel' : 'Excel')}</button>
      </div>

      {loading && <p className="text-sm py-10 text-center" style={{ color: 'var(--text-3)' }}>{ar ? 'جارٍ حساب التوقّع…' : 'Computing forecast…'}</p>}
      {!loading && d && s && (<>
        {/* ── hero tiles ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <StatTile icon={GaugeIcon} label={ar ? 'تغطية الأسبوع' : 'Week coverage'} num={s.coveragePct ?? 0} suffix="%" sub={ar ? 'مقابل الخط المرجعي' : 'vs baseline'} color={covColor(s.coveragePct)} delay={0} trend={d.byHour.map((h: any) => h.coveragePct ?? 0)} />
          <StatTile icon={Activity} label={ar ? 'تحقّق الأسبوع' : 'Realization'} num={s.realizationPct} suffix="%" sub={ar ? `${s.actualDays} فعلي · ${s.planDays} خطة` : `${s.actualDays} actual · ${s.planDays} plan`} color="#0ea5e9" delay={60} />
          <StatTile icon={CalendarRange} label={ar ? 'هيدكاونت متوقّع' : 'Projected HC·h'} num={s.weekHc} sub={ar ? `فعلي ${s.actualHc} · خطة ${s.planHc}` : `actual ${s.actualHc} · plan ${s.planHc}`} color="#8b5cf6" delay={120} />
          <StatTile icon={TrendingDown} label={ar ? 'ساعات نقص' : 'Gap hours'} num={s.gapHours} sub={ar ? 'تحت المرجعي' : 'under baseline'} color={s.gapHours ? '#ef4444' : '#64748b'} delay={180} />
          <StatTile icon={Zap} label={ar ? 'رفع الأوفرتايم' : 'OT lift'} num={s.otLiftHc} suffix={ar ? ' HC·س' : ' HC·h'} sub={ar ? 'ساعات أضافها OT' : 'HC-hours added by OT'} color="#a78bfa" delay={240} />
          <StatTile icon={TrendingUp} label={ar ? 'هيدكاونت ضائع' : 'Lost HC·h'} num={s.lostHc} sub={ar ? 'تأخير/خروج/إذن/غياب' : 'late/early/perm/leave'} color="#f43f5e" delay={300} />
        </div>

        {/* ── STAFFING RIVER ── */}
        <StaffingRiver series={series} seamIdx={seamIdx} maxY={maxY} days={d.days} frontier={d.frontier} ar={ar} panel={panel} />

        {/* ── SEAM HEATMAP + cascade ledger ── */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px] gap-4">
          <SeamHeatmap d={d} hover={hover} setHover={setHover} ar={ar} panel={panel} />
          <CascadeLedger d={d} hover={hover} ar={ar} panel={panel} />
        </div>

        {/* ── REALIZATION DIALS ── */}
        <div className="rounded-2xl p-4" style={panel}>
          <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-1)' }}>{ar ? 'تحقّق كل يوم' : 'Per-day realization'} <span className="text-[11px] font-normal" style={{ color: 'var(--text-3)' }}>· {ar ? 'تغطية مقابل المرجعي — صلب = فعلي، متقطّع = خطة' : 'coverage vs baseline — solid = actual, dashed = plan'}</span></h3>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {d.days.map((day, i) => <DayDial key={day.date} day={day} ar={ar} delay={i * 70} />)}
          </div>
        </div>

        <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
          {ar
            ? '★ الخط المرجعي = متوسط الهيدكاونت المجدول بالساعة على آخر ٢٨ يوم (نمط ملاحَظ، ليس Erlang). أيام الخطة تعكس الجدول المنشور كاملاً؛ إذا كان الفعلي المصالَح للفترة رقيقاً (بيانات ناقصة) قد تبدو نِسب الخطة مرتفعة — تتطابق عند مصالحة الفترة من Sprinklr.'
            : '★ Baseline = avg scheduled HC per hour over the trailing 28 days (observed pattern, not Erlang). Plan days reflect the full published schedule; if the reconciled actuals for the period are thin, plan coverage can read high — it converges once the period reconciles from Sprinklr.'}
        </p>
      </>)}
    </div>
  );
}

/* ══ 1. STAFFING RIVER ══════════════════════════════════════════════════════ */
function StaffingRiver({ series, seamIdx, maxY, days, frontier, ar, panel }: any) {
  const W = 1000, H = 200, padB = 22, padT = 8;
  const x = (i: number) => (i / (168 - 1)) * W;
  const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);
  const seamX = seamIdx > 0 && seamIdx < 168 ? x(seamIdx) : null;

  // hc area path over all 168 points
  const line = series.map((p: any, k: number) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.hc).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H - padB} L0,${H - padB} Z`;
  // baseline (required) path
  const base = series.map((p: any, k: number) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.req).toFixed(1)}`).join(' ');
  // red "missing water" pockets: segments where hc < req → area between hc and req
  const pockets: string[] = [];
  let seg: any[] = [];
  const flush = () => { if (seg.length > 1) { const up = seg.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.req).toFixed(1)}`).join(' '); const dn = [...seg].reverse().map(p => `L${x(p.i).toFixed(1)},${y(p.hc).toFixed(1)}`).join(' '); pockets.push(`${up} ${dn} Z`); } seg = []; };
  for (const p of series) { if (p.req >= 1 && p.hc < p.req) seg.push(p); else flush(); }
  flush();

  return (
    <div className="rounded-2xl p-4" style={panel}>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}><Waves size={15} style={{ color: '#0ea5e9' }} />{ar ? 'نهر الهيدكاونت — الأسبوع كاملاً بالساعة' : 'Staffing river — the whole week, hour by hour'}</h3>
        <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--text-3)' }}>
          <span><span className="inline-block w-3 h-2 rounded-sm align-middle me-1" style={{ background: 'linear-gradient(180deg,#0ea5e9,#6366f1)' }} />{ar ? 'فعلي' : 'actual'}</span>
          <span><span className="inline-block w-3 h-2 rounded-sm align-middle me-1" style={{ background: 'repeating-linear-gradient(45deg,#6366f1,#6366f1 2px,transparent 2px,transparent 4px)' }} />{ar ? 'خطة' : 'plan'}</span>
          <span><span className="inline-block w-3 h-0.5 align-middle me-1" style={{ background: '#94a3b8', borderTop: '1px dashed #94a3b8' }} />{ar ? 'المرجعي' : 'baseline'}</span>
          <span><span className="inline-block w-3 h-2 rounded-sm align-middle me-1" style={{ background: 'rgba(239,68,68,0.5)' }} />{ar ? 'نقص' : 'gap'}</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 200, overflow: 'visible' }}>
        <defs>
          <linearGradient id="riverActual" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.85" /><stop offset="100%" stopColor="#6366f1" stopOpacity="0.25" /></linearGradient>
          <pattern id="riverPlan" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#6366f1" opacity="0.06" /><line x1="0" y1="0" x2="0" y2="6" stroke="#818cf8" strokeWidth="1.4" opacity="0.5" /></pattern>
          <clipPath id="clipL"><rect x="0" y="0" width={seamX ?? W} height={H} /></clipPath>
          <clipPath id="clipR"><rect x={seamX ?? W} y="0" width={W - (seamX ?? W)} height={H} /></clipPath>
        </defs>
        {/* actual water (left of seam) */}
        <path d={area} fill="url(#riverActual)" clipPath="url(#clipL)" />
        {/* plan water (hatched, right of seam) */}
        {seamX != null && <path d={area} fill="url(#riverPlan)" clipPath="url(#clipR)" />}
        {/* hc silhouette line */}
        <path d={line} fill="none" stroke="#0ea5e9" strokeWidth="1.6" opacity="0.9" clipPath="url(#clipL)" />
        {seamX != null && <path d={line} fill="none" stroke="#818cf8" strokeWidth="1.6" strokeDasharray="4 3" opacity="0.9" clipPath="url(#clipR)" />}
        {/* red missing-water pockets */}
        {pockets.map((p, k) => <path key={k} d={p} fill="rgba(239,68,68,0.5)" />)}
        {/* baseline reference */}
        <path d={base} fill="none" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" opacity="0.75" />
        {/* day separators + labels */}
        {days.map((day: any, di: number) => (
          <g key={day.date}>
            {di > 0 && <line x1={x(di * 24)} y1={padT} x2={x(di * 24)} y2={H - padB} stroke="var(--border)" strokeWidth="0.6" opacity="0.5" />}
            <text x={x(di * 24 + 12)} y={H - 6} textAnchor="middle" style={{ fontSize: 9, fill: 'var(--text-3)' }}>{day.dayName.slice(0, 3)} {day.date.slice(8)}</text>
          </g>
        ))}
        {/* NOW seam */}
        {seamX != null && <>
          <line x1={seamX} y1={0} x2={seamX} y2={H - padB} stroke="#22d3ee" strokeWidth="2" style={{ filter: 'drop-shadow(0 0 5px #22d3ee)' }} />
          <circle cx={seamX} cy={padT + 2} r="3.5" fill="#22d3ee" style={{ filter: 'drop-shadow(0 0 4px #22d3ee)' }} />
          <text x={seamX + 5} y={padT + 5} style={{ fontSize: 9, fontWeight: 700, fill: '#22d3ee' }}>{ar ? 'الآن' : 'NOW'}</text>
        </>}
      </svg>
    </div>
  );
}

/* ══ 2. SEAM HEATMAP ════════════════════════════════════════════════════════ */
function SeamHeatmap({ d, hover, setHover, ar, panel }: any) {
  const cellColor = (c: Cell) => {
    if (c.required < 1 && c.hc === 0) return 'transparent';
    const v = c.coveragePct;
    const col = covColor(v);
    return col;
  };
  const actualDays = d.summary.actualDays;
  return (
    <div className="rounded-2xl p-4 overflow-auto" style={panel}>
      <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-1)' }}>{ar ? 'خريطة الأسبوع الحرارية — يوم × ساعة' : 'Week heatmap — day × hour'} <span className="text-[11px] font-normal" style={{ color: 'var(--text-3)' }}>· {ar ? 'صلب = فعلي · شبح = خطة · اللون = التغطية' : 'solid = actual · ghost = plan · color = coverage'}</span></h3>
      <div className="min-w-[640px]">
        {/* hour axis */}
        <div className="grid" style={{ gridTemplateColumns: '42px repeat(24,1fr)' }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => <div key={h} className="text-center text-[8px]" style={{ color: 'var(--text-3)' }}>{h % 2 === 0 ? hh2(h) : ''}</div>)}
        </div>
        {d.days.map((day: Day, di: number) => (
          <div key={day.date}>
            {di === actualDays && actualDays > 0 && actualDays < 7 && (
              <div className="relative h-0">
                <div className="absolute inset-x-0 -top-px h-0.5" style={{ background: '#22d3ee', boxShadow: '0 0 6px #22d3ee', zIndex: 5 }} />
                <span className="absolute -top-2 text-[8px] font-bold px-1 rounded" style={{ left: 44, background: '#22d3ee', color: '#082f49' }}>{ar ? 'الآن' : 'NOW'}</span>
              </div>
            )}
            <div className="grid items-center" style={{ gridTemplateColumns: '42px repeat(24,1fr)' }}>
              <div className="text-[10px] font-semibold pe-1 text-end whitespace-nowrap flex items-center justify-end gap-1" style={{ color: 'var(--text-2)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: day.mode === 'actual' ? '#22c55e' : '#818cf8' }} />{day.dayName.slice(0, 3)}
              </div>
              {day.hours.map((c, hi) => {
                const col = cellColor(c);
                const on = hover && hover.di === di && hover.hi === hi;
                const isPlan = c.mode === 'plan';
                const intensity = c.hc === 0 ? 0 : Math.min(1, 0.28 + (c.coveragePct != null ? Math.min(c.coveragePct, 140) / 140 : 0.5) * 0.72);
                return (
                  <div key={hi} onMouseEnter={() => setHover({ di, hi })} onMouseLeave={() => setHover(null)}
                    title={`${day.dayName} ${hh2(c.hour)}:00 · ${ar ? 'هيدكاونت' : 'HC'} ${c.hc}${c.required >= 1 ? ` / ${ar ? 'مرجعي' : 'req'} ${c.required}` : ''}${c.coveragePct != null ? ` · ${c.coveragePct}%` : ''}`}
                    style={{
                      height: 20, margin: 1, borderRadius: 3,
                      background: col === 'transparent' ? 'var(--surface-2)' : col,
                      opacity: col === 'transparent' ? 0.4 : (isPlan ? intensity * 0.6 : intensity),
                      border: isPlan ? `1px dashed ${col === 'transparent' ? 'var(--border)' : col}` : '1px solid transparent',
                      outline: on ? '2px solid var(--text-1)' : 'none', outlineOffset: -1,
                      display: 'grid', placeItems: 'center', cursor: 'pointer', transition: 'transform .1s',
                      transform: on ? 'scale(1.35)' : 'none', zIndex: on ? 3 : 1, position: 'relative',
                    }}>
                    <span style={{ fontSize: 7, fontWeight: 700, color: intensity > 0.6 && !isPlan ? '#fff' : 'var(--text-2)' }}>{c.hc >= 1 ? c.hc : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {/* color legend */}
        <div className="flex items-center gap-3 text-[9px] mt-2" style={{ color: 'var(--text-3)' }}>
          {[['<75%', '#ef4444'], ['75-90', '#f59e0b'], ['90-110', '#22c55e'], ['>110', '#14b8a6']].map(([l, c]) => (
            <span key={l as string}><span className="inline-block w-2.5 h-2.5 rounded-sm align-middle me-1" style={{ background: c as string }} />{l}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══ CASCADE LEDGER (hover drill) ═══════════════════════════════════════════ */
function CascadeLedger({ d, hover, ar, panel }: any) {
  const cell: Cell | null = hover ? d.days[hover.di]?.hours[hover.hi] : null;
  const day: Day | null = hover ? d.days[hover.di] : null;
  const Row = ({ label, val, color, bold }: any) => (
    <div className="flex items-center justify-between py-1" style={{ borderBottom: '1px solid var(--border)' }}>
      <span className="text-[11px]" style={{ color: bold ? 'var(--text-1)' : 'var(--text-3)', fontWeight: bold ? 700 : 500 }}>{label}</span>
      <span className="text-[12px] font-bold tabular-nums" style={{ color: color || 'var(--text-1)' }}>{val}</span>
    </div>
  );
  return (
    <div className="rounded-2xl p-4" style={{ ...panel, position: 'sticky', top: 8, alignSelf: 'start' }}>
      <h3 className="text-sm font-bold mb-2 flex items-center gap-2" style={{ color: 'var(--text-1)' }}><Activity size={14} style={{ color: '#818cf8' }} />{ar ? 'دفتر الساعة' : 'Cascade ledger'}</h3>
      {!cell && <p className="text-[11px] py-6 text-center" style={{ color: 'var(--text-3)' }}>{ar ? 'مرّر على أي خلية لتفكيك ساعتها' : 'Hover a cell to decompose its hour'}</p>}
      {cell && day && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold" style={{ background: cell.mode === 'actual' ? 'rgba(34,197,94,0.15)' : 'rgba(129,140,248,0.15)', color: cell.mode === 'actual' ? '#22c55e' : '#818cf8' }}>{cell.mode === 'actual' ? (ar ? 'فعلي' : 'ACTUAL') : (ar ? 'خطة' : 'PLAN')}</span>
            <span className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>{day.dayName.slice(0, 3)} {day.date.slice(5)} · {hh2(cell.hour)}:00</span>
          </div>
          {cell.mode === 'actual' && cell.detail && (<>
            <Row label={ar ? 'مداوم' : 'Working'} val={cell.detail.working} />
            <Row label={ar ? '+ OT قبل' : '+ OT before'} val={cell.detail.otBefore ? `+${cell.detail.otBefore}` : '0'} color="#a78bfa" />
            <Row label={ar ? '+ OT بعد' : '+ OT after'} val={cell.detail.otAfter ? `+${cell.detail.otAfter}` : '0'} color="#8b5cf6" />
            <Row label={ar ? '− إذن تأخير' : '− Perm late'} val={cell.detail.permLate ? `−${cell.detail.permLate}` : '0'} color="#0ea5e9" />
            <Row label={ar ? '− إذن مبكر' : '− Perm early'} val={cell.detail.permEarly ? `−${cell.detail.permEarly}` : '0'} color="#0ea5e9" />
            <Row label={ar ? '− تأخير' : '− Tardy'} val={cell.detail.tardy ? `−${cell.detail.tardy}` : '0'} color="#fb923c" />
            <Row label={ar ? '− خروج مبكر' : '− Early out'} val={cell.detail.early ? `−${cell.detail.early}` : '0'} color="#f43f5e" />
          </>)}
          {cell.mode === 'plan' && cell.detail && (<>
            <Row label={ar ? 'الخطة (مجدول)' : 'Plan (scheduled)'} val={cell.detail.plan} />
            <Row label={ar ? '− ريكوستات معتمدة' : '− Approved requests'} val={cell.detail.minusReq ? `−${cell.detail.minusReq}` : '0'} color="#f43f5e" />
            <Row label={ar ? '+ أوفرتايم معتمد' : '+ Approved OT'} val={cell.detail.plusOt ? `+${cell.detail.plusOt}` : '0'} color="#a78bfa" />
          </>)}
          <Row label={ar ? '= على المقعد' : '= On seat'} val={cell.hc} bold color="var(--text-1)" />
          <div className="mt-2 pt-1">
            <Row label={ar ? 'الخط المرجعي' : 'Baseline (req)'} val={cell.required} color="#94a3b8" />
            <Row label={ar ? 'الفجوة' : 'Gap'} val={`${cell.gap > 0 ? '+' : ''}${cell.gap}`} color={cell.gap < 0 ? '#ef4444' : '#22c55e'} bold />
            <Row label={ar ? 'التغطية' : 'Coverage'} val={cell.coveragePct != null ? `${cell.coveragePct}%` : '—'} color={covColor(cell.coveragePct)} bold />
          </div>
        </div>
      )}
    </div>
  );
}

/* ══ 3. REALIZATION DIAL ════════════════════════════════════════════════════ */
function DayDial({ day, ar, delay }: { day: Day; ar: boolean; delay: number }) {
  const size = 92, sw = 9, r = (size - sw) / 2, cx = size / 2, cy = size / 2;
  const sweep = 270, start = 135;
  const cov = Math.min(day.coveragePct ?? 0, 150);
  const covPct = useCountUp(day.coveragePct ?? 0, 900, true);
  const col = covColor(day.coveragePct);
  const arc = (frac: number) => {
    const a0 = start, a1 = start + sweep * Math.max(0, Math.min(1, frac));
    const p = (a: number) => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${sweep * frac > 180 ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
  };
  const isActual = day.mode === 'actual';
  return (
    <div className="flex flex-col items-center rounded-xl p-1.5" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', maxWidth: 92 }}>
        <path d={arc(1)} fill="none" stroke="var(--border)" strokeWidth={sw} strokeLinecap="round" opacity="0.5" />
        <path d={arc(cov / 150)} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round" strokeDasharray={isActual ? undefined : '3 4'} style={{ filter: `drop-shadow(0 0 4px ${col}66)` }} />
        <text x={cx} y={cy - 1} textAnchor="middle" style={{ fontSize: 19, fontWeight: 800, fill: 'var(--text-1)' }}>{day.coveragePct != null ? Math.round(covPct) : '—'}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" style={{ fontSize: 8, fill: 'var(--text-3)' }}>%</text>
      </svg>
      <span className="text-[10px] font-bold mt-0.5" style={{ color: 'var(--text-1)' }}>{day.dayName.slice(0, 3)} {day.date.slice(8)}</span>
      <span className="text-[8px] px-1.5 py-0.5 rounded-full mt-0.5" style={{ background: isActual ? 'rgba(34,197,94,0.15)' : 'rgba(129,140,248,0.15)', color: isActual ? '#22c55e' : '#818cf8' }}>{isActual ? (ar ? 'فعلي' : 'actual') : (ar ? 'خطة' : 'plan')}</span>
      <span className="text-[8px] mt-0.5" style={{ color: 'var(--text-3)' }}>{day.totalHc} HC·{ar ? 'س' : 'h'}{day.gapHours ? ` · ${day.gapHours}${ar ? 'ن' : 'g'}` : ''}</span>
    </div>
  );
}
