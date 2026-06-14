import { useState, useEffect, useCallback } from 'react';
import { Telescope, Loader2, RefreshCw, CheckCircle2, AlertCircle, XCircle, Sparkles } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

interface Item { id: string; category: string; titleAr: string; summaryAr: string; status: 'have' | 'partial' | 'missing'; actionAr: string }
interface Feed { total: number; gaps: number; items: Item[]; byCategory: { category: string; items: Item[] }[] }

const ST = {
  have: { color: '#22c55e', Icon: CheckCircle2, ar: 'موجود' },
  partial: { color: '#f59e0b', Icon: AlertCircle, ar: 'جزئي' },
  missing: { color: '#ef4444', Icon: XCircle, ar: 'ناقص' },
} as const;

export default function ResearcherPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [feed, setFeed] = useState<Feed | null>(null);
  const [digest, setDigest] = useState('');
  const [digestLlm, setDigestLlm] = useState(false);
  const [loading, setL] = useState(true);

  const load = useCallback(async () => {
    setL(true);
    try {
      const [{ data: f }, { data: d }] = await Promise.all([apiClient.get<Feed>('/researcher/feed'), apiClient.get('/researcher/digest')]);
      setFeed(f); setDigest(d.digest); setDigestLlm(d.llm);
    } catch { setFeed(null); }
    setL(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.22)' }}>
            <Telescope size={18} style={{ color: '#818cf8' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'الباحث' : 'Researcher'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'يرصد أحدث ممارسات WFM ويقارنها بمنصّتنا — ويعطي الفريق الفائدة' : 'Scouts the latest WFM practices vs our platform — brings the team the benefit'}</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', color: '#a5b4fc' }}>{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{ar ? 'تحديث' : 'Refresh'}</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : !feed ? (
        <div className="text-center py-20" style={{ color: '#475569' }}><Telescope size={32} className="mx-auto mb-3" style={{ color: '#334155' }} /><p className="text-sm">{ar ? 'تعذّر التحميل' : 'Could not load'}</p></div>
      ) : (
        <div className="space-y-4">
          {/* Digest */}
          <div className="rounded-2xl p-4" style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)' }}>
            <div className="flex items-center gap-2 mb-2"><Sparkles size={14} style={{ color: '#818cf8' }} /><span className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? 'أهم فرص التطوير' : 'Top opportunities'}</span>{!digestLlm && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}>{ar ? 'بحث منسّق' : 'curated'}</span>}<span className="text-[11px] ms-auto" style={{ color: '#f87171' }}>{feed.gaps} {ar ? 'فجوة' : 'gaps'}</span></div>
            <p className="text-[12px] whitespace-pre-line leading-relaxed" style={{ color: '#cbd5e1' }}>{digest}</p>
          </div>

          {/* By category */}
          {feed.byCategory.map(cat => (
            <div key={cat.category}>
              <h2 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>{cat.category}</h2>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' }}>
                {cat.items.map(it => {
                  const s = ST[it.status];
                  return (
                    <div key={it.id} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${s.color}22` }}>
                      <div className="flex items-center gap-2 mb-1">
                        <s.Icon size={13} style={{ color: s.color, flexShrink: 0 }} />
                        <span className="text-xs font-bold" style={{ color: tp(dark) }}>{it.titleAr}</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded ms-auto" style={{ background: `${s.color}1a`, color: s.color }}>{s.ar}</span>
                      </div>
                      <p className="text-[11px] leading-snug" style={{ color: '#94a3b8' }}>{it.summaryAr}</p>
                      {it.status !== 'have' && <p className="text-[11px] mt-1.5 font-semibold" style={{ color: s.color }}>↳ {it.actionAr}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
