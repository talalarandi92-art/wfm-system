import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot, Loader2, RefreshCw, ShieldCheck, BrainCircuit, FileBarChart, Sparkles,
  CheckCircle2, AlertTriangle, XCircle, MinusCircle, ArrowLeft, Activity,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

interface Guard { key: string; name: string; nameEn: string; route: string; status: string; enabled: boolean; metrics: any; line: string }
interface Feed { type: string; title: string; body: string; action_url: string; created_at: string }
interface Team { guards: Guard[]; feed: Feed[] }

const STAT: Record<string, { color: string; Icon: any; ar: string }> = {
  ok: { color: '#22c55e', Icon: CheckCircle2, ar: 'سليم' },
  pass: { color: '#22c55e', Icon: CheckCircle2, ar: 'سليم' },
  info: { color: '#64748b', Icon: MinusCircle, ar: 'معلومة' },
  caution: { color: '#f59e0b', Icon: AlertTriangle, ar: 'انتباه' },
  warn: { color: '#f59e0b', Icon: AlertTriangle, ar: 'تحذير' },
  risk: { color: '#ef4444', Icon: XCircle, ar: 'خطر' },
  fail: { color: '#ef4444', Icon: XCircle, ar: 'فشل' },
  skip: { color: '#64748b', Icon: MinusCircle, ar: 'مؤجّل' },
};
const ICON: Record<string, any> = { health: ShieldCheck, analyst: BrainCircuit, reporter: FileBarChart, advisor: Sparkles };

export default function BotsHubPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  const nav = useNavigate();
  useInjectDsStyles();

  const [data, setData] = useState<Team | null>(null);
  const [loading, setL] = useState(true);

  const load = useCallback(async () => {
    setL(true);
    try { const { data } = await apiClient.get<Team>('/bots/team'); setData(data); } catch { setData(null); }
    setL(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.22)' }}>
            <Bot size={18} style={{ color: '#818cf8' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'مركز الحرّاس — الفريق' : 'Bots Hub — The Team'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'فريق متكامل يراقب ويحلّل ويقرّر وينشر — كلهم بمكان واحد' : 'An integrated team that watches, analyzes, decides and reports — in one place'}</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', color: '#a5b4fc' }}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{ar ? 'تحديث' : 'Refresh'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : !data ? (
        <div className="text-center py-20" style={{ color: '#475569' }}><Bot size={32} className="mx-auto mb-3" style={{ color: '#334155' }} /><p className="text-sm">{ar ? 'تعذّر تحميل حالة الفريق' : 'Could not load team status'}</p></div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
          {/* Guard cards */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))' }}>
            {data.guards.map(g => {
              const st = STAT[g.status] ?? STAT.info;
              const GIcon = ICON[g.key] ?? Bot;
              return (
                <button key={g.key} onClick={() => nav(g.route)}
                  className="text-start rounded-2xl p-4 transition-transform hover:-translate-y-0.5"
                  style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${st.color}2e`, opacity: g.enabled ? 1 : 0.65 }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${st.color}14` }}><GIcon size={17} style={{ color: st.color }} /></div>
                    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg" style={{ background: `${st.color}18`, color: st.color }}><st.Icon size={11} />{st.ar}</span>
                  </div>
                  <p className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? g.name : g.nameEn}</p>
                  <p className="text-[11px] mt-1 leading-snug" style={{ color: '#94a3b8' }}>{g.line}</p>
                  <div className="flex items-center gap-1 mt-3 text-[10px] font-semibold" style={{ color: st.color }}>
                    {ar ? 'افتح' : 'Open'} <ArrowLeft size={11} style={{ transform: ar ? 'none' : 'rotate(180deg)' }} />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Activity feed */}
          <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 mb-3"><Activity size={14} style={{ color: '#818cf8' }} /><span className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? 'نشاط الفريق' : 'Team activity'}</span></div>
            {!data.feed.length ? (
              <p className="text-xs py-6 text-center" style={{ color: '#475569' }}>{ar ? 'لا تنبيهات حديثة' : 'No recent alerts'}</p>
            ) : (
              <div className="space-y-2">
                {data.feed.map((f, i) => (
                  <div key={i} className="text-[11px] px-2.5 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <p className="font-semibold" style={{ color: '#cbd5e1' }}>{f.title}</p>
                    {f.body && <p className="mt-0.5" style={{ color: '#94a3b8' }}>{f.body}</p>}
                    <p className="text-[9px] mt-0.5" style={{ color: '#475569' }}>{new Date(f.created_at).toLocaleString(ar ? 'ar' : 'en')}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
