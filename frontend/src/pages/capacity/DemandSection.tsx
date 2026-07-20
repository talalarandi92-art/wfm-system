/**
 * ① DEMAND FORECAST — where the story starts: how much work is coming.
 * Per-function 24h volume curves (small multiples with peak-hour callout),
 * measured-AHT chips, the last orders period, and the orders scenario slider
 * (the ×N lever that re-scales the whole downstream chain).
 */
import { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { Sparkline } from '@/components/dazzle';
import { nfmt, PAL, Awaiting, type ReqDay, type ReqResp } from './kit';

const MODEL_LABEL: Record<string, { en: string; ar: string }> = {
  erlang:      { en: 'Erlang-C',   ar: 'Erlang-C' },
  concurrency: { en: 'concurrent', ar: 'تزامن' },
  backlog:     { en: 'backlog',    ar: 'باكلوج' },
};

export default function DemandSection({ ar, req, day, ordersScale, onOrdersScale }: {
  ar: boolean;
  req: ReqResp | null;
  day: ReqDay | undefined;
  ordersScale: number;
  onOrdersScale: (v: number) => void;
}) {
  const fns = useMemo(
    () => (day?.functions ?? [])
      .filter(f => f.dayContacts > 0)
      .sort((a, b) => b.dayContacts - a.dayContacts),
    [day]);

  const ahtChips = Object.entries(req?.measuredAht ?? {});

  return (
    <div className="space-y-3">
      {/* the scenario lever + the demand facts */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
            {ar ? 'سيناريو الطلبات' : 'Orders scenario'}
          </span>
          <input type="range" min={0.5} max={2} step={0.05} value={ordersScale}
            onChange={e => onOrdersScale(+e.target.value)} className="w-40 accent-sky-500" />
          <span className="text-[11px] font-black tabular-nums px-2 py-0.5 rounded-lg"
            style={{ background: ordersScale === 1 ? 'var(--surface-2)' : `${PAL.demand}1c`, color: ordersScale === 1 ? 'var(--text-3)' : PAL.demand }}>
            ×{ordersScale.toFixed(2)}
          </span>
          {ordersScale !== 1 && (
            <button onClick={() => onOrdersScale(1)} className="text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
              {ar ? 'إرجاع' : 'reset'}
            </button>
          )}
        </div>
        {req?.ordersPeriod && (
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
            {ar ? 'آخر فترة طلبات' : 'last orders period'} <b style={{ color: 'var(--text-1)' }}>{req.ordersPeriod.period_label}</b>:{' '}
            <b className="tabular-nums" style={{ color: PAL.demand }}>{nfmt(req.ordersPeriod.count)}</b> {ar ? 'طلب' : 'orders'}
          </span>
        )}
        <div className="flex flex-wrap gap-1.5 ms-auto">
          {ahtChips.length > 0 ? ahtChips.map(([ch, v]) => (
            <span key={ch} className="text-[9px] px-2 py-0.5 rounded-full font-bold tabular-nums"
              style={{ background: `${PAL.require}18`, color: PAL.require }}
              title={ar ? 'AHT مقاس من آخر 28 يوم' : 'AHT measured from the last 28 days'}>
              {ch} · AHT {nfmt(v)}s
            </span>
          )) : (
            <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
              {ar ? 'AHT المقاس لكل قناة — بانتظار إحصائيات المعالجة' : 'measured AHT per channel — awaiting handle stats'}
            </span>
          )}
        </div>
      </div>

      {/* per-function volume curves — small multiples */}
      {!fns.length ? (
        <Awaiting ar={ar}
          text="No forecast volume for this day — the demand model needs contact history (ops_contacts)."
          textAr="لا يوجد فوليوم متوقع لهذا اليوم — نموذج الطلب يحتاج تاريخ الكونتاكتس." />
      ) : (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {fns.map(f => {
            const curve = f.hours.map(h => h.volume);
            const peakIdx = curve.reduce((bi, v, i) => (v > curve[bi] ? i : bi), 0);
            const model = MODEL_LABEL[f.model] ?? { en: f.model, ar: f.model };
            return (
              <div key={f.functionKey} className="rounded-xl p-3"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="font-bold text-[11px] truncate" style={{ color: 'var(--text-1)' }}>{f.functionKey}</span>
                  <span className="text-[8px] font-bold px-1.5 py-px rounded-full ms-auto flex-shrink-0"
                    style={{ background: `${PAL.require}15`, color: PAL.require }}>
                    {ar ? model.ar : model.en}
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-extrabold tabular-nums" style={{ color: PAL.demand, letterSpacing: '-.03em' }}>
                    {nfmt(f.dayContacts)}
                  </span>
                  <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>{ar ? 'كونتاكت' : 'contacts'}</span>
                  <span className="text-[9px] tabular-nums ms-auto flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}
                    title={ar ? 'ساعة الذروة' : 'peak hour'}>
                    <TrendingUp size={9} /> {String(peakIdx).padStart(2, '0')}:00
                  </span>
                </div>
                <div className="mt-1.5 -mx-1"><Sparkline data={curve} color={PAL.demand} height={30} /></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
