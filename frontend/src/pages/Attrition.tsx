import { useState, useEffect, useCallback } from 'react';
import { UserMinus, Loader2, RefreshCw, TrendingDown, LogOut, Ban } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

interface Sep { employee_no: string; name: string; function_name: string; code: string; separation_date: string; last_working_day: string | null }
interface Grp { key: string; total: number; voluntary: number; involuntary: number }
interface Report {
  from: string; to: string; months: number;
  summary: { separations: number; voluntary: number; involuntary: number; avgHeadcount: number; attritionRatePeriod: number; attritionRateAnnualized: number; voluntaryRateAnnualized: number };
  byFunction: Grp[]; byMonth: Grp[]; separations: Sep[];
}

export default function AttritionPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

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
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="text-xs rounded-xl px-3 py-1.5 outline-none" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0' }} />
          <span style={{ color: '#475569' }}>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="text-xs rounded-xl px-3 py-1.5 outline-none" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0' }} />
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
            {[
              [ar ? 'إجمالي المغادرين' : 'Separations', data.summary.separations, '#cbd5e1', UserMinus],
              [ar ? 'استقالات (طوعي)' : 'Resignations (vol.)', data.summary.voluntary, '#f59e0b', LogOut],
              [ar ? 'تيرمينيشن (إجباري)' : 'Terminations (invol.)', data.summary.involuntary, '#ef4444', Ban],
            ].map(([l, v, c, Ic], i) => (
              <div key={i} className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-1.5 text-[11px] mb-1" style={{ color: '#94a3b8' }}>{(() => { const I = Ic as any; return <I size={12} />; })()} {l as string}</div>
                <div className="text-3xl font-bold tabular-nums" style={{ color: c as string }}>{v as number}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
            {/* By function */}
            <Panel title={ar ? 'حسب القسم' : 'By function'} dark={dark}>
              {data.byFunction.map(f => (
                <Row key={f.key} a={f.key} vol={f.voluntary} inv={f.involuntary} total={f.total} />
              ))}
            </Panel>
            {/* By month */}
            <Panel title={ar ? 'حسب الشهر' : 'By month'} dark={dark}>
              {[...data.byMonth].sort((a, b) => a.key.localeCompare(b.key)).map(m => (
                <Row key={m.key} a={m.key} vol={m.voluntary} inv={m.involuntary} total={m.total} />
              ))}
            </Panel>
          </div>

          {/* Separations table */}
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="px-4 py-3 text-sm font-bold" style={{ color: tp(dark), borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{ar ? 'قائمة المغادرين' : 'Separations'} ({data.separations.length})</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead><tr style={{ background: 'rgba(0,0,0,0.2)' }}>
                  {[ar ? 'الموظف' : 'Employee', ar ? 'القسم' : 'Function', ar ? 'النوع' : 'Type', ar ? 'تاريخ المغادرة' : 'Separation', ar ? 'آخر يوم عمل' : 'Last working day'].map((h, i) => (
                    <th key={i} className="text-start px-3 py-2 text-[10px] uppercase tracking-wider" style={{ color: '#475569', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.separations.map((s, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td className="px-3 py-1.5" style={{ color: '#cbd5e1' }}>{s.name} <span style={{ color: '#475569' }}>#{s.employee_no}</span></td>
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
        </div>
      )}
    </div>
  );
}

function Panel({ title, dark, children }: { title: string; dark: boolean; children: any }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="px-4 py-2.5 text-xs font-bold" style={{ color: tp(dark), borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{title}</div>
      <div className="px-2 py-1">{children}</div>
    </div>
  );
}
function Row({ a, vol, inv, total }: { a: string; vol: number; inv: number; total: number }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-[11px]" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
      <span className="flex-1 min-w-0 truncate" style={{ color: '#cbd5e1' }}>{a}</span>
      {vol > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }}>{vol} {'استقالة'}</span>}
      {inv > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>{inv} TER</span>}
      <span className="tabular-nums font-bold" style={{ color: '#f87171' }}>{total}</span>
    </div>
  );
}
