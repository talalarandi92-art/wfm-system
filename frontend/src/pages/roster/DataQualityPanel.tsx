import { useMemo } from 'react';
import { ShieldCheck, Info } from 'lucide-react';
import { Gauge } from '@/components/dazzle';
import { Section, Awaiting, RPAL, nfmt, type Maybe } from './kit';

/* ── Defensive reader for GET roster-v2/data-quality (parallel backend agent) ──
 * The endpoint isn't deployed yet, so its exact field names are read tolerantly
 * and the hero + this panel both consume the SAME normalized shape. */
export interface DataQuality {
  cleanPct: number | null;
  totalDays: number | null;
  flaggedDays: number | null;
  categories: { label: string; count: number }[];
  topFlagged: { name: string; personNo?: string; date?: string; fn?: string; reason: string }[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && !Number.isNaN(v) ? v : null);

export function readDataQuality(raw: any): DataQuality | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw.quality && typeof raw.quality === 'object' ? raw.quality : (raw.summary && typeof raw.summary === 'object' ? { ...raw, ...raw.summary } : raw);
  const cleanPct = num(src.cleanPct) ?? num(src.clean_pct) ?? num(src.cleanPercent) ?? num(src.pctClean);
  const totalDays = num(src.totalDays) ?? num(src.total) ?? num(src.days) ?? num(src.records);
  const flaggedDays = num(src.flaggedDays) ?? num(src.flagged) ?? num(src.flaggedCount);
  const catRaw: any[] = Array.isArray(raw.categories) ? raw.categories
    : Array.isArray(raw.flagCategories) ? raw.flagCategories
    : Array.isArray(raw.byCategory) ? raw.byCategory
    : Array.isArray(src.categories) ? src.categories : [];
  const categories = catRaw
    .map(c => ({ label: String(c.label ?? c.category ?? c.key ?? c.name ?? '—'), count: num(c.count) ?? num(c.n) ?? num(c.days) ?? 0 }))
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count);
  const topRaw: any[] = Array.isArray(raw.topFlagged) ? raw.topFlagged
    : Array.isArray(raw.topOffenders) ? raw.topOffenders
    : Array.isArray(raw.topPersonDays) ? raw.topPersonDays
    : Array.isArray(raw.items) ? raw.items
    : Array.isArray(raw.rows) ? raw.rows : [];
  const topFlagged = topRaw.map(r => ({
    name: String(r.name ?? r.clean_name ?? r.person ?? r.personNo ?? r.person_no ?? '—'),
    personNo: r.person_no != null ? String(r.person_no) : r.personNo != null ? String(r.personNo) : undefined,
    date: r.date ?? r.work_date ?? undefined,
    fn: r.fn ?? r.function ?? r.role_function ?? r.functionName ?? undefined,
    reason: String(r.reason ?? r.category ?? r.flag ?? r.flags ?? r.issue ?? '—'),
  }));
  if (cleanPct == null && !categories.length && !topFlagged.length) return null;
  return { cleanPct, totalDays, flaggedDays, categories, topFlagged };
}

/**
 * §5 — Data quality. An HONEST clean-% read of the reconciliation: how many
 * roster-days survived the integrity checks vs. how many carry a flag, split by
 * flag category, with the worst person-days surfaced for REVIEW (never HR action).
 * Reads GET roster-v2/data-quality (graceful-hide until the parallel agent lands).
 */
export default function DataQualityPanel({ res, ar }: { res: Maybe<any>; ar: boolean }) {
  const dq = useMemo(() => (res.status === 'live' ? readDataQuality(res.data) : null), [res]);
  const catMax = useMemo(() => Math.max(1, ...(dq?.categories || []).map(c => c.count)), [dq]);

  return (
    <Section no={ar ? '٥' : '5'} icon={ShieldCheck} color={dq?.cleanPct != null ? (dq.cleanPct >= 95 ? RPAL.ok : dq.cleanPct >= 85 ? RPAL.warn : RPAL.risk) : RPAL.neutral}
      title={ar ? 'جودة البيانات' : 'Data quality'}
      desc={ar ? 'نسبة الأيام النظيفة + فئات الأعلام + أعلى أيام للمراجعة (ليست إجراءً على الموظف)'
              : 'Clean-day % + flag categories + top person-days to REVIEW (not an HR action)'}>
      {res.status === 'loading' && <Awaiting ar={ar} text="Loading data-quality…" textAr="جارٍ تحميل جودة البيانات…" />}
      {(res.status === 'missing' || (res.status === 'live' && !dq)) && (
        <Awaiting ar={ar}
          text="Data-quality analysis endpoint is being wired up — this panel lights up once it lands."
          textAr="واجهة تحليل جودة البيانات قيد الربط — ستظهر هذه اللوحة فور توفرها." />
      )}
      {res.status === 'live' && dq && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(150px,180px) 1fr' }}>
          {/* clean gauge */}
          <div className="rounded-xl grid place-items-center py-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <Gauge value={dq.cleanPct ?? 0} label={ar ? 'أيام نظيفة' : 'Clean days'} color={dq.cleanPct != null && dq.cleanPct >= 95 ? RPAL.ok : dq.cleanPct != null && dq.cleanPct >= 85 ? RPAL.warn : RPAL.risk} size={140}
              sub={dq.flaggedDays != null && dq.totalDays != null ? <span>{nfmt(dq.flaggedDays)}/{nfmt(dq.totalDays)} {ar ? 'معلَّم' : 'flagged'}</span> : undefined} />
          </div>

          {/* categories + top flagged */}
          <div className="flex flex-col gap-3">
            {dq.categories.length > 0 && (
              <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div className="text-[10.5px] font-bold uppercase tracking-wide mb-2.5" style={{ color: 'var(--text-3)' }}>{ar ? 'فئات الأعلام' : 'Flag categories'}</div>
                <div className="space-y-2">
                  {dq.categories.slice(0, 8).map((c, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <span className="text-[11px] truncate" style={{ width: 150, color: 'var(--text-2)' }} title={c.label}>{c.label}</span>
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.max(3, (100 * c.count) / catMax)}%`, background: RPAL.warn, transition: 'width .8s cubic-bezier(.4,0,.2,1)' }} />
                      </div>
                      <span className="text-[11px] font-bold text-end" style={{ width: 44, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{nfmt(c.count)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {dq.topFlagged.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div className="px-3 pt-2.5 pb-2 flex items-center gap-2">
                  <Info size={12} style={{ color: RPAL.brand }} />
                  <span className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{ar ? 'أعلى أيام للمراجعة' : 'Top person-days to review'}</span>
                </div>
                <div className="overflow-auto" style={{ maxHeight: 220 }}>
                  <table className="w-full text-[11px]">
                    <tbody>
                      {dq.topFlagged.slice(0, 12).map((r, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                          <td className="px-3 py-1.5 font-medium whitespace-nowrap" style={{ color: 'var(--text-1)' }}>{r.name}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{r.fn || ''}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-center" style={{ color: 'var(--text-2)' }}>{r.date || ''}</td>
                          <td className="px-3 py-1.5 text-end" style={{ color: RPAL.warn }}>{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
