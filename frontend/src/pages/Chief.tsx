import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Crown, Loader2, RefreshCw, Target, Activity, ShieldAlert, Server, GraduationCap, Brain,
  Zap, CheckCircle2, XCircle, Undo2, ShieldCheck, FileBarChart, Sparkles, Bot, Power, Award, Telescope, ScrollText, Network,
  Pause, Info,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

type Sev = 'risk' | 'caution' | 'ok' | 'info';
interface Domain { key: string; label: string; sev: Sev; line: string }
interface Priority { sev: Sev; domain: string; title: string; action: string }
interface Briefing {
  date: string; posture: Sev; directive: string; llm: boolean; executiveBrief: string;
  domains: Domain[]; priorities: Priority[];
  learning: { learnedSamples: number; decisionsLogged: number };
  autoMode: { enabled: boolean; autoApprove: boolean; autoReject: boolean; allowedTypes: string[]; approved: number; rejected: number; held?: number; last24: number; topHoldReason?: string | null; topHoldCount?: number; topHoldCode?: string | null; topHoldFunction?: string | null } | null;
  selfTest: { passed: number; total: number; probes: { name: string; ok: boolean }[] } | null;
  lastReport: any;
}
interface AutoDecision { id: string; request_type: string; decision: string; reason: string; function_name: string; scope_date: string; reverted: boolean; decided_at: string }

const TEAM = [
  { route: '/system-health', icon: ShieldCheck, ar: 'السلامة', en: 'Health', color: '#22c55e' },
  { route: '/analyst', icon: Brain, ar: 'المحلّل', en: 'Analyst', color: '#a855f7' },
  { route: '/reports-bot', icon: FileBarChart, ar: 'الناشر', en: 'Reporter', color: '#0ea5e9' },
  { route: '/security-guard', icon: ShieldAlert, ar: 'الأمني', en: 'Security', color: '#ef4444' },
  { route: '/scorecard-guard', icon: Award, ar: 'السكور كارد', en: 'Scorecard', color: '#f59e0b' },
  { route: '/researcher', icon: Telescope, ar: 'الباحث', en: 'Researcher', color: '#818cf8' },
  { route: '/expert', icon: GraduationCap, ar: 'الخبير', en: 'Expert', color: '#10b981' },
  { route: '/knowledge-ledger', icon: ScrollText, ar: 'سجلّ المعرفة', en: 'Knowledge Ledger', color: '#14b8a6' },
  { route: '/team-learning', icon: Network, ar: 'تعلّم الفريق', en: 'Team Learning', color: '#a855f7' },
  { route: '/diagnostics', icon: Activity, ar: 'تقرير المشاكل', en: 'Diagnostics', color: '#ef4444' },
  { route: '/advisor', icon: Sparkles, ar: 'المستشار', en: 'Advisor', color: '#ec4899' },
  { route: '/bots', icon: Bot, ar: 'المركز', en: 'Hub', color: '#818cf8' },
];

const SEV: Record<Sev, { color: string; ar: string; en: string }> = {
  risk: { color: '#ef4444', ar: 'خطر', en: 'Risk' }, caution: { color: '#f59e0b', ar: 'انتباه', en: 'Caution' },
  ok: { color: '#22c55e', ar: 'مستقرّ', en: 'Stable' }, info: { color: '#64748b', ar: 'معلومة', en: 'Info' },
};
const DICON: Record<string, any> = { operations: Activity, security: ShieldAlert, system: Server };

export default function ChiefPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  const nav = useNavigate();
  useInjectDsStyles();

  const [data, setData] = useState<Briefing | null>(null);
  const [loading, setL] = useState(true);
  const [decisions, setDecisions] = useState<AutoDecision[]>([]);
  const [busy, setBusy] = useState(false);
  const [smoke, setSmoke] = useState<{ passed: number; total: number; probes: { name: string; label?: string; labelAr: string; ok: boolean; error?: string }[] } | null>(null);
  const [smokeBusy, setSmokeBusy] = useState(false);

  const runSmoke = async () => {
    setSmokeBusy(true);
    try { const { data } = await apiClient.get('/smoke-test'); setSmoke(data); } catch { setSmoke(null); }
    setSmokeBusy(false);
  };

  const load = useCallback(async () => {
    setL(true);
    try {
      const [{ data }, dec] = await Promise.all([
        apiClient.get<Briefing>(`/chief/briefing?lang=${ar ? 'ar' : 'en'}`),
        apiClient.get<AutoDecision[]>('/automode/decisions').catch(() => ({ data: [] })),
      ]);
      setData(data); setDecisions((dec as any).data || []);
    } catch { setData(null); }
    setL(false);
  }, [ar]);
  useEffect(() => { load(); }, [load]);

  const saveAuto = async (patch: Record<string, any>) => {
    if (!data?.autoMode) return;
    setBusy(true);
    try {
      await apiClient.post('/automode/settings', {
        enabled: data.autoMode.enabled, autoApprove: data.autoMode.autoApprove, autoReject: data.autoMode.autoReject,
        allowedTypes: data.autoMode.allowedTypes, ...patch,
      });
      await load();
    } catch { /* noop */ }
    setBusy(false);
  };
  const revert = async (id: string) => { setBusy(true); try { await apiClient.post(`/automode/decisions/${id}/revert`); await load(); } catch { /* noop */ } setBusy(false); };

  const posture = data ? SEV[data.posture] : SEV.info;

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.25)' }}>
            <Crown size={18} style={{ color: '#eab308' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'الرئيس — القيادة التنفيذية' : 'The Chief — Executive Command'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'يتعلّم من كل الحرّاس ويعطيك صورة واحدة وأهم قرار الآن' : 'Learns from every guard and gives you one picture + the single top decision'}</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.25)', color: '#fde047' }}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{ar ? 'تحديث' : 'Refresh'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : !data ? (
        <div className="text-center py-20" style={{ color: '#475569' }}><Crown size={32} className="mx-auto mb-3" style={{ color: '#334155' }} /><p className="text-sm">{ar ? 'تعذّر تحميل الموجز' : 'Could not load briefing'}</p></div>
      ) : (
        <div className="space-y-4">
          {/* Posture + directive banner */}
          <div className="rounded-2xl p-5" style={{ background: `linear-gradient(135deg, ${posture.color}1a, rgba(255,255,255,0.02))`, border: `1px solid ${posture.color}40` }}>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg" style={{ background: posture.color, color: '#0b0f1c' }}>{ar ? 'الوضع العام' : 'Posture'}: {ar ? posture.ar : posture.en}</span>
              <span className="text-[11px]" style={{ color: '#64748b' }}>{data.date}{data.llm ? '' : ` · ${ar ? 'موجز قواعدي' : 'rule-based'}`}</span>
            </div>
            <p className="text-sm whitespace-pre-line leading-relaxed" style={{ color: 'var(--text-1)' }}>{data.executiveBrief}</p>
            <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-xl" style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)' }}>
              <Target size={15} style={{ color: '#eab308', flexShrink: 0 }} />
              <p className="text-xs font-bold" style={{ color: '#fde047' }}>{data.directive}</p>
            </div>
          </div>

          {/* Domains */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            {data.domains.map(d => {
              const s = SEV[d.sev]; const Ic = DICON[d.key] ?? Activity;
              return (
                <div key={d.key} className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${s.color}2e` }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2"><Ic size={15} style={{ color: s.color }} /><span className="text-sm font-bold" style={{ color: tp(dark) }}>{d.label}</span></div>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${s.color}1a`, color: s.color }}>{ar ? s.ar : s.en}</span>
                  </div>
                  <p className="text-[11px]" style={{ color: '#94a3b8' }}>{d.line}</p>
                </div>
              );
            })}
          </div>

          {/* Prioritized directives */}
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}><Target size={14} style={{ color: '#eab308' }} /><span className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? 'أولويات القيادة' : 'Command priorities'}</span></div>
            {data.priorities.length === 0 ? (
              <p className="text-xs py-6 text-center" style={{ color: '#22c55e' }}>{ar ? 'لا مخاطر بارزة عبر الفريق' : 'No notable risks across the team'}</p>
            ) : (
              <div>
                {data.priorities.map((p, i) => {
                  const s = SEV[p.sev];
                  return (
                    <div key={i} className="flex items-start gap-3 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <span className="text-xs font-bold tabular-nums mt-0.5" style={{ color: s.color, minWidth: 18 }}>{i + 1}</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5" style={{ background: `${s.color}1a`, color: s.color }}>{p.domain}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold" style={{ color: tp(dark) }}>{p.title}</p>
                        <p className="text-[11px]" style={{ color: '#94a3b8' }}>{p.action}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Auto Mode — the deputy */}
          {data.autoMode && (
            <div className="rounded-2xl p-4" style={{ background: data.autoMode.enabled ? 'rgba(234,179,8,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${data.autoMode.enabled ? 'rgba(234,179,8,0.3)' : 'rgba(255,255,255,0.06)'}` }}>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div className="flex items-center gap-2">
                  <Zap size={15} style={{ color: data.autoMode.enabled ? '#eab308' : '#64748b' }} />
                  <span className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? 'الوضع التلقائي — ينوب عنك بالطلبات' : 'Auto Mode — deputy on requests'}</span>
                </div>
                <button onClick={() => saveAuto({ enabled: !data.autoMode!.enabled })} disabled={busy}
                  className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg"
                  style={{ background: data.autoMode.enabled ? 'rgba(34,197,94,0.18)' : 'rgba(100,116,139,0.15)', color: data.autoMode.enabled ? '#22c55e' : '#94a3b8' }}>
                  <Power size={13} /> {data.autoMode.enabled ? (ar ? 'مُفعّل' : 'ON') : (ar ? 'متوقّف' : 'OFF')}
                </button>
              </div>
              <p className="text-[11px] mb-3" style={{ color: '#94a3b8' }}>{ar ? 'يوافق على الطلبات تلقائياً عند وجود فائض تغطية آمن، ويترك الباقي لك. الرفض التلقائي اختياري (حساس). كل قرار مُسجّل وقابل للتراجع.' : 'Auto-approves when coverage surplus is safe; holds the rest. Auto-reject is opt-in (sensitive). Every action is logged and reversible.'}</p>
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <Toggle on={data.autoMode.autoApprove} label={ar ? 'موافقة تلقائية' : 'auto-approve'} onClick={() => saveAuto({ autoApprove: !data.autoMode!.autoApprove })} busy={busy} color="#22c55e" />
                <Toggle on={data.autoMode.autoReject} label={ar ? 'رفض تلقائي (حساس)' : 'auto-reject (sensitive)'} onClick={() => saveAuto({ autoReject: !data.autoMode!.autoReject })} busy={busy} color="#ef4444" />
              </div>
              {/* Editable allowed request types — click to include/exclude from Auto Mode */}
              <div className="flex items-center gap-1.5 flex-wrap mb-3">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: '#64748b' }}>{ar ? 'الأنواع المسموحة' : 'allowed types'}</span>
                {(() => {
                  const LABELS: Record<string, { ar: string; en: string }> = {
                    permission: { ar: 'استئذان', en: 'permission' }, break: { ar: 'بريك', en: 'break' },
                    overtime: { ar: 'أوفرتايم', en: 'overtime' }, off_swap: { ar: 'تبديل OFF', en: 'off swap' },
                    shift_swap: { ar: 'تبديل شفت', en: 'shift swap' }, wfh: { ar: 'عمل عن بُعد', en: 'wfh' },
                  };
                  const current = data.autoMode!.allowedTypes;
                  const candidates = Array.from(new Set([...Object.keys(LABELS), ...current]));
                  return candidates.map(code => {
                    const on = current.includes(code);
                    const lbl = LABELS[code] ?? { ar: code, en: code };
                    return (
                      <button key={code} disabled={busy}
                        onClick={() => saveAuto({ allowedTypes: on ? current.filter(c => c !== code) : [...current, code] })}
                        className="text-[11px] px-2 py-1 rounded-lg transition-all disabled:opacity-50"
                        style={{
                          background: on ? 'rgba(99,102,241,0.16)' : 'rgba(255,255,255,0.03)',
                          color: on ? '#a5b4fc' : '#64748b',
                          border: `1px solid ${on ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)'}`,
                        }}>
                        {on ? '✓ ' : ''}{ar ? lbl.ar : lbl.en}
                      </button>
                    );
                  });
                })()}
              </div>
              <div className="flex items-center gap-3 flex-wrap text-[11px] mb-2" style={{ color: '#94a3b8' }}>
                <span className="flex items-center gap-1"><CheckCircle2 size={12} style={{ color: '#22c55e' }} /> {data.autoMode.approved} {ar ? 'موافقة' : 'approved'}</span>
                <span className="flex items-center gap-1"><XCircle size={12} style={{ color: '#f87171' }} /> {data.autoMode.rejected} {ar ? 'رفض' : 'rejected'}</span>
                {(data.autoMode.held ?? 0) > 0 && (
                  <span className="flex items-center gap-1" style={{ color: '#fbbf24' }}><Pause size={12} /> {data.autoMode.held} {ar ? 'محجوز للمراجعة' : 'held for review'}</span>
                )}
                <span style={{ color: '#64748b' }}>· {data.autoMode.last24} {ar ? 'آخر 24 ساعة' : 'last 24h'}</span>
              </div>
              {/* Transparency: why is it holding instead of acting? */}
              {(data.autoMode.held ?? 0) > 0 && (data.autoMode.approved + data.autoMode.rejected) === 0 && (
                <div className="flex items-start gap-2 text-[11px] px-3 py-2 rounded-xl mb-2" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', color: '#fcd34d' }}>
                  <Info size={13} className="mt-0.5 flex-shrink-0" />
                  <span>
                    {(() => {
                      const fn = data.autoMode!.topHoldFunction ?? '';
                      const codeText = (() => {
                        switch (data.autoMode!.topHoldCode) {
                          case 'hold_no_coverage': return ar ? 'لا توجد قراءة تغطية كافية' : 'no sufficient coverage reading';
                          case 'hold_verdict':     return ar ? `التغطية غير آمنة${fn ? ' بالقسم ' + fn : ''}` : `coverage not safe${fn ? ' in ' + fn : ''}`;
                          case 'reject_shortfall': return ar ? `نقص تغطية${fn ? ' بالقسم ' + fn : ''}` : `coverage shortfall${fn ? ' in ' + fn : ''}`;
                          default: return data.autoMode!.topHoldReason ?? '';
                        }
                      })();
                      const lead = ar
                        ? 'الوضع التلقائي شغّال ويقيّم الطلبات، لكنه يحجبها كلها للمراجعة لأن التغطية غير آمنة حالياً — لا يوافق إلا عند وجود فائض آمن.'
                        : "Auto Mode is running and evaluating requests, but holding them all for review because coverage isn't safe right now — it only approves when there's a safe surplus.";
                      return `${lead}${codeText ? (ar ? ' أكثر سبب: ' : ' Top reason: ') + codeText : ''}`;
                    })()}
                  </span>
                </div>
              )}
              {decisions.length > 0 && (
                <div className="space-y-1 mt-2">
                  {decisions.filter(d => d.decision !== 'hold').slice(0, 6).map(d => (
                    <div key={d.id} className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <span className="font-bold px-1.5 py-0.5 rounded" style={{ background: d.decision === 'approve' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: d.decision === 'approve' ? '#22c55e' : '#f87171' }}>{d.decision === 'approve' ? (ar ? 'وافق' : 'approved') : (ar ? 'رفض' : 'rejected')}</span>
                      <span className="flex-1 min-w-0 truncate" style={{ color: '#cbd5e1' }}>{d.request_type} · {d.function_name} — {d.reason}</span>
                      {d.reverted ? <span className="text-[10px]" style={{ color: '#64748b' }}>{ar ? 'متراجَع' : 'reverted'}</span>
                        : <button onClick={() => revert(d.id)} disabled={busy} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}><Undo2 size={10} />{ar ? 'تراجع' : 'undo'}</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Self-test + learning + the hidden team */}
          <div className="flex items-center gap-2 flex-wrap text-[11px]" style={{ color: '#64748b' }}>
            {data.selfTest && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ background: data.selfTest.passed === data.selfTest.total ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)', color: data.selfTest.passed === data.selfTest.total ? '#4ade80' : '#fbbf24' }}>
                <ShieldCheck size={12} /> {ar ? 'اختبار ذاتي' : 'self-test'} {data.selfTest.passed}/{data.selfTest.total}
              </span>
            )}
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ background: 'rgba(168,85,247,0.1)', color: '#c4b5fd' }}><Brain size={12} /> {ar ? 'تعلّم' : 'learned'} {data.learning.learnedSamples} · {data.learning.decisionsLogged} {ar ? 'قرار' : 'decisions'}</span>
            <button onClick={runSmoke} disabled={smokeBusy} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold" style={{ background: 'rgba(34,211,238,0.1)', color: '#67e8f9', border: '1px solid rgba(34,211,238,0.2)' }}>
              {smokeBusy ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />} {ar ? 'اختبار وظيفي للنظام' : 'System smoke test'}
              {smoke && <b style={{ color: smoke.passed === smoke.total ? '#4ade80' : '#f87171' }}>{smoke.passed}/{smoke.total}</b>}
            </button>
          </div>

          {/* Smoke test probe results */}
          {smoke && (
            <div className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${smoke.passed === smoke.total ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.25)'}` }}>
              <p className="text-[10px] font-bold mb-2" style={{ color: '#64748b' }}>{ar ? 'اختبار وظيفي — يجرّب مسارات الكتابة الحقيقية (حفظ/نشر/طلبات) ويكشف الأعطال' : 'Functional smoke test — exercises real write paths (save/publish/requests) to catch bugs'}</p>
              <div className="flex flex-wrap gap-1.5">
                {smoke.probes.map(p => (
                  <span key={p.name} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg" style={{ background: p.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.12)', color: p.ok ? '#4ade80' : '#f87171' }} title={p.error || ''}>
                    {p.ok ? <CheckCircle2 size={10} /> : <XCircle size={10} />} {ar ? p.labelAr : (p.label ?? p.labelAr)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* The team behind the scenes */}
          <div className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[10px] font-bold mb-2" style={{ color: '#64748b' }}>{ar ? 'الفريق خلف الكواليس' : 'The team behind the scenes'}</p>
            <div className="flex items-center gap-2 flex-wrap">
              {TEAM.map(g => (
                <button key={g.route} onClick={() => nav(g.route)} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg" style={{ background: `${g.color}12`, color: g.color }}>
                  <g.icon size={13} /> {ar ? g.ar : g.en}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ on, label, onClick, busy, color }: { on: boolean; label: string; onClick: () => void; busy: boolean; color: string }) {
  return (
    <button onClick={onClick} disabled={busy} className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg"
      style={{ background: on ? `${color}1a` : 'rgba(255,255,255,0.03)', color: on ? color : '#64748b', border: `1px solid ${on ? `${color}40` : 'transparent'}` }}>
      <span className="w-3 h-3 rounded-full" style={{ background: on ? color : '#475569' }} /> {label}
    </button>
  );
}
