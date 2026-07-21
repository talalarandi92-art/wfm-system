import { useMemo } from 'react';
import { TrendingUp, ArrowUp, ArrowDown } from 'lucide-react';
import { Sparkline } from '@/components/dazzle';
import { Section, Awaiting, useMaybe, RPAL, nfmt, toHrs } from './kit';

/**
 * §4 — Trends. Month-over-month movement of the roster KPIs so the range's numbers
 * gain context. Reads GET roster-v2/trends?months=6 (interval=month); reads the
 * response shape defensively (points / data / trends) and graceful-hides on 404.
 */
export default function TrendsPanel({ functionName, ar, h }: { functionName?: string; ar: boolean; h: string }) {
  const qs = new URLSearchParams({ interval: 'month', months: '6' });
  if (functionName) qs.set('function', functionName);
  const res = useMaybe<any>(`/attendance-recon/roster-v2/trends?${qs.toString()}`);

  const points: any[] = useMemo(() => {
    if (res.status !== 'live') return [];
    const raw = res.data;
    const arr = Array.isArray(raw?.points) ? raw.points
      : Array.isArray(raw?.data) ? raw.data
      : Array.isArray(raw?.trends) ? raw.trends
      : Array.isArray(raw) ? raw : [];
    return arr.slice(-8);
  }, [res]);

  // KPI series — [key, label, colour, formatter, higher-is-better]
  const KPIS: { key: string; en: string; ar: string; color: string; fmt: (n: number) => string; good: 'up' | 'down'; map?: (v: number) => number }[] = [
    { key: 'conf', en: 'Conformance', ar: 'كونفورمانس', color: RPAL.brand, fmt: n => `${nfmt(n)}%`, good: 'up' },
    { key: 'otmin', en: 'Total OT', ar: 'إجمالي OT', color: RPAL.ot, fmt: n => `${nfmt(n)}${h}`, good: 'down', map: toHrs },
    { key: 'latedays', en: 'Late days', ar: 'أيام تأخير', color: '#fb923c', fmt: n => nfmt(n), good: 'down' },
    { key: 'absent', en: 'Absence', ar: 'غياب', color: RPAL.absent, fmt: n => nfmt(n), good: 'down' },
    { key: 'worked', en: 'Worked days', ar: 'أيام عمل', color: RPAL.office, fmt: n => nfmt(n), good: 'up' },
  ];

  return (
    <Section no={ar ? '٤' : '4'} icon={TrendingUp} color={RPAL.brand}
      title={ar ? 'الاتجاهات الشهرية' : 'Monthly trends'}
      desc={ar ? 'حركة المؤشرات شهرًا بشهر — لإعطاء أرقام الفترة سياقًا' : 'Month-over-month KPI movement — context for the range'}>
      {res.status === 'loading' && <Awaiting ar={ar} text="Loading trends…" textAr="جارٍ تحميل الاتجاهات…" />}
      {res.status === 'missing' && <Awaiting ar={ar} text="Trends endpoint not available yet." textAr="واجهة الاتجاهات غير متاحة بعد." />}
      {res.status === 'live' && points.length < 2 && (
        <Awaiting ar={ar} text="Not enough months for a trend yet." textAr="لا توجد أشهر كافية لرسم اتجاه بعد." />
      )}
      {res.status === 'live' && points.length >= 2 && (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))' }}>
          {KPIS.map(k => {
            const series = points.map(p => { const raw = Number(p?.[k.key] || 0); return k.map ? k.map(raw) : raw; });
            const last = series[series.length - 1], prev = series[series.length - 2];
            const delta = last - prev;
            const improved = k.good === 'up' ? delta >= 0 : delta <= 0;
            const dcolor = delta === 0 ? RPAL.neutral : improved ? RPAL.ok : RPAL.risk;
            return (
              <div key={k.key} className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{ar ? k.ar : k.en}</span>
                  {delta !== 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold" style={{ color: dcolor }}>
                      {delta > 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}{k.fmt(Math.abs(delta))}
                    </span>
                  )}
                </div>
                <div className="text-xl font-extrabold leading-none mb-1.5" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{k.fmt(last)}</div>
                <Sparkline data={series} color={k.color} height={30} />
                <div className="text-[9.5px] mt-1 text-end" style={{ color: 'var(--text-3)' }}>
                  {points[0]?.label} → {points[points.length - 1]?.label}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
