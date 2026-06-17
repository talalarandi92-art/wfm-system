import { useState, useEffect, useCallback } from 'react';
import { Award, Loader2, RefreshCw, TrendingUp, TrendingDown, GraduationCap } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';
import { BackToChief } from '@/components/BackToChief';

interface Review {
  week: string | null; empty?: boolean;
  overall?: { count: number; avg: number; max: number; min: number };
  byFunction?: { functionName: string; avg: number; count: number }[];
  byTeamLeader?: { teamLeader: string; avg: number; count: number }[];
  top?: { name: string; fn: string; points: number }[];
  bottom?: { name: string; fn: string; points: number; weakest: string }[];
  belowTarget?: { name: string; fn: string; tl: string; points: number; funcAvg: number; weakest: string }[];
  coachingCandidates?: number;
  trend?: { week_label: string; avg: string }[];
}

export default function ScorecardGuardPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [data, setData] = useState<Review | null>(null);
  const [weeks, setWeeks] = useState<{ week_label: string; n: number }[]>([]);
  const [week, setWeek] = useState('');
  const [loading, setL] = useState(true);

  const load = useCallback(async () => {
    setL(true);
    try {
      const { data } = await apiClient.get<Review>('/scorecard-guard/review', { params: week ? { week } : {} });
      setData(data); if (!week && data?.week) setWeek(data.week);
    } catch { setData(null); }
    setL(false);
  }, [week]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [week]);
  useEffect(() => { apiClient.get('/scorecard-guard/weeks').then(r => setWeeks(r.data || [])).catch(() => {}); }, []);

  const trendMax = data?.trend?.length ? Math.max(...data.trend.map(t => Number(t.avg))) : 1;

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      <BackToChief />
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.22)' }}>
            <Award size={18} style={{ color: '#f59e0b' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'حارس السكور كارد' : 'Scorecard Guard'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'يبني ويراجع الأداء — الترتيب، تحت الهدف، الأضعف، والاتجاه' : 'Builds & reviews performance — ranking, below-target, weakest KPI, trend'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={week} onChange={e => setWeek(e.target.value)} className="text-xs rounded-xl px-3 py-1.5 outline-none" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0' }}>
            {weeks.map(w => <option key={w.week_label} value={w.week_label} style={{ background: '#0f172a' }}>{w.week_label} ({w.n})</option>)}
          </select>
          <button onClick={load} disabled={loading} className="flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', color: '#fcd34d' }}>{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{ar ? 'راجع' : 'Review'}</button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : !data || data.empty ? (
        <div className="text-center py-20" style={{ color: '#475569' }}><Award size={32} className="mx-auto mb-3" style={{ color: '#334155' }} /><p className="text-sm">{ar ? 'لا بيانات سكور كارد لهذا الأسبوع' : 'No scorecard data'}</p></div>
      ) : (
        <div className="space-y-4">
          {/* Overall + trend */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            {[
              [ar ? 'موظف' : 'agents', data.overall!.count, '#cbd5e1'],
              [ar ? 'المتوسّط' : 'avg', data.overall!.avg, '#f59e0b'],
              [ar ? 'الأعلى' : 'max', data.overall!.max, '#22c55e'],
              [ar ? 'تحت الهدف' : 'below', data.coachingCandidates, '#f87171'],
            ].map(([l, v, c], i) => (
              <div key={i} className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-[11px]" style={{ color: '#64748b' }}>{l as string}</p>
                <p className="text-2xl font-bold tabular-nums" style={{ color: c as string }}>{v as number}</p>
              </div>
            ))}
          </div>
          {data.trend && data.trend.length > 1 && (
            <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-xs font-bold mb-2" style={{ color: tp(dark) }}>{ar ? 'اتجاه المتوسّط أسبوعياً' : 'Weekly average trend'}</p>
              <div className="flex items-end gap-3 h-24">
                {data.trend.map(t => (
                  <div key={t.week_label} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full rounded-t" style={{ height: `${(Number(t.avg) / trendMax) * 100}%`, background: 'linear-gradient(180deg,#f59e0b,#d97706)', minHeight: 4 }} />
                    <span className="text-[10px]" style={{ color: '#64748b' }}>{t.week_label}</span>
                    <span className="text-[10px] tabular-nums" style={{ color: '#94a3b8' }}>{Number(t.avg).toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
            {/* Top / bottom */}
            <Panel title={ar ? 'الأفضل أداءً' : 'Top performers'} icon={TrendingUp} color="#22c55e">
              {data.top!.map((p, i) => <Row key={i} a={`${i + 1}. ${p.name}`} b={`${p.fn}`} c={p.points} color="#22c55e" />)}
            </Panel>
            <Panel title={ar ? 'الأضعف أداءً' : 'Bottom performers'} icon={TrendingDown} color="#f87171">
              {data.bottom!.map((p, i) => <Row key={i} a={p.name} b={`${ar ? 'الأضعف' : 'weak'}: ${p.weakest}`} c={p.points} color="#f87171" />)}
            </Panel>
            {/* By function */}
            <Panel title={ar ? 'حسب القسم' : 'By function'} icon={Award} color="#818cf8">
              {data.byFunction!.map((f, i) => <Row key={i} a={f.functionName} b={`${f.count}`} c={f.avg} color="#818cf8" />)}
            </Panel>
            {/* By TL */}
            <Panel title={ar ? 'حسب الـ TL' : 'By team leader'} icon={Award} color="#22d3ee">
              {data.byTeamLeader!.slice(0, 8).map((t, i) => <Row key={i} a={t.teamLeader} b={`${t.count}`} c={t.avg} color="#22d3ee" />)}
            </Panel>
          </div>

          {/* Coaching candidates */}
          {data.belowTarget!.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(248,113,113,0.22)' }}>
              <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(248,113,113,0.06)' }}>
                <GraduationCap size={14} style={{ color: '#f87171' }} /><span className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? 'مرشّحون للكوتشينج (تحت متوسّط القسم)' : 'Coaching candidates (below function avg)'}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg ms-auto" style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>{data.belowTarget!.length}</span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {data.belowTarget!.map((b, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2 text-[11px]" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <span className="flex-1 min-w-0 truncate" style={{ color: '#cbd5e1' }}>{b.name} <span style={{ color: '#64748b' }}>· {b.fn} · {b.tl}</span></span>
                    <span style={{ color: '#fb923c' }}>{ar ? 'الأضعف' : 'weak'}: {b.weakest}</span>
                    <span className="tabular-nums font-bold" style={{ color: '#f87171' }}>{b.points}</span>
                    <span className="text-[10px]" style={{ color: '#475569' }}>/ {b.funcAvg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Panel({ title, icon: Icon, color, children }: any) {
  const { dark } = useUiStore();
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}><Icon size={13} style={{ color }} /><span className="text-xs font-bold" style={{ color: tp(dark) }}>{title}</span></div>
      <div className="px-2 py-1">{children}</div>
    </div>
  );
}
function Row({ a, b, c, color }: { a: string; b: string; c: number; color: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-[11px]" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
      <span className="flex-1 min-w-0 truncate" style={{ color: '#cbd5e1' }}>{a} <span style={{ color: '#64748b' }}>· {b}</span></span>
      <span className="tabular-nums font-bold" style={{ color }}>{c}</span>
    </div>
  );
}
