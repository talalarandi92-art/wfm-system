import { useState } from 'react';
import { MessageSquareReply, Loader2, Sparkles, Copy, Check, BookOpen } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsC, useInjectDsStyles } from '@/components/ds';
import { BackToChief } from '@/components/BackToChief';

interface Match { category: string; en: string; ar: string; source: string; score: number }
interface Article { id: string; title: string; category: string; excerpt: string; body?: string; score: number }
interface SuggestRes { mode: string; llmConfigured: boolean; generated: string | null; model?: string | null; matches: Match[]; articles?: Article[] }
type View = 'all' | 'scripts' | 'articles';

export default function ReplyHelperPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [text, setText] = useState('');
  const [res, setRes] = useState<SuggestRes | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string>('');
  const [view, setView] = useState<View>('all');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // theme-aware tokens
  const T = tp(dark);                         // primary text
  const M = tsC(dark);                        // muted text
  const cardBg = dark ? 'rgba(255,255,255,0.035)' : '#ffffff';
  const cardBd = dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.10)';
  const softBd = dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)';

  const suggest = async () => {
    if (!text.trim() || loading) return;
    setLoading(true); setRes(null); setExpanded(new Set());
    try {
      const { data } = await apiClient.post<SuggestRes>('/knowledge-base/suggest-reply', { text });
      setRes(data);
    } catch { setRes({ mode: 'local', llmConfigured: false, generated: null, matches: [], articles: [] }); }
    finally { setLoading(false); }
  };

  const copy = (val: string, key: string) => {
    navigator.clipboard?.writeText(val).catch(() => {});
    setCopied(key); setTimeout(() => setCopied(''), 1500);
  };

  const CopyBtn = ({ val, k }: { val: string; k: string }) => (
    <button onClick={() => copy(val, k)} title={ar ? 'نسخ' : 'Copy'}
      className="flex-shrink-0 p-1.5 rounded-lg transition-all" style={{ background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)' }}>
      {copied === k ? <Check size={14} style={{ color: '#10b981' }} /> : <Copy size={14} style={{ color: M }} />}
    </button>
  );

  return (
    <div className="space-y-4">
      <BackToChief />

      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(20,184,166,0.15)' }}>
          <MessageSquareReply size={18} style={{ color: '#14b8a6' }} />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: T }}>{ar ? 'مساعد المعرفة والرد' : 'KB & Reply Assistant'}</h1>
          <p className="text-xs" style={{ color: M }}>{ar ? 'اسأل عن أي شي — يطلّعلك سكربت الرد + السياسة وشرحها' : 'Ask anything — get the reply script + the policy and its explanation'}</p>
        </div>
      </div>

      {/* Input */}
      <div className="rounded-2xl p-4" style={{ background: cardBg, border: cardBd }}>
        <textarea value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) suggest(); }}
          placeholder={ar ? 'مثال: سياسة الاستبدال / وين طلبي ما وصل؟ / كيف أستخدم تابي؟' : 'e.g. exchange policy / where is my order? / how to use Tabby?'}
          dir="auto" rows={4}
          className="w-full bg-transparent text-sm outline-none resize-y" style={{ color: T }} />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px]" style={{ color: M }}>{ar ? 'Ctrl+Enter للبحث' : 'Ctrl+Enter to search'}</span>
          <button onClick={suggest} disabled={loading || !text.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white transition-all"
            style={{ background: 'linear-gradient(135deg,#0d9488,#14b8a6)', opacity: loading || !text.trim() ? 0.5 : 1 }}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {ar ? 'اسأل' : 'Ask'}
          </button>
        </div>
      </div>

      {res !== null && (
        (res.matches.length === 0 && !(res.articles || []).length && !res.generated) ? (
          <div className="text-center py-10 text-sm" style={{ color: M }}>
            {ar ? 'ما لقيت نتيجة — جرّب صياغة أوضح أو كلمات مفتاحية' : 'No result — try clearer wording or keywords'}
          </div>
        ) : (
          <div className="space-y-3">
            {/* View toggle: Both / Scripts / Articles */}
            {(res.matches.length > 0 || (res.articles || []).length > 0) && (
              <div className="flex items-center gap-1.5">
                {([['all', ar ? 'الكل' : 'Both'], ['scripts', ar ? '💬 سكربتات' : '💬 Scripts'], ['articles', ar ? '📘 مقالات' : '📘 Articles']] as [View, string][]).map(([v, label]) => (
                  <button key={v} onClick={() => setView(v)}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all"
                    style={view === v
                      ? { background: 'rgba(20,184,166,0.18)', color: '#14b8a6', border: '1px solid rgba(20,184,166,0.35)' }
                      : { background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)', color: M, border: `1px solid ${softBd}` }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {/* AI-composed answer (hybrid: weak local match + LLM enabled) */}
            {res.generated && (
              <div className="rounded-2xl p-4" style={{ background: dark ? 'linear-gradient(135deg,rgba(20,184,166,0.12),rgba(99,102,241,0.10))' : 'linear-gradient(135deg,rgba(20,184,166,0.10),rgba(99,102,241,0.07))', border: '1px solid rgba(20,184,166,0.35)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={14} style={{ color: '#14b8a6' }} />
                  <span className="text-xs font-bold" style={{ color: T }}>{ar ? 'الإجابة المقترحة (ذكاء اصطناعي)' : 'AI-composed answer'}</span>
                  {res.model && <span className="text-[9px]" style={{ color: M }}>{res.model}</span>}
                </div>
                <div className="flex items-start gap-2">
                  <p dir="auto" className="flex-1 text-sm leading-relaxed whitespace-pre-wrap" style={{ color: T }}>{res.generated}</p>
                  <CopyBtn val={res.generated} k="gen" />
                </div>
              </div>
            )}
            {!res.generated && res.mode === 'local-weak' && !res.llmConfigured && (res.articles || []).length === 0 && (
              <div className="text-[11px] px-1" style={{ color: '#d97706' }}>
                {ar ? '💡 تطابق ضعيف — فعّل مفتاح الـLLM لإجابات محادثة أذكى (هجين).' : '💡 Weak match — enable the LLM key for smarter conversational answers.'}
              </div>
            )}

            {/* Reply scripts */}
            {view !== 'articles' && res.matches.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: M }}>{ar ? '💬 سكربتات الرد' : '💬 Reply scripts'}</p>
                {res.matches.map((m, i) => (
                  <div key={i} className="rounded-2xl p-4" style={{ background: cardBg, border: `1px solid ${i === 0 && !res.generated ? 'rgba(20,184,166,0.3)' : softBd}` }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(20,184,166,0.15)', color: '#14b8a6' }}>{m.category}</span>
                      <span className="text-[9px] uppercase" style={{ color: M }}>{m.source}</span>
                    </div>
                    {m.ar && (
                      <div className="flex items-start gap-2 mb-2">
                        <p dir="rtl" className="flex-1 text-sm leading-relaxed" style={{ color: T, textAlign: 'right' }}>{m.ar}</p>
                        <CopyBtn val={m.ar} k={`ar${i}`} />
                      </div>
                    )}
                    {m.en && (
                      <div className="flex items-start gap-2 pt-2" style={{ borderTop: m.ar ? `1px solid ${softBd}` : 'none' }}>
                        <p dir="ltr" className="flex-1 text-[13px] leading-relaxed" style={{ color: dark ? '#cbd5e1' : '#334155' }}>{m.en}</p>
                        <CopyBtn val={m.en} k={`en${i}`} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* KB policy / info — expandable to full text */}
            {view !== 'scripts' && (res.articles || []).length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: M }}>{ar ? '📘 السياسة / المعلومة (من قاعدة المعرفة)' : '📘 Policy / info (from KB)'}</p>
                {(res.articles || []).map((a, i) => {
                  const isOpen = expanded.has(i);
                  const full = (a.body || a.excerpt || '').trim();
                  const txtColor = dark ? '#cbd5e1' : '#334155';
                  return (
                    <div key={i} className="rounded-2xl p-4" style={{ background: cardBg, border: cardBd }}>
                      <div className="flex items-center gap-2 mb-2">
                        <BookOpen size={13} style={{ color: '#6366f1' }} />
                        <span className="text-sm font-bold flex-1" style={{ color: T }}>{a.title}</span>
                        {a.category && <span className="text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: 'rgba(99,102,241,0.14)', color: '#818cf8' }}>{a.category}</span>}
                        <CopyBtn val={full} k={`art${i}`} />
                      </div>
                      <p dir="auto" className="text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{
                        color: txtColor,
                        ...(isOpen ? {} : { display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
                      }}>{full}</p>
                      {(full.length > 240) && (
                        <button onClick={() => setExpanded(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                          className="mt-2 text-[11px] font-bold flex items-center gap-1" style={{ color: '#6366f1' }}>
                          {isOpen ? (ar ? 'إخفاء ⌃' : 'Show less ⌃') : (ar ? 'اعرض الكامل ⌄' : 'Show full ⌄')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
