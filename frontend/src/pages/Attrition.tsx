import { useState, useEffect, useCallback } from 'react';
import { UserMinus, Loader2, RefreshCw, TrendingDown, LogOut, Ban, ArrowLeftRight } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';
import { StatTile, Donut, BarRow } from '@/components/dazzle';

interface Sep { employee_no: string; name: string; function_name: string; code: string; separation_date: string; last_working_day: string | null }
interface Transfer { employee_no: string; name: string; transfer_date: string; from_function: string }
interface Grp { key: string; total: number; voluntary: number; involuntary: number }
interface Report {
  from: string; to: string; months: number;
  summary: { separations: number; voluntary: number; involuntary: number; avgHeadcount: number; attritionRatePeriod: number; attritionRateAnnualized: number; voluntaryRateAnnualized: number; internalTransfers: number };
  byFunction: Grp[]; byMonth: Grp[]; separations: Sep[]; transfers: Transfer[];
}

/* theme-aware neutral tokens — dark keeps the original explicit values; light mirrors them
   with a slate-navy tint. Semantic/brand (status colors) + mid-gray muted text
   (#94a3b8 / #64748b / #475569) stay inline as they read on both themes. Shared by the page
   and the Panel component so residual literals live in this one documented block. */
const nt = (dark: boolean) => ({
  cardBg:  dark ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.02)',
  fieldBg: dark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)',
  bdr:     dark ? 'rgba(255,255,255,0.1)'  : 'rgba(15,23,42,0.12)',
  bdrSoft: dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)',
  bdrRow:  dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.06)',
  headBg:  dark ? 'rgba(0,0,0,0.2)'        : 'rgba(15,23,42,0.05)',
  headBg2: dark ? 'rgba(0,0,0,0.15)'       : 'rgba(15,23,42,0.04)',
  text:    tp(dark),
  text2:   dark ? '#cbd5e1' : '#334155',
});

export default function AttritionPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();
  const T = nt(dark);

  const [data, setData] = useState<Report | null>(null);
  const [loading, setL] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setL(true);
    try {
      const { data } = await apiClient.get<Report>('/attrition', { params: { ...(from ? { from } : {}), ...(to ? { to } : {}) } });
      setData(data); if (!from && data?.from) setFrom(data.from); if (!to && data?.to) setTo(data.to);
    } catch { setData(null); }
    setL(false);
  }, [from, to]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const rateColor = (r: number) => r >= 35 ? '#ef4444' : r >= 20 ? '#f59e0b' : '#22c55e';
  const maxFn = Math.max(1, ...(data?.byFunction?.map(f => f.total) ?? []));
  const maxMonth = Math.max(1, ...(data?.byMonth?.map(m => m.total) ?? []));
  // monthly trends (chronological) to draw inside the count tiles
  const monthsSorted = [...(data?.byMonth ?? [])].sort((a, b) => a.key.localeCompare(b.key));
  const trendTotal = monthsSorted.map(m => m.total);
  const trendVol = monthsSorted.map(m => m.voluntary);
  const trendInv = monthsSorted.map(m => m.involuntary);

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.22)' }}>
            <UserMinus size={18} style={{ color: '#ef4444' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'معدّل التسرّب الوظيفي' : 'Attrition Rate'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'من ماركرز الجدول — RES استقالة · TER تيرمينيشن (آخر يوم عمل = اليوم اللي قبله)' : 'From schedule markers — RES resignation · TER termination (last working day = day before)'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="text-xs rounded-xl px-3 py-1.5 outline-none" style={{ background: T.fieldBg, border: `1px solid ${T.bdr}`, color: T.text }} />
          <span style={{ color: '#475569' }}>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="text-xs rounded-xl px-3 py-1.5 outline-none" style={{ background: T.fieldBg, border: `1px solid ${T.bdr}`, color: T.text }} />
          <button onClick={load} disabled={loading} className="flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{ar ? 'حساب' : 'Compute'}</button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : !data ? (
        <div className="text-center py-20" style={{ color: '#475569' }}><UserMinus size={32} className="mx-auto mb-3" style={{ color: '#334155' }} /><p className="text-sm">{ar ? 'لا توجد بيانات' : 'No data'}</p></div>
      ) : (
        <div className="space-y-5">
          <p className="text-[11px]" style={{ color: '#64748b' }}>{data.from} → {data.to} · {data.months} {ar ? 'أشهر' : 'months'} · {ar ? 'متوسط الهيدكاونت' : 'avg HC'} {data.summary.avgHeadcount}</p>

          {/* Headline rate cards */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
            <div className="rounded-2xl p-4" style={{ background: `${rateColor(data.summary.attritionRateAnnualized)}12`, border: `1px solid ${rateColor(data.summary.attritionRateAnnualized)}33` }}>
              <div className="flex items-center gap-1.5 text-[11px] mb-1" style={{ color: '#94a3b8' }}><TrendingDown size={12} /> {ar ? 'التسرّب السنوي' : 'Annualized attrition'}</div>
              <div className="text-3xl font-bold tabular-nums" style={{ color: rateColor(data.summary.attritionRateAnnualized) }}>{data.summary.attritionRateAnnualized}%</div>
              <div className="text-[10px] mt-0.5" style={{ color: '#64748b' }}>{data.summary.attritionRatePeriod}% {ar ? 'خلال الفترة' : 'in period'}</div>
            </div>
            {([
              [ar ? 'إجمالي المغادرين' : 'Separations', data.summary.separations, '#cbd5e1', UserMinus],
              [ar ? 'استقالات (طوعي)' : 'Resignations (vol.)', data.summary.voluntary, '#f59e0b', LogOut],
              [ar ? 'تيرمينيشن (إجباري)' : 'Terminations (invol.)', data.summary.involuntary, '#ef4444', Ban],
              [ar ? 'انتقال داخلي (مش تسرّب)' : 'Internal transfers (not attrition)', data.summary.internalTransfers ?? 0, '#22d3ee', ArrowLeftRight],
            ] as [string, number, string, any][]).map(([l, v, c, Ic], i) => (
              <StatTile key={i} icon={Ic} label={l} num={v} color={c} delay={i * 60}
                trend={[trendTotal, trendVol, trendInv, undefined][i]} />
            ))}
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
            {/* Composition donut: voluntary vs involuntary */}
            <Panel title={ar ? 'تركيبة المغادرة' : 'Separation mix'} dark={dark}>
              <div className="p-3">
                <Donut
                  segments={[
                    { label: ar ? 'استقالة (طوعي)' : 'Resignation (vol.)', value: data.summary.voluntary, color: '#f59e0b' },
                    { label: ar ? 'تيرمينيشن (إجباري)' : 'Termination (invol.)', value: data.summary.involuntary, color: '#ef4444' },
                  ]}
                  centerNum={data.summary.separations} centerLabel={ar ? 'مغادر' : 'left'} />
              </div>
            </Panel>
            {/* By function — magnitude bars (which department bleeds most) */}
            <Panel title={ar ? 'حسب القسم' : 'By function'} dark={dark}>
              <div className="px-2 py-2 space-y-2">
                {[...data.byFunction].sort((a, b) => b.total - a.total).map((f, i) => (
                  <BarRow key={f.key} label={f.key} value={f.total} max={maxFn} color="#ef4444" delay={i * 40} />
                ))}
              </div>
            </Panel>
            {/* By month — seasonal attrition curve */}
            <Panel title={ar ? 'حسب الشهر' : 'By month'} dark={dark}>
              <div className="px-2 py-2 space-y-2">
                {[...data.byMonth].sort((a, b) => a.key.localeCompare(b.key)).map((m, i) => (
                  <BarRow key={m.key} label={m.key} value={m.total} max={maxMonth} color="#f59e0b" delay={i * 40} />
                ))}
              </div>
            </Panel>
          </div>

          {/* Separations table */}
          <div className="rounded-2xl overflow-hidden" style={{ background: T.cardBg, border: `1px solid ${T.bdrSoft}` }}>
            <div className="px-4 py-3 text-sm font-bold" style={{ color: T.text, borderBottom: `1px solid ${T.bdrSoft}` }}>{ar ? 'قائمة المغادرين' : 'Separations'} ({data.separations.length})</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead><tr style={{ background: T.headBg }}>
                  {[ar ? 'الموظف' : 'Employee', ar ? 'القسم' : 'Function', ar ? 'النوع' : 'Type', ar ? 'تاريخ المغادرة' : 'Separation', ar ? 'آخر يوم عمل' : 'Last working day'].map((h, i) => (
                    <th key={i} className="text-start px-3 py-2 text-[10px] uppercase tracking-wider" style={{ color: '#475569', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.separations.map((s, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${T.bdrRow}` }}>
                      <td className="px-3 py-1.5" style={{ color: T.text2 }}>{s.name} <span style={{ color: '#475569' }}>#{s.employee_no}</span></td>
                      <td className="px-3 py-1.5" style={{ color: '#94a3b8' }}>{s.function_name}</td>
                      <td className="px-3 py-1.5">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: s.code === 'RES' ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)', color: s.code === 'RES' ? '#fbbf24' : '#f87171' }}>
                          {s.code === 'RES' ? (ar ? 'استقالة' : 'Resigned') : (ar ? 'تيرمينيشن' : 'Terminated')}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 tabular-nums" style={{ color: '#94a3b8' }}>{s.separation_date}</td>
                      <td className="px-3 py-1.5 tabular-nums font-semibold" style={{ color: '#67e8f9' }}>{s.last_working_day ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Internal transfers — NOT attrition (moved to another department) */}
          {data.transfers && data.transfers.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(34,211,238,0.04)', border: '1px solid rgba(34,211,238,0.2)' }}>
              <div className="px-4 py-3 text-sm font-bold flex items-center gap-2" style={{ color: tp(dark), borderBottom: '1px solid rgba(34,211,238,0.15)' }}>
                <ArrowLeftRight size={15} style={{ color: '#22d3ee' }} />
                {ar ? 'انتقالات داخلية — ليست تسرّباً' : 'Internal transfers — not attrition'} ({data.transfers.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead><tr style={{ background: T.headBg2 }}>
                    {[ar ? 'الموظف' : 'Employee', ar ? 'القسم السابق' : 'From department', ar ? 'تاريخ الانتقال' : 'Transfer date'].map((h, i) => (
                      <th key={i} className="text-start px-3 py-2 text-[10px] uppercase tracking-wider" style={{ color: '#475569', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {data.transfers.map((t, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${T.bdrRow}` }}>
                        <td className="px-3 py-1.5" style={{ color: T.text2 }}>{t.name} <span style={{ color: '#475569' }}>#{t.employee_no}</span></td>
                        <td className="px-3 py-1.5" style={{ color: '#94a3b8' }}>{t.from_function}</td>
                        <td className="px-3 py-1.5 tabular-nums" style={{ color: '#67e8f9' }}>{t.transfer_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Panel({ title, dark, children }: { title: string; dark: boolean; children: any }) {
  const T = nt(dark);
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: T.cardBg, border: `1px solid ${T.bdrSoft}` }}>
      <div className="px-4 py-2.5 text-xs font-bold" style={{ color: T.text, borderBottom: `1px solid ${T.bdrSoft}` }}>{title}</div>
      <div className="px-2 py-1">{children}</div>
    </div>
  );
}
