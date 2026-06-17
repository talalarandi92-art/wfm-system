import { useState, useEffect, useCallback } from 'react';
import {
  Brain, Loader2, RefreshCw, Zap, Award, GraduationCap, ShieldCheck, ArrowLeft, ArrowRight, Network, Sparkles,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';
import { BackToChief } from '@/components/BackToChief';

interface Learning { guard: string; guardEn: string; icon: string; learned: string; metric: string; more: string; ready?: boolean }
interface Exchange { from: string; to: string; knowledge: string; evidence: string | null }
interface Report {
  summary: { learnedSamples: number; decisionsReviewed: number; autoActed: number; coachingHandedOver: number; reports: number };
  learnings: Learning[]; exchanges: Exchange[];
}

const ICON: Record<string, any> = { brain: Brain, zap: Zap, award: Award, grad: GraduationCap, shield: ShieldCheck };

export default function TeamLearningPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [data, setData] = useState<Report | null>(null);
  const [loading, setL] = useState(true);

  const load = useCallback(async () => {
    setL(true);
    try { const { data } = await apiClient.get<Report>('/team-learning'); setData(data); } catch { setData(null); }
    setL(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      <BackToChief />
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.22)' }}>
            <Network size={18} style={{ color: '#a855f7' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'تعلّم الفريق وتبادل الخبرات' : 'Team Learning & Exchange'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'شو تعلّم كل حارس مع الوقت — وشو خبرات عطوا بعض' : 'What each guard learned over time — and the experiences they handed each other'}</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.25)', color: '#d8b4fe' }}>{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{ar ? 'تحديث' : 'Refresh'}</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : !data ? (
        <div className="text-center py-20" style={{ color: '#475569' }}><Network size={32} className="mx-auto mb-3" style={{ color: '#334155' }} /><p className="text-sm">{ar ? 'تعذّر التحميل' : 'Could not load'}</p></div>
      ) : (
        <div className="space-y-5">
          {/* Summary */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
            {[
              [ar ? 'مرّات التعلّم' : 'learn events', data.summary.learnedSamples, '#a855f7'],
              [ar ? 'قرارات تغذّى منها' : 'decisions', data.summary.decisionsReviewed, '#818cf8'],
              [ar ? 'تصرّفات آلية' : 'auto actions', data.summary.autoActed, '#eab308'],
              [ar ? 'سُلّم للكوتشينج' : 'to coaching', data.summary.coachingHandedOver, '#f59e0b'],
              [ar ? 'تقارير' : 'reports', data.summary.reports, '#0ea5e9'],
            ].map(([l, v, c], i) => (
              <div key={i} className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-2xl font-bold tabular-nums" style={{ color: c as string }}>{v as number}</p>
                <p className="text-[11px]" style={{ color: '#64748b' }}>{l as string}</p>
              </div>
            ))}
          </div>

          {/* What each guard learned */}
          <div>
            <div className="flex items-center gap-2 mb-2"><Brain size={15} style={{ color: '#a855f7' }} /><h2 className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? 'شو تعلّم كل حارس' : 'What each guard learned'}</h2></div>
            <div className="space-y-2">
              {data.learnings.map((g, i) => {
                const Ic = ICON[g.icon] ?? Brain;
                return (
                  <div key={i} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center gap-2 mb-1">
                      <Ic size={15} style={{ color: '#a855f7' }} />
                      <span className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? g.guard : g.guardEn}</span>
                      {g.ready && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}>{ar ? 'جاهز يتعلّم' : 'ready'}</span>}
                    </div>
                    <p className="text-[12px]" style={{ color: '#cbd5e1' }}>{g.learned}</p>
                    <p className="text-[11px] mt-1.5 font-semibold" style={{ color: '#a855f7' }}>↳ {g.metric}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: '#64748b' }}>{g.more}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Experiences exchanged */}
          <div>
            <div className="flex items-center gap-2 mb-2"><Sparkles size={15} style={{ color: '#22d3ee' }} /><h2 className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? 'خبرات عطوا بعض' : 'Experiences exchanged'}</h2></div>
            <div className="space-y-2">
              {data.exchanges.map((e, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl px-4 py-3 flex-wrap" style={{ background: 'rgba(34,211,238,0.04)', border: '1px solid rgba(34,211,238,0.15)' }}>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg" style={{ background: 'rgba(34,211,238,0.12)', color: '#67e8f9' }}>{e.from}</span>
                  {ar ? <ArrowLeft size={13} style={{ color: '#22d3ee' }} /> : <ArrowRight size={13} style={{ color: '#22d3ee' }} />}
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg" style={{ background: 'rgba(99,102,241,0.12)', color: '#a5b4fc' }}>{e.to}</span>
                  <span className="text-[11px] flex-1 min-w-0" style={{ color: '#cbd5e1' }}>{e.knowledge}</span>
                  {e.evidence && <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg" style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}>{e.evidence}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
