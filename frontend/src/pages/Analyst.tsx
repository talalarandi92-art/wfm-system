import { useState, useEffect, useCallback } from 'react';
import {
  BrainCircuit, Loader2, RefreshCw, ShieldAlert, CheckCircle2, AlertTriangle, XCircle,
  Users, CalendarCheck, Radio, UserX, ThumbsUp, ThumbsDown, Sparkles,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';
import { BackToChief } from '@/components/BackToChief';

type Verdict = 'approve' | 'caution' | 'danger';
type Severity = 'ok' | 'info' | 'caution' | 'risk';
interface Rec { id?: string | null; decision?: string; area: string; functionName?: string; severity: Severity; verdict?: Verdict | null; title: string; summary: string; recommendation: string; metrics?: any }
interface CovFn { functionId: string; functionName: string; verdict: Verdict; bottleneck: { hour: number; gap: number; required: number; available: number }; uncovered: number[] }
interface Assessment {
  date: string; headline: Severity; thresholds: { surplusSafe: number; slaTarget: number; backlogMax: number };
  coverage: { severity: Severity; functions: CovFn[]; recs: Rec[] };
  schedule: { severity: Severity; findings: any[]; recs: Rec[] };
  queues: { severity: Severity; capturedAt: string | null; queues: any[]; recs: Rec[] };
  compliance: { severity: Severity; offenders: any[]; recs: Rec[] };
}

const SEV = {
  ok: { color: '#22c55e', Icon: CheckCircle2, ar: 'سليم', en: 'Healthy' },
  info: { color: '#64748b', Icon: CheckCircle2, ar: 'معلومة', en: 'Info' },
  caution: { color: '#f59e0b', Icon: AlertTriangle, ar: 'انتباه', en: 'Caution' },
  risk: { color: '#ef4444', Icon: XCircle, ar: 'خطر', en: 'Risk' },
} as const;
const VERD = {
  approve: { color: '#22c55e', ar: 'وافِق', en: 'Approve' },
  caution: { color: '#f59e0b', ar: 'بحذر', en: 'Caution' },
  danger: { color: '#ef4444', ar: 'خطر', en: 'Danger' },
} as const;
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

export default function AnalystPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [date, setDate] = useState('');
  const [data, setData] = useState<Assessment | null>(null);
  const [loading, setL] = useState(true);
  const [acted, setActed] = useState<Record<string, 'accepted' | 'rejected'>>({});
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setL(true);
    try {
      const { data } = await apiClient.get<Assessment>('/analyst/assessment', { params: { ...(date ? { date } : {}), lang: ar ? 'ar' : 'en' } });
      setData(data); if (!date && data?.date) setDate(data.date); setActed({});
    } catch { setData(null); }
    setL(false);
  }, [date, ar]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ar]);

  // Each rec carries its DB id from the assessment — feedback posts it directly.
  const sendFeedback = async (rec: Rec, decision: 'accepted' | 'rejected') => {
    if (!rec.id) { setToast(ar ? 'لا يوجد معرّف للتوصية' : 'No recommendation id'); return; }
    try {
      const { data: res } = await apiClient.post('/analyst/feedback', { recId: rec.id, decision });
      setActed(a => ({ ...a, [rec.title]: decision }));
      if (res?.learned) setToast(ar ? `تعلّم: ${res.learned.key} ${res.learned.from} ← ${res.learned.to}` : `Learned: ${res.learned.key} ${res.learned.from}→${res.learned.to}`);
      else setToast(ar ? 'تم التسجيل' : 'Recorded');
      setTimeout(() => setToast(''), 3500);
    } catch { setToast(ar ? 'تعذّر الإرسال' : 'Failed'); }
  };

  const allRecs: Rec[] = data ? [...data.coverage.recs, ...data.queues.recs, ...data.schedule.recs, ...data.compliance.recs]
    .sort((a, b) => (['risk', 'caution', 'info', 'ok'].indexOf(a.severity) - ['risk', 'caution', 'info', 'ok'].indexOf(b.severity))) : [];

  const sectionCard = (Icon: any, titleAr: string, titleEn: string, sev: Severity, children: any) => (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${SEV[sev].color}22` }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: `${SEV[sev].color}0d` }}>
        <Icon size={15} style={{ color: SEV[sev].color }} />
        <span className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? titleAr : titleEn}</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg ms-auto" style={{ background: `${SEV[sev].color}1a`, color: SEV[sev].color }}>{ar ? SEV[sev].ar : SEV[sev].en}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      <BackToChief />
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.22)' }}>
            <BrainCircuit size={18} style={{ color: '#a855f7' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'المحلّل — خبير WFM/RTA' : 'WFM/RTA Analyst'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'يقيّم الوضع ويعطي أفضل قرار — تغطية، جدول، كيوز، التزام — ويتعلّم من قراراتك' : 'Assesses the operation and recommends the best decision — and learns from your calls'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} onBlur={load}
            className="text-xs rounded-xl px-3 py-1.5 outline-none" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0' }} />
          <button onClick={load} disabled={loading} className="flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.25)', color: '#d8b4fe' }}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{ar ? 'تحليل' : 'Assess'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : !data ? (
        <div className="text-center py-20" style={{ color: '#475569' }}><BrainCircuit size={32} className="mx-auto mb-3" style={{ color: '#334155' }} /><p className="text-sm">{ar ? 'تعذّر التحليل' : 'Could not assess'}</p></div>
      ) : (
        <div className="space-y-4">
          {/* Headline banner */}
          <div className="flex items-center gap-3 rounded-2xl px-5 py-3" style={{ background: `${SEV[data.headline].color}12`, border: `1px solid ${SEV[data.headline].color}33` }}>
            <ShieldAlert size={20} style={{ color: SEV[data.headline].color }} />
            <div>
              <p className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? 'تقييم الوضع' : 'Situation'}: <span style={{ color: SEV[data.headline].color }}>{ar ? SEV[data.headline].ar : SEV[data.headline].en}</span></p>
              <p className="text-[11px]" style={{ color: '#64748b' }}>{data.date} · {ar ? 'عتبة الفائض الآمن' : 'safe-surplus threshold'} = {data.thresholds.surplusSafe}</p>
            </div>
          </div>

          {/* Top recommendations with accept/reject (the decision layer) */}
          {allRecs.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2"><Sparkles size={15} style={{ color: '#a855f7' }} /><h2 className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? 'التوصيات وأفضل قرار' : 'Recommendations & best decision'}</h2></div>
              <div className="space-y-2">
                {allRecs.map((r, i) => {
                  const { color } = SEV[r.severity];
                  const done = acted[r.title] ?? (r.decision && r.decision !== 'pending' ? r.decision as 'accepted' | 'rejected' : undefined);
                  return (
                    <div key={i} className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${color}22` }}>
                      <div className="flex items-start gap-2 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {r.verdict && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${VERD[r.verdict].color}1a`, color: VERD[r.verdict].color }}>{ar ? VERD[r.verdict].ar : VERD[r.verdict].en}</span>}
                            <span className="text-xs font-bold" style={{ color: tp(dark) }}>{r.title}</span>
                          </div>
                          <p className="text-[11px] mt-1" style={{ color: '#94a3b8' }}>{r.summary}</p>
                          <p className="text-[11px] mt-1 font-semibold" style={{ color }}>↳ {r.recommendation}</p>
                        </div>
                        {done ? (
                          <span className="text-[10px] font-bold px-2 py-1 rounded-lg" style={{ background: done === 'accepted' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: done === 'accepted' ? '#22c55e' : '#f87171' }}>{done === 'accepted' ? (ar ? 'قُبِلت' : 'Accepted') : (ar ? 'رُفِضت' : 'Rejected')}</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => sendFeedback(r, 'accepted')} className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}><ThumbsUp size={11} />{ar ? 'اقبل' : 'Accept'}</button>
                            <button onClick={() => sendFeedback(r, 'rejected')} className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}><ThumbsDown size={11} />{ar ? 'ارفض' : 'Reject'}</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Coverage verdicts grid */}
          {sectionCard(Users, 'التغطية والقرار لكل قسم', 'Coverage & decision per function', data.coverage.severity, (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
              {data.coverage.functions.map(f => (
                <div key={f.functionId} className="rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${VERD[f.verdict].color}33` }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold truncate" style={{ color: tp(dark) }}>{f.functionName}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${VERD[f.verdict].color}1a`, color: VERD[f.verdict].color }}>{ar ? VERD[f.verdict].ar : VERD[f.verdict].en}</span>
                  </div>
                  <p className="text-[10px] mt-1" style={{ color: '#64748b' }}>
                    {ar ? 'أضيق نقطة' : 'tightest'} {hh(f.bottleneck.hour)}: {ar ? 'فجوة' : 'gap'} <b style={{ color: VERD[f.verdict].color }}>{f.bottleneck.gap >= 0 ? `+${f.bottleneck.gap}` : f.bottleneck.gap}</b> ({f.bottleneck.available}/{f.bottleneck.required})
                  </p>
                  {f.uncovered.length > 0 && <p className="text-[10px] mt-0.5" style={{ color: '#f87171' }}>⚠ {ar ? 'بلا تغطية' : 'uncovered'}: {f.uncovered.map(hh).join(', ')}</p>}
                </div>
              ))}
              {!data.coverage.functions.length && <p className="text-xs" style={{ color: '#475569' }}>{ar ? 'لا بيانات تغطية لهذا اليوم' : 'No coverage data'}</p>}
            </div>
          ))}

          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' }}>
            {/* Queues */}
            {sectionCard(Radio, 'انسيابية الكيوز', 'Queue flow', data.queues.severity, (
              data.queues.queues.length ? (
                <div className="space-y-1.5">
                  {data.queues.queues.slice(0, 8).map((q, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] px-2 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <span className="truncate" style={{ color: tp(dark) }}>{q.name}</span>
                      <span className="tabular-nums" style={{ color: q.sla < data.thresholds.slaTarget ? '#f87171' : '#94a3b8' }}>SLA {q.sla}% · {ar ? 'باكلوج' : 'bk'} {q.backlog} · {ar ? 'متاح' : 'av'} {q.agentsAvailable}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs" style={{ color: '#22c55e' }}>{ar ? 'كل الكيوز ماشية بسلاسة' : 'All queues flowing smoothly'}</p>
            ))}

            {/* Compliance */}
            {sectionCard(UserX, 'عدم الالتزام / إنسيدنت', 'Compliance / incidents', data.compliance.severity, (
              data.compliance.offenders.length ? (
                <div className="space-y-1.5">
                  {data.compliance.offenders.slice(0, 8).map((o, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] px-2 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <span className="truncate" style={{ color: tp(dark) }}>{o.name} <span style={{ color: '#64748b' }}>· {o.fn}</span></span>
                      <span className="truncate ms-2" style={{ color: '#fb923c', maxWidth: 160 }}>{o.issues.join(ar ? '، ' : ', ')}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs" style={{ color: '#22c55e' }}>{ar ? 'الكل ملتزم بهذا اليوم' : 'Everyone compliant'}</p>
            ))}
          </div>

          {/* Schedule integrity */}
          {data.schedule.findings.length > 0 && sectionCard(CalendarCheck, 'سلامة الجدول والقواعد', 'Schedule & rule integrity', data.schedule.severity, (
            <div className="space-y-1.5">
              {data.schedule.findings.map((c, i) => (
                <div key={i} className="text-[11px] px-2 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', color: c.status === 'fail' ? '#f87171' : '#fbbf24' }}>{ar ? c.labelAr : c.label} — {c.count} ({c.detail})</div>
              ))}
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-xl" style={{ background: 'rgba(168,85,247,0.95)', color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
          <Sparkles size={14} /> {toast}
        </div>
      )}
    </div>
  );
}
