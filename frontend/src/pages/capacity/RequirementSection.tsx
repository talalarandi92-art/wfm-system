/**
 * ② REQUIREMENT — the function × 24h heatmap the schedule generator consumes,
 * with the credibility gem: click any cell → the full 7-step Erlang math
 * (volume → effective AHT → Erlangs → agents @ SL → occupancy → productivity
 * → shrinkage) exactly as the engine computed it. ⚡-ringed cells were raised
 * by the learned Sprinklr floor (never staff below measured load).
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, X, Zap, Info } from 'lucide-react';
import { nfmt, PAL, Awaiting, type HourReq, type ReqDay } from './kit';
import { readableOnWash } from '@/utils/format';

/* indigo→red heat ramp, zero = faint surface */
const heatRgb = (t: number): [number, number, number] =>
  [Math.round(99 + t * 140), Math.round(102 - t * 40), Math.round(241 - t * 130)];
const heatT = (v: number, max: number) => Math.min(v / Math.max(max, 1), 1);
const heat = (v: number, max: number): string => {
  if (v <= 0) return 'var(--surface-2)';
  const t = heatT(v, max);
  const [r, g, b] = heatRgb(t);
  return `rgba(${r}, ${g}, ${b}, ${0.25 + t * 0.65})`;
};
/* The cell is a TRANSLUCENT wash, so what the text actually sits on depends on the
   theme's surface underneath it — white was 2.49:1 on a pale cell and 3.36:1 on a
   hot one. While the wash is faint the surface dominates, so the theme's own text
   colour is correct in both themes; once it is opaque enough the hue dominates and
   the foreground can be derived from the hue itself. */
const heatText = (v: number, max: number): string => {
  if (v <= 0) return 'var(--text-2)';
  const t = heatT(v, max);
  const alpha = 0.25 + t * 0.65;
  if (alpha < 0.62) return 'var(--text-1)';
  const [r, g, b] = heatRgb(t);
  /* the wash, not the hue — the composite differs by theme (see readableOnWash) */
  return readableOnWash('#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join(''), alpha);
};

function MathModal({ ar, fn, h, onClose }: { ar: boolean; fn: string; h: HourReq; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  const steps: { label: string; value: string; final?: boolean }[] = [
    { label: ar ? 'الفوليوم المتوقع / ساعة' : 'Forecast volume / hour', value: nfmt(h.volume) },
    { label: ar ? 'AHT فعّال (كلام + هولد + ACW)' : 'Effective AHT (talk + hold + ACW)', value: `${nfmt(h.ahtEffSec)}s` },
    { label: ar ? 'الحمل Erlangs = فوليوم × AHT ÷ 3600' : 'Workload Erlangs = vol × AHT ÷ 3600', value: nfmt(h.erlangs) },
    { label: ar ? 'وكلاء متاحون — Erlang-C عند هدف SL وسقف الإشغال' : 'Agents AVAILABLE — Erlang-C @ SL target & occupancy cap', value: nfmt(h.agentsForSl) },
    { label: ar ? 'الإشغال عند هذا العدد' : 'Occupancy at that N', value: `${Math.round(h.occupancyAtN * 100)}%` },
    { label: ar ? 'بعد الإنتاجية (÷ إنتاجية)' : 'After productivity (÷ productivity)', value: nfmt(h.afterProductivity) },
    { label: ar ? 'المطلوب جدولته = ÷ (1 − شرينكج)' : 'SCHEDULED required = ÷ (1 − shrinkage)', value: nfmt(h.requiredScheduledHc), final: true },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl p-5" dir={ar ? 'rtl' : 'ltr'}
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }}
        onClick={e => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="font-black text-sm" style={{ color: 'var(--text-1)' }}>{fn}</span>
          <span className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-lg"
            style={{ background: `${PAL.require}1c`, color: PAL.require }}>
            {String(h.hour).padStart(2, '0')}:00–{String((h.hour + 1) % 24).padStart(2, '0')}:00
          </span>
          <button onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}
            className="ms-auto w-6 h-6 rounded-lg grid place-items-center"
            style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
            <X size={13} />
          </button>
        </div>
        <div className="text-[9.5px] mb-3" style={{ color: 'var(--text-3)' }}>
          {ar ? 'كل خطوة كما حسبها المحرك فعليًا — لا تقريب مخفي' : 'Every step exactly as the engine computed it — no hidden rounding'}
        </div>

        {/* the 7 steps */}
        <div className="space-y-0">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2.5 py-1.5 rounded-lg"
              style={s.final
                ? { background: `${PAL.warn}14`, margin: '6px -8px 0', padding: '8px 8px' }
                : { borderBottom: '1px dashed var(--border)' }}>
              <span className="grid place-items-center rounded-full text-[9px] font-black flex-shrink-0"
                style={{
                  width: 18, height: 18,
                  background: s.final ? PAL.warn : `${PAL.require}1c`,
                  color: s.final ? '#fff' : PAL.require,
                }}>
                {i + 1}
              </span>
              <span className="text-[11px] flex-1" style={{ color: s.final ? 'var(--text-1)' : 'var(--text-2)', fontWeight: s.final ? 800 : 400 }}>
                {s.label}
              </span>
              <span className="font-black tabular-nums" style={{ color: s.final ? PAL.warn : 'var(--text-1)', fontSize: s.final ? 17 : 12 }}>
                {s.value}
              </span>
            </div>
          ))}
        </div>

        {h.learned && (
          <div className="flex items-center gap-1.5 mt-3 text-[10px] rounded-lg px-2.5 py-1.5"
            style={{ background: `${PAL.learn}12`, color: PAL.learn }}>
            <Zap size={11} />
            {ar ? 'رُفعت هذه الخلية بالأرضية المتعلمة — الحمل المقاس من سبرينكلر أعلى من التوقع.'
                : 'This cell was raised by the learned floor — measured Sprinklr load exceeded the forecast.'}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RequirementSection({ ar, day, loading }: {
  ar: boolean; day: ReqDay | undefined; loading: boolean;
}) {
  const [drill, setDrill] = useState<{ fn: string; h: HourReq } | null>(null);

  const staffedFns = useMemo(
    () => (day?.functions ?? []).filter(f => f.dayContacts > 0 || f.dayTotalRequired > 0),
    [day]);
  const maxCell = useMemo(
    () => Math.max(1, ...staffedFns.flatMap(f => f.hours.map(h => h.requiredScheduledHc))),
    [staffedFns]);

  if (loading) {
    return <div className="flex items-center justify-center py-10"><Loader2 className="animate-spin" style={{ color: PAL.require }} /></div>;
  }
  if (!staffedFns.length) {
    return <Awaiting ar={ar}
      text="No volume data yet — upload contact volume first; the requirement appears as soon as demand exists."
      textAr="لا توجد بيانات فوليوم بعد — ارفع بيانات الكونتاكتس أولاً؛ المطلوب يظهر فور وجود طلب." />;
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 2, minWidth: 1000 }}>
          <thead>
            <tr>
              <th className="text-[9px] font-bold px-2" style={{ color: 'var(--text-3)', textAlign: 'start' }}>{ar ? 'الفنكشن' : 'Function'}</th>
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} className="text-[8px] font-bold tabular-nums" style={{ color: 'var(--text-3)', minWidth: 26 }}>{String(h).padStart(2, '0')}</th>
              ))}
              <th className="text-[9px] font-bold px-2" style={{ color: PAL.warn }}>{ar ? 'ذروة' : 'Peak'}</th>
            </tr>
          </thead>
          <tbody>
            {staffedFns.map(f => (
              <tr key={f.functionKey}>
                <td className="text-[10px] font-bold px-2 whitespace-nowrap" style={{ color: 'var(--text-1)' }}>
                  {f.functionKey}
                  <span className="text-[8px] font-normal ms-1 tabular-nums" style={{ color: 'var(--text-3)' }}>
                    {nfmt(f.dayContacts)}{ar ? ' كونتاكت' : ' contacts'}
                  </span>
                </td>
                {f.hours.map(h => (
                  <td key={h.hour}
                    onClick={() => setDrill({ fn: f.functionKey, h })}
                    className="text-center text-[10px] font-bold rounded cursor-pointer tabular-nums"
                    title={`${String(h.hour).padStart(2, '0')}:00 — ${ar ? 'فوليوم' : 'vol'} ${nfmt(h.volume)} · ${h.requiredScheduledHc} HC${h.learned ? (ar ? ' · ⚡ أرضية متعلمة' : ' · ⚡ learned floor') : ''} — ${ar ? 'اضغط للتفاصيل' : 'click for the math'}`}
                    style={{
                      background: heat(h.requiredScheduledHc, maxCell),
                      /* was: `> maxCell * 0.55 ? '#fff' : var(--text-1)` — the right idea,
                         but the switch to white happened at alpha 0.61, where the wash is
                         still translucent enough that the light surface dominates (white
                         measured 2.49:1 there). heatText() switches on the alpha instead. */
                      color: heatText(h.requiredScheduledHc, maxCell), height: 26,
                      boxShadow: h.learned ? `inset 0 0 0 1.5px ${PAL.learn}` : undefined,
                      transition: 'transform .1s',
                    }}>
                    {h.requiredScheduledHc || ''}
                  </td>
                ))}
                <td className="text-center text-[10px] font-black px-2 tabular-nums" style={{ color: PAL.warn }}>{f.dayTotalRequired}</td>
              </tr>
            ))}
            {/* total row = the generator's curve */}
            <tr>
              <td className="text-[10px] font-black px-2 pt-1.5" style={{ color: PAL.require, borderTop: '1px solid var(--border)' }}>
                {ar ? 'الإجمالي (منحنى المولّد)' : 'TOTAL (generator curve)'}
              </td>
              {Array.from({ length: 24 }, (_, h) => {
                const v = day?.totalCurve48?.[h * 2] ?? 0;
                return (
                  <td key={h} className="text-center text-[10px] font-black tabular-nums pt-1.5"
                    style={{ color: PAL.require, borderTop: '1px solid var(--border)' }}>{v || ''}</td>
                );
              })}
              <td className="text-center text-[10px] font-black px-2 pt-1.5 tabular-nums"
                style={{ color: PAL.require, borderTop: '1px solid var(--border)' }}>
                {Math.max(...(day?.totalCurve48 ?? [0]))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-4 mt-2 text-[9px]" style={{ color: 'var(--text-3)' }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-flex rounded overflow-hidden" style={{ height: 8 }}>
            {[0.15, 0.4, 0.65, 0.9].map(t => <span key={t} style={{ width: 12, background: heat(t * maxCell, maxCell) }} />)}
          </span>
          {ar ? `0 → ${maxCell} HC مطلوب` : `0 → ${maxCell} required HC`}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block rounded" style={{ width: 10, height: 10, boxShadow: `inset 0 0 0 1.5px ${PAL.learn}`, background: 'var(--surface-2)' }} />
          <Zap size={9} style={{ color: PAL.learn }} /> {ar ? 'رفعتها الأرضية المتعلمة (حمل مقاس)' : 'raised by the learned floor (measured load)'}
        </span>
        <span className="flex items-center gap-1 ms-auto"><Info size={10} /> {ar ? 'اضغط أي خلية لتفاصيل الحساب السبع خطوات' : 'click any cell for the full 7-step math'}</span>
      </div>

      {drill && <MathModal ar={ar} fn={drill.fn} h={drill.h} onClose={() => setDrill(null)} />}
    </div>
  );
}
