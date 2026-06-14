import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles, Loader2, Send, Lightbulb, RefreshCw, KeyRound, MessageSquare,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

interface Msg { role: 'user' | 'assistant'; content: string }

export default function AdvisorPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [brief, setBrief] = useState('');
  const [briefLlm, setBriefLlm] = useState(false);
  const [loadingBrief, setLB] = useState(true);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const [improvements, setImprovements] = useState('');
  const [loadingImp, setLI] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadBrief = useCallback(async () => {
    setLB(true);
    try {
      const [{ data: st }, { data: br }] = await Promise.all([
        apiClient.get('/advisor/status'), apiClient.get('/advisor/brief'),
      ]);
      setConfigured(st.configured); setModel(st.model);
      setBrief(br.brief); setBriefLlm(br.llm);
    } catch { setBrief(''); }
    setLB(false);
  }, []);
  useEffect(() => { loadBrief(); }, [loadBrief]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const ask = async () => {
    const q = input.trim(); if (!q || asking) return;
    setInput(''); setMsgs(m => [...m, { role: 'user', content: q }]); setAsking(true);
    try {
      const { data } = await apiClient.post('/advisor/ask', { question: q });
      setMsgs(m => [...m, { role: 'assistant', content: data.answer }]);
    } catch { setMsgs(m => [...m, { role: 'assistant', content: ar ? 'تعذّر الرد' : 'Failed to answer' }]); }
    setAsking(false);
  };

  const loadImprovements = async () => {
    setLI(true);
    try { const { data } = await apiClient.get('/advisor/improvements'); setImprovements(data.improvements); }
    catch { setImprovements(''); }
    setLI(false);
  };

  const suggestions = ar
    ? ['لخّصلي وضع اليوم', 'وين أكبر خطر تغطية؟', 'أقدر أوافق على إجازة بالـ OMT؟', 'شو أهم 3 قرارات الآن؟']
    : ['Summarize today', 'Where is the biggest coverage risk?', 'Can I approve OMT leave?', 'Top 3 decisions now?'];

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(236,72,153,0.12)', border: '1px solid rgba(236,72,153,0.22)' }}>
            <Sparkles size={18} style={{ color: '#ec4899' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'المستشار الذكي' : 'LLM Advisor'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'يسرد ويجاوب ويقترح تحسينات — خبير WFM/RTA ضمن قواعدنا' : 'Narrates, answers, and proposes improvements — a WFM/RTA expert within our rules'}</p>
          </div>
        </div>
        <button onClick={loadBrief} disabled={loadingBrief} className="flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'rgba(236,72,153,0.12)', border: '1px solid rgba(236,72,153,0.25)', color: '#f9a8d4' }}>
          {loadingBrief ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{ar ? 'تحديث' : 'Refresh'}
        </button>
      </div>

      {/* Key status banner */}
      {configured === false && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-2.5 mb-4 text-xs" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24' }}>
          <KeyRound size={14} />
          {ar ? 'وضع مبسّط — يعمل بالقواعد. لتفعيل الذكاء الكامل اضبط ANTHROPIC_API_KEY بالخادم.' : 'Simple mode — rule-based. Set ANTHROPIC_API_KEY on the server to activate full intelligence.'}
        </div>
      )}
      {configured && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-2 mb-4 text-xs" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.22)', color: '#4ade80' }}>
          <Sparkles size={13} /> {ar ? 'الذكاء مُفعّل' : 'Intelligence active'} · {model}
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' }}>
        {/* Chat column */}
        <div className="rounded-2xl flex flex-col" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', minHeight: 440 }}>
          {/* Brief */}
          <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 mb-1"><MessageSquare size={13} style={{ color: '#ec4899' }} /><span className="text-xs font-bold" style={{ color: tp(dark) }}>{ar ? 'موجز الوضع' : 'Situation brief'}</span>{!briefLlm && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}>{ar ? 'قواعدي' : 'rule-based'}</span>}</div>
            {loadingBrief ? <Loader2 size={14} className="animate-spin" style={{ color: '#475569' }} /> : <p className="text-[11px] whitespace-pre-line leading-relaxed" style={{ color: '#cbd5e1' }}>{brief}</p>}
          </div>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {msgs.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s, i) => (
                  <button key={i} onClick={() => setInput(s)} className="text-[11px] px-2.5 py-1 rounded-lg" style={{ background: 'rgba(236,72,153,0.1)', color: '#f9a8d4', border: '1px solid rgba(236,72,153,0.2)' }}>{s}</button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[85%] text-[12px] px-3 py-2 rounded-xl whitespace-pre-line leading-relaxed" style={{ background: m.role === 'user' ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)', color: m.role === 'user' ? '#c7d2fe' : '#e2e8f0' }}>{m.content}</div>
              </div>
            ))}
            {asking && <div className="flex justify-start"><div className="px-3 py-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}><Loader2 size={14} className="animate-spin" style={{ color: '#ec4899' }} /></div></div>}
            <div ref={endRef} />
          </div>
          {/* Input */}
          <div className="flex items-center gap-2 p-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()}
              placeholder={ar ? 'اسأل المستشار...' : 'Ask the advisor...'}
              className="flex-1 text-xs rounded-xl px-3 py-2 outline-none" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0' }} />
            <button onClick={ask} disabled={asking || !input.trim()} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#ec4899,#db2777)', color: '#fff', opacity: asking || !input.trim() ? 0.5 : 1 }}>
              <Send size={15} style={{ transform: ar ? 'scaleX(-1)' : 'none' }} />
            </button>
          </div>
        </div>

        {/* Improvements column */}
        <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><Lightbulb size={14} style={{ color: '#fbbf24' }} /><span className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? 'تحسينات مقترحة' : 'Proposed improvements'}</span></div>
            <button onClick={loadImprovements} disabled={loadingImp} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg" style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>{loadingImp ? <Loader2 size={12} className="animate-spin" /> : (ar ? 'حلّل' : 'Analyze')}</button>
          </div>
          {improvements ? (
            <p className="text-[11px] whitespace-pre-line leading-relaxed" style={{ color: '#cbd5e1' }}>{improvements}</p>
          ) : (
            <p className="text-[11px] py-8 text-center" style={{ color: '#475569' }}>{ar ? 'اضغط "حلّل" ليقترح المستشار تحسينات للنظام والديزاين والعمليات' : 'Click "Analyze" for system / design / process improvement proposals'}</p>
          )}
        </div>
      </div>
    </div>
  );
}
