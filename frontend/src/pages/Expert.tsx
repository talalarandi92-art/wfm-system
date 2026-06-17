import { useState, useEffect, useCallback } from 'react';
import {
  GraduationCap, Loader2, Send, BookOpen, Search, Sparkles, KeyRound,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';
import { BackToChief } from '@/components/BackToChief';

interface Topic { topic: string; titleAr: string; titleEn: string; tags: string[] }
interface KEntry { topic: string; titleAr: string; titleEn: string; body: string; tags: string[] }

export default function ExpertPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [topics, setTopics] = useState<Topic[]>([]);
  const [knowledge, setKnowledge] = useState<KEntry[]>([]);
  const [active, setActive] = useState<string>('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<string[]>([]);
  const [answerLlm, setAnswerLlm] = useState(false);
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ data: st }, { data: tp2 }, { data: kn }] = await Promise.all([
        apiClient.get('/expert/status'), apiClient.get<Topic[]>('/expert/topics'), apiClient.get<KEntry[]>('/expert/knowledge'),
      ]);
      setConfigured(st.configured); setModel(st.model);
      setTopics(tp2 || []); setKnowledge(kn || []);
      if (tp2?.length) setActive(tp2[0].topic);
    } catch { /* noop */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const ask = async () => {
    const question = q.trim(); if (!question || asking) return;
    setAsking(true); setAnswer('');
    try {
      const { data } = await apiClient.post('/expert/ask', { question });
      setAnswer(data.answer); setSources(data.sources || []); setAnswerLlm(data.llm);
    } catch { setAnswer(ar ? 'تعذّر الرد' : 'Failed'); }
    setAsking(false);
  };

  const activeEntry = knowledge.find(k => k.topic === active);

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      <BackToChief />
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.22)' }}>
            <GraduationCap size={18} style={{ color: '#10b981' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'المستشار الخبير' : 'Expert Advisor'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'متعلّم من أقوى مصادر WFM + قواعدنا — اسأله أي شي بالمجال' : 'Taught from the strongest WFM sources + our rules — ask anything in the domain'}</p>
          </div>
        </div>
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg" style={{ background: 'rgba(16,185,129,0.12)', color: '#34d399' }}>{topics.length} {ar ? 'موضوع معرفي' : 'topics'}</span>
      </div>

      {configured === false && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-2.5 mb-4 text-xs" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24' }}>
          <KeyRound size={14} /> {ar ? 'وضع معرفي — يستعرض المعرفة المعتمدة. مع مفتاح LLM يصير يحلّل ويستنتج على وضعك.' : 'Knowledge mode — surfaces curated knowledge. With an LLM key it reasons over your live data.'}
        </div>
      )}
      {configured && <div className="flex items-center gap-2 rounded-xl px-4 py-2 mb-4 text-xs" style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80' }}><Sparkles size={13} /> {ar ? 'الذكاء مُفعّل' : 'Intelligence active'} · {model}</div>}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)' }}>
        {/* Knowledge explorer */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}><BookOpen size={14} style={{ color: '#10b981' }} /><span className="text-xs font-bold" style={{ color: tp(dark) }}>{ar ? 'قاعدة المعرفة' : 'Knowledge base'}</span></div>
          <div className="flex flex-wrap gap-1.5 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            {topics.map(t => (
              <button key={t.topic} onClick={() => setActive(t.topic)} className="text-[11px] font-semibold px-2 py-1 rounded-lg" style={{ background: active === t.topic ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.03)', color: active === t.topic ? '#34d399' : '#94a3b8', border: `1px solid ${active === t.topic ? 'rgba(16,185,129,0.3)' : 'transparent'}` }}>{ar ? t.titleAr : t.titleEn}</button>
            ))}
          </div>
          {activeEntry && (
            <div className="px-4 py-4">
              <h3 className="text-sm font-bold mb-2" style={{ color: tp(dark) }}>{ar ? activeEntry.titleAr : activeEntry.titleEn}</h3>
              <p className="text-[12px] leading-relaxed" style={{ color: '#cbd5e1' }}>{activeEntry.body}</p>
              <div className="flex flex-wrap gap-1 mt-3">{activeEntry.tags.map(tag => <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.04)', color: '#64748b' }}>{tag}</span>)}</div>
            </div>
          )}
        </div>

        {/* Ask */}
        <div className="rounded-2xl flex flex-col" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}><Search size={14} style={{ color: '#10b981' }} /><span className="text-xs font-bold" style={{ color: tp(dark) }}>{ar ? 'اسأل الخبير' : 'Ask the expert'}</span></div>
          <div className="flex items-center gap-2 p-3">
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()} placeholder={ar ? 'مثلاً: كيف أحسب السعة للواتساب؟' : 'e.g. how to size WhatsApp capacity?'}
              className="flex-1 text-xs rounded-xl px-3 py-2 outline-none" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0' }} />
            <button onClick={ask} disabled={asking || !q.trim()} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', opacity: asking || !q.trim() ? 0.5 : 1 }}><Send size={15} style={{ transform: ar ? 'scaleX(-1)' : 'none' }} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {asking ? <Loader2 size={16} className="animate-spin" style={{ color: '#10b981' }} /> : answer ? (
              <>
                {sources.length > 0 && <div className="flex flex-wrap gap-1 mb-2">{!answerLlm && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}>{ar ? 'معرفي' : 'knowledge'}</span>}{sources.map(s => <span key={s} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(16,185,129,0.12)', color: '#34d399' }}>{s}</span>)}</div>}
                <p className="text-[12px] whitespace-pre-line leading-relaxed" style={{ color: '#cbd5e1' }}>{answer}</p>
              </>
            ) : <p className="text-[11px] py-6 text-center" style={{ color: '#475569' }}>{ar ? 'اكتب سؤالك ليجاوبك من المعرفة المعتمدة' : 'Ask to get a knowledge-grounded answer'}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
