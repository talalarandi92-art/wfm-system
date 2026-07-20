/**
 * ④ HIRING VERDICT — the number the Director asked for ("وين أشوف كم واحد لازم
 * أوظف؟"): per-function needs / can-field / hire / surplus / worst-day with the
 * BINDING-constraint chip (peak vs coverage), plus the OT scenario lever that
 * trades hires for weekly overtime hours. All numbers from
 * GET /capacity/staffing/hiring-now — verified data only.
 */
import { UserPlus, Clock } from 'lucide-react';
import { nfmt, PAL, type HiringResp } from './kit';

function BindingChip({ v, ar }: { v: string | null | undefined; ar: boolean }) {
  const key = (v ?? 'none').toLowerCase();
  const meta = key === 'coverage'
    ? { color: PAL.warn, en: 'coverage', ar: 'تغطية', tipEn: 'binding: fielding enough bodies/day to cover the full hourly curve', tipAr: 'القيد الملزم: تنزيل أجسام كافية يوميًا لتغطية منحنى الساعات كاملاً' }
    : key === 'peak' || key === 'peak-gap'
      ? { color: PAL.risk, en: 'peak', ar: 'ذروة', tipEn: 'binding: the single heaviest hour vs the current team', tipAr: 'القيد الملزم: أثقل ساعة مقابل الفريق الحالي' }
      : { color: PAL.ok, en: '✓ none', ar: '✓ لا يوجد', tipEn: 'no binding constraint — the team covers both peak and coverage', tipAr: 'لا قيد ملزم — الفريق يغطي الذروة والتغطية' };
  return (
    <span className="text-[8.5px] font-black px-1.5 py-0.5 rounded-full whitespace-nowrap"
      title={ar ? meta.tipAr : meta.tipEn}
      style={{ background: `${meta.color}16`, color: meta.color }}>
      {ar ? meta.ar : meta.en}
    </span>
  );
}

export default function HiringSection({ ar, hiring, otPct, onOtPct }: {
  ar: boolean; hiring: HiringResp; otPct: number; onOtPct: (v: number) => void;
}) {
  const short = hiring.totalInternsToHire > 0;

  return (
    <div className="space-y-3">
      {/* verdict banner */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl px-3.5 py-3"
        style={{
          background: short ? `${PAL.risk}0e` : `${PAL.ok}0d`,
          border: `1.5px solid ${short ? PAL.risk + '55' : PAL.ok + '45'}`,
        }}>
        <div className="w-9 h-9 rounded-xl grid place-items-center flex-shrink-0"
          style={{ background: short ? `${PAL.risk}1c` : `${PAL.ok}1a` }}>
          <UserPlus size={17} style={{ color: short ? PAL.risk : PAL.ok }} />
        </div>
        <div className="min-w-0 flex-1" style={{ minWidth: 200 }}>
          <div className="font-black text-sm" style={{ color: 'var(--text-1)' }}>
            {ar
              ? (short ? `لازم توظف ${nfmt(hiring.totalInternsToHire)} إنترن لهالفترة` : 'فريقك الحالي كافي لهالفترة — لا توظيف مطلوب ✓')
              : (short ? `Hire ${nfmt(hiring.totalInternsToHire)} interns for this range` : 'Current team sufficient — no hiring needed ✓')}
          </div>
          <div className="text-[9.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            {hiring.from} → {hiring.to} · {ar ? `إنترن = ${hiring.internProductivity} وكيل` : `intern = ${hiring.internProductivity} agent`}
            {(hiring.totalSurplusBodies ?? 0) > 0 && (
              <span style={{ color: PAL.demand }}> · {ar ? `فائض ${nfmt(hiring.totalSurplusBodies)} جسم/يوم بفنكشنز ثانية` : `${nfmt(hiring.totalSurplusBodies)} surplus bodies/day in other functions`}</span>
            )}
          </div>
        </div>
        {short && (
          <div className="text-3xl font-black tabular-nums flex-shrink-0" style={{ color: PAL.risk, letterSpacing: '-.04em' }}>
            +{nfmt(hiring.totalInternsToHire)}
          </div>
        )}
      </div>

      {/* OT lever — trade hires for weekly overtime */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2"
        style={{ background: `${PAL.warn}0c`, border: `1px dashed ${PAL.warn}3d` }}>
        <span className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: PAL.warn }}>
          <Clock size={11} /> {ar ? `سيناريو الأوفرتايم: ${Math.round(otPct * 100)}%` : `Overtime scenario: ${Math.round(otPct * 100)}%`}
        </span>
        <input type="range" min={0} max={0.3} step={0.05} value={otPct}
          onChange={e => onOtPct(+e.target.value)} className="w-36 accent-amber-500" />
        {otPct > 0 ? (
          <>
            <span className="text-[10px] font-black tabular-nums" style={{ color: 'var(--text-1)' }}>
              {ar ? `مع الـOT: وظّف ${nfmt(hiring.totalInternsWithOt ?? null)}` : `with OT: hire ${nfmt(hiring.totalInternsWithOt ?? null)}`}
              <span className="font-normal" style={{ color: 'var(--text-3)' }}> ({ar ? 'بدل' : 'vs'} {nfmt(hiring.totalInternsToHire)})</span>
            </span>
            <span className="text-[10px] font-black tabular-nums" style={{ color: PAL.warn }}>
              ⏱ {nfmt(hiring.totalOtHoursWeekly ?? 0)} {ar ? 'ساعة OT/أسبوع' : 'OT h/week'}
            </span>
          </>
        ) : (
          <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>
            {ar ? 'حرّك المؤشر لتشوف كم إنترن يوفّر الأوفرتايم' : 'move the lever to see how many hires OT can absorb'}
          </span>
        )}
      </div>

      {/* per-function table */}
      <div style={{ overflowX: 'auto' }}>
        <table className="w-full text-[10px]" style={{ borderCollapse: 'collapse', minWidth: 620 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {[ar ? 'الفنكشن' : 'Function',
                ar ? 'القيد الملزم' : 'Binding',
                ar ? 'يحتاج (أجسام/يوم)' : 'Needs (bodies/day)',
                ar ? 'يقدر ينزّل / الفريق' : 'Can field / team',
                ar ? '⬅ توظف' : '⬅ Hire',
                ...(otPct > 0 ? [ar ? `مع OT ${Math.round(otPct * 100)}%` : `w/ OT ${Math.round(otPct * 100)}%`, ar ? 'ساعات OT/أسبوع' : 'OT h/wk'] : []),
                ar ? 'فائض' : 'Surplus',
                ar ? 'أثقل يوم' : 'Worst day'].map((h, i) => (
                <th key={i} className="px-2 py-1.5 font-bold whitespace-nowrap"
                  style={{ color: 'var(--text-3)', textAlign: i === 0 ? 'start' : 'center' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hiring.perFunction.map(f => (
              <tr key={f.functionKey} style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="px-2 py-2 font-bold whitespace-nowrap" style={{ color: 'var(--text-1)' }}
                  title={`${ar ? 'ذروة الساعة' : 'hour peak'} ${f.requiredPeak} HC`}>
                  {f.functionKey}
                </td>
                <td className="px-2 py-2 text-center"><BindingChip v={f.bindingConstraint} ar={ar} /></td>
                {/* Schedulable view (D-077): 9h shifts over the full hourly curve vs pool − 2 OFF/wk */}
                <td className="px-2 py-2 text-center font-bold tabular-nums" style={{ color: PAL.warn }}>{f.scheduleBodiesWorstDay ?? '—'}</td>
                <td className="px-2 py-2 text-center tabular-nums" style={{ color: 'var(--text-1)' }}>
                  {f.fieldablePerDay ?? '—'} <span style={{ color: 'var(--text-3)' }}>/ {f.currentTeam}</span>
                </td>
                <td className="px-2 py-2 text-center font-black tabular-nums" style={{ color: f.internsToHire > 0 ? PAL.risk : PAL.ok }}>
                  {f.internsToHire > 0 ? `+${f.internsToHire}` : '✓'}
                </td>
                {otPct > 0 && (
                  <>
                    <td className="px-2 py-2 text-center font-black tabular-nums" style={{ color: (f.internsWithOt ?? 0) > 0 ? '#fb923c' : PAL.ok }}>
                      {(f.internsWithOt ?? 0) > 0 ? `+${f.internsWithOt}` : '✓'}
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums" style={{ color: PAL.warn }}>{f.otHoursWeekly || '—'}</td>
                  </>
                )}
                <td className="px-2 py-2 text-center font-bold tabular-nums"
                  title={ar ? 'أجسام/يوم زيادة عن الحاجة' : 'bodies/day beyond the need'}
                  style={{ color: (f.surplusBodies ?? 0) > 0 ? PAL.demand : 'var(--text-3)' }}>
                  {(f.surplusBodies ?? 0) > 0 ? `+${f.surplusBodies}` : '—'}
                </td>
                <td className="px-2 py-2 text-center whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{f.worstDay ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[8.5px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
        {ar
          ? '«يحتاج» = أجسام/يوم بورديات 9 ساعات لتغطية منحنى الساعات كاملاً (شامل الشرينكج/الإنتاجية/النوافذ)؛ «يقدر ينزّل» = الفريق ناقص 2 OFF/أسبوع. التوظيف = القيد الأشد ÷ ' + String(hiring.internProductivity) + '. سيناريو الـOT يرفع قدرة الفريق (1+OT%) فيقلل التوظيف ويعرض ساعات الـOT الأسبوعية المستهلكة فعلاً. الفائض الأزرق = أجسام/يوم فوق الحاجة. لإيفنت بأرقامك أنت استخدم قالب الإكسل في قسم الضبط تحت.'
          : '"Needs" = bodies/day on 9h shifts covering the FULL hourly curve (incl. shrinkage/productivity/windows); "Can field" = team minus 2 OFF/week. Hire = binding gap ÷ ' + String(hiring.internProductivity) + '. The OT scenario scales team capacity by (1+OT%) — fewer hires, showing the weekly OT hours actually consumed. Blue surplus = bodies/day beyond the need. For an event with YOUR numbers use the Excel template in Tuning below.'}
      </div>
    </div>
  );
}
