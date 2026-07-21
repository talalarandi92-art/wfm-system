import { useMemo } from 'react';
import { Timer, AlertTriangle } from 'lucide-react';
import { Donut } from '@/components/dazzle';
import { Section, Awaiting, useMaybe, RPAL, nfmt } from './kit';

/**
 * §3 — Overtime. TRUE_OT is three DISJOINT buckets (BR-OT-001): regular workday +
 * off-day + public-holiday = total. Regular OT further splits into before-/after-
 * shift. Before/after-shift OT that is reserved/uncertain stays flagged for REVIEW
 * (not auto-paid). Reads the existing GET roster-v2/ot-exceptions (graceful-hide on 404).
 */
export default function OvertimePanel({ from, to, functionName, teamManager, ar, h }: {
  from: string; to: string; functionName?: string; teamManager?: string; ar: boolean; h: string;
}) {
  const qs = new URLSearchParams({ from, to });
  if (functionName) qs.set('function', functionName);
  if (teamManager) qs.set('teamLeader', teamManager);
  const res = useMaybe<any>(`/attendance-recon/roster-v2/ot-exceptions?${qs.toString()}`);

  const O = res.status === 'live' ? res.data?.ot : null;
  const byFn: any[] = res.status === 'live' ? (res.data?.byFunction || []) : [];
  const pending = res.status === 'live' ? Number(res.data?.otReview?.pending || 0) : 0;
  const fnMax = useMemo(() => Math.max(1, ...byFn.map((f: any) => Number(f.otHrs || 0))), [byFn]);

  return (
    <Section no={ar ? '٣' : '3'} icon={Timer} color={RPAL.ot}
      title={ar ? 'الأوفر تايم' : 'Overtime'}
      desc={ar ? 'TRUE_OT = عادي + يوم OFF + عطلة رسمية (فئات منفصلة) — قبل/بعد الشفت المعلّق يخضع للمراجعة'
              : 'TRUE_OT = regular + off-day + holiday (disjoint buckets) — pending before/after-shift OT awaits review'}
      actions={pending > 0 ? (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
          style={{ background: `${RPAL.warn}18`, border: `1px solid ${RPAL.warn}44`, color: RPAL.warn }}>
          <AlertTriangle size={12} />{nfmt(pending)} {ar ? 'مراجعة معلّقة' : 'pending review'}
        </span>
      ) : undefined}>
      {res.status === 'loading' && <Awaiting ar={ar} text="Loading overtime…" textAr="جارٍ تحميل الأوفر تايم…" />}
      {res.status === 'missing' && <Awaiting ar={ar} text="Overtime breakdown endpoint not available yet." textAr="واجهة تفصيل الأوفر تايم غير متاحة بعد." />}
      {res.status === 'live' && O && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(240px,300px) 1fr' }}>
          {/* OT split donut */}
          <div className="rounded-xl p-3.5" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <Donut centerNum={Number(O.totalHrs || 0)} centerSuffix={h} centerLabel={ar ? 'إجمالي' : 'total'}
              segments={[
                { label: ar ? 'عادي' : 'Regular', value: Number(O.regularHrs || 0), color: RPAL.otReg },
                { label: ar ? 'يوم OFF' : 'Off-day', value: Number(O.offdayHrs || 0), color: RPAL.otOff },
                { label: ar ? 'عطلة رسمية' : 'Holiday', value: Number(O.holidayHrs || 0), color: RPAL.otHol },
              ]} />
            <div className="mt-3 pt-2.5 flex justify-between text-[11px]" style={{ borderTop: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-2)' }}>{ar ? 'عادي: قبل / بعد الشفت' : 'Regular: before / after shift'}</span>
              <span className="font-semibold" style={{ color: RPAL.otReg }}>{nfmt(O.beforeShiftHrs)}{h} · {nfmt(O.afterShiftHrs)}{h}</span>
            </div>
          </div>

          {/* per-function OT */}
          <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <div className="text-[10.5px] font-bold uppercase tracking-wide mb-2.5" style={{ color: 'var(--text-3)' }}>
              {ar ? 'الأوفر تايم حسب الفنكشن' : 'Overtime by function'}
            </div>
            {byFn.length === 0 && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ar ? 'لا يوجد' : 'None'}</p>}
            <div className="space-y-2">
              {byFn.slice(0, 12).map((f: any, i: number) => {
                const t = Number(f.otHrs || 0);
                return (
                  <div key={i} className="flex items-center gap-2.5">
                    <span className="text-[11px] truncate" style={{ width: 116, color: 'var(--text-2)' }} title={f.fn}>{f.fn || '—'}</span>
                    <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, (100 * t) / fnMax)}%`, background: `linear-gradient(90deg, ${RPAL.ot}cc, ${RPAL.ot})`, transition: 'width .8s cubic-bezier(.4,0,.2,1)' }} />
                    </div>
                    <span className="text-[11px] font-bold text-end" style={{ width: 52, color: RPAL.ot, fontVariantNumeric: 'tabular-nums' }}>{nfmt(t)}{h}</span>
                    <span className="text-[10px] text-end whitespace-nowrap" style={{ width: 92, color: 'var(--text-3)' }}>
                      {f.offOtHrs ? <span style={{ color: RPAL.otOff }}>{nfmt(f.offOtHrs)} off</span> : ''}
                      {f.offOtHrs && f.holOtHrs ? ' · ' : ''}
                      {f.holOtHrs ? <span style={{ color: RPAL.otHol }}>{nfmt(f.holOtHrs)} hol</span> : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
