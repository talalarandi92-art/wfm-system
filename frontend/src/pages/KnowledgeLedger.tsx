import { useState, useEffect, useCallback } from 'react';
import { ScrollText, Loader2, RefreshCw, GraduationCap, Telescope, Gift, BookMarked, Calendar } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';
import { BackToChief } from '@/components/BackToChief';

interface Entry {
  kind: 'expertise' | 'research'; id: string; category: string; status?: string;
  title: string; what: string; benefit: string; source: string; addedAt: string;
}
interface Ledger { total: number; expertise: number; research: number; entries: Entry[] }

export default function KnowledgeLedgerPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [data, setData] = useState<Ledger | null>(null);
  const [loading, setL] = useState(true);
  const [filter, setFilter] = useState<'all' | 'expertise' | 'research'>('all');

  const load = useCallback(async () => {
    setL(true);
    try { const { data } = await apiClient.get<Ledger>('/knowledge-ledger'); setData(data); } catch { setData(null); }
    setL(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const entries = data?.entries.filter(e => filter === 'all' || e.kind === filter) ?? [];

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      <BackToChief />
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.22)' }}>
            <ScrollText size={18} style={{ color: '#14b8a6' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'سجلّ المعرفة' : 'Knowledge Ledger'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'كل معرفة/خبرة بالنظام — شو هي، شو بتفيدك، ومن وين اكتسبها' : 'Every piece of knowledge — what it is, the benefit, and where it was acquired'}</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.25)', color: '#5eead4' }}>{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{ar ? 'تحديث' : 'Refresh'}</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : !data ? (
        <div className="text-center py-20" style={{ color: '#475569' }}><ScrollText size={32} className="mx-auto mb-3" style={{ color: '#334155' }} /><p className="text-sm">{ar ? 'تعذّر التحميل' : 'Could not load'}</p></div>
      ) : (
        <div className="space-y-4">
          {/* Summary + filter */}
          <div className="flex items-center gap-2 flex-wrap">
            {([['all', ar ? 'الكل' : 'All', data.total], ['expertise', ar ? 'خبرات' : 'Expertise', data.expertise], ['research', ar ? 'أبحاث' : 'Research', data.research]] as const).map(([k, l, n]) => (
              <button key={k} onClick={() => setFilter(k as any)} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl" style={{ background: filter === k ? 'rgba(20,184,166,0.18)' : 'rgba(255,255,255,0.03)', color: filter === k ? '#5eead4' : '#94a3b8', border: `1px solid ${filter === k ? 'rgba(20,184,166,0.3)' : 'transparent'}` }}>
                {k === 'expertise' ? <GraduationCap size={13} /> : k === 'research' ? <Telescope size={13} /> : <BookMarked size={13} />} {l} <span className="tabular-nums">{n}</span>
              </button>
            ))}
          </div>

          {/* Ledger entries */}
          <div className="space-y-2">
            {entries.map(e => (
              <div key={e.kind + e.id} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: e.kind === 'expertise' ? 'rgba(16,185,129,0.15)' : 'rgba(129,140,248,0.15)', color: e.kind === 'expertise' ? '#34d399' : '#a5b4fc' }}>{e.kind === 'expertise' ? (ar ? 'خبرة' : 'expertise') : (ar ? 'بحث' : 'research')}</span>
                  <span className="text-sm font-bold" style={{ color: tp(dark) }}>{e.title}</span>
                  <span className="flex items-center gap-1 text-[10px] ms-auto" style={{ color: '#64748b' }}><Calendar size={10} /> {e.addedAt}</span>
                </div>
                <p className="text-[11px] leading-relaxed mb-2" style={{ color: '#94a3b8' }}>{e.what}</p>
                <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
                  <div className="flex items-start gap-1.5 text-[11px] px-2 py-1.5 rounded-lg" style={{ background: 'rgba(34,197,94,0.06)' }}>
                    <Gift size={12} style={{ color: '#22c55e', flexShrink: 0, marginTop: 1 }} />
                    <span><span className="font-bold" style={{ color: '#22c55e' }}>{ar ? 'الفائدة: ' : 'Benefit: '}</span><span style={{ color: '#cbd5e1' }}>{e.benefit}</span></span>
                  </div>
                  <div className="flex items-start gap-1.5 text-[11px] px-2 py-1.5 rounded-lg" style={{ background: 'rgba(99,102,241,0.06)' }}>
                    <BookMarked size={12} style={{ color: '#818cf8', flexShrink: 0, marginTop: 1 }} />
                    <span><span className="font-bold" style={{ color: '#818cf8' }}>{ar ? 'المصدر: ' : 'Source: '}</span><span style={{ color: '#cbd5e1' }}>{e.source}</span></span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
