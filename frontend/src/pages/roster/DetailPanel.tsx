import { useState } from 'react';
import { Award, ListChecks, ChevronDown } from 'lucide-react';
import { RPAL, dur, adhHue } from './kit';

/**
 * Detailed breakdown — the per-person leaderboards + role/shift/function/TL
 * distributions from the original dashboard, kept intact behind a clean expander
 * so the story sections stay focused. Reads the dashboard rankings + distributions.
 */
export default function DetailPanel({ d, ar }: { d: any; ar: boolean }) {
  const [open, setOpen] = useState(false);

  const RANKS: { key: string; ar: string; en: string; fmt: (v: any) => string; color: string }[] = [
    { key: 'mostLate', ar: 'الأكثر تأخيراً', en: 'Most late', fmt: dur, color: RPAL.warn },
    { key: 'mostEarly', ar: 'الأكثر خروجاً مبكراً', en: 'Most early out', fmt: dur, color: RPAL.warn },
    { key: 'otAfter', ar: 'الأكثر OT بعد الشفت', en: 'Most OT after', fmt: dur, color: '#10b981' },
    { key: 'otBefore', ar: 'الأكثر OT قبل الشفت', en: 'Most OT before', fmt: dur, color: '#10b981' },
    { key: 'lowestConformance', ar: 'الأقل كونفورمانس', en: 'Lowest conformance', fmt: (v) => `${v}%`, color: RPAL.risk },
    { key: 'mostAbsent', ar: 'الأكثر غياباً', en: 'Most absent', fmt: (v) => `${v}`, color: RPAL.risk },
    { key: 'mostSick', ar: 'الأكثر سيك', en: 'Most sick', fmt: (v) => `${v}`, color: RPAL.sick },
    { key: 'mostPermissions', ar: 'الأكثر استئذاناً', en: 'Most permissions', fmt: (v) => `${v}`, color: RPAL.leave },
  ];

  return (
    <section className="rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 p-4" style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
        <div className="w-8 h-8 rounded-xl grid place-items-center flex-shrink-0" style={{ background: `${RPAL.brand}1c`, color: RPAL.brand }}><ListChecks size={16} strokeWidth={2.2} /></div>
        <div className="flex-1 text-start min-w-0">
          <div className="font-extrabold text-[13px]" style={{ color: 'var(--text-1)' }}>{ar ? 'التفصيل الكامل — لكل شخص والتوزيعات' : 'Detailed breakdown — per-person & distributions'}</div>
          <div className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>{ar ? 'المتصدرون (تأخير/OT/غياب/استئذان) + التوزيع حسب الدور/الشفت/الفنكشن/التيم ليدر' : 'Leaderboards (late / OT / absence / permissions) + role / shift / function / TL distributions'}</div>
        </div>
        <ChevronDown size={18} style={{ color: 'var(--text-3)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* rankings */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            {RANKS.map(rk => {
              const list = d.rankings?.[rk.key] || [];
              return (
                <div key={rk.key} className="rounded-2xl p-3.5" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-1.5 mb-2.5"><Award size={13} style={{ color: rk.color }} /><h3 className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>{ar ? rk.ar : rk.en}</h3></div>
                  <div className="space-y-1.5">
                    {list.length === 0 && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>—</p>}
                    {list.slice(0, 8).map((a: any, i: number) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[10px] w-3" style={{ color: 'var(--text-3)' }}>{i + 1}</span>
                        <div className="flex-1 min-w-0"><p className="text-[11px] font-medium truncate" style={{ color: 'var(--text-1)' }}>{a.name}</p>
                          <p className="text-[9px] truncate" style={{ color: 'var(--text-3)' }}>{a.function_name || '—'}{a.team_manager ? ` · ${a.team_manager}` : ''}</p></div>
                        <span className="text-[11px] font-bold flex-shrink-0" style={{ color: rk.color }}>{rk.fmt(a.v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* distributions */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            {([['byRole', ar ? 'حسب الدور' : 'By role'], ['byShift', ar ? 'حسب الشفت' : 'By shift'], ['byFunction', ar ? 'حسب الفنكشن' : 'By function'], ['byTeamManager', ar ? 'حسب التيم ليدر' : 'By team leader']] as [string, string][]).map(([key, title]) => {
              const list = d.distributions?.[key] || []; const max = Math.max(...list.map((x: any) => x.n), 1);
              return (
                <div key={key} className="rounded-2xl p-3.5" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <h3 className="text-xs font-bold mb-2.5" style={{ color: 'var(--text-1)' }}>{title}</h3>
                  <div className="space-y-1.5">
                    {list.slice(0, 12).map((x: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-[11px]">
                        <span className="w-24 truncate" style={{ color: 'var(--text-2)' }} title={x.k}>{x.k}</span>
                        <div className="flex-1 h-3.5 rounded overflow-hidden" style={{ background: 'var(--border)' }}>
                          <div className="h-full rounded" style={{ width: `${Math.max(4, 100 * x.n / max)}%`, background: `linear-gradient(90deg,${RPAL.brand}cc,${RPAL.leave}77)` }} /></div>
                        <span className="font-semibold w-8 text-end" style={{ color: 'var(--text-1)' }}>{x.n}</span>
                        <span className="w-12 text-end" style={{ color: adhHue(x.conformance) }}>{x.conformance != null ? x.conformance + '%' : '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
