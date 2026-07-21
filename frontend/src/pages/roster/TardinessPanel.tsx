import { ShieldCheck, Clock, LogOut, Info } from 'lucide-react';
import { Gauge } from '@/components/dazzle';
import { Section, RPAL, nfmt, dur, pct1, adhHue } from './kit';

/**
 * §2 — Tardiness & conformance. Conformance is the FOLDED metric: an approved
 * permission (a permitted late / early-out) still conforms, so this is the fair
 * adherence read. Credited tardiness = system-basis 7–240 min (≤6 min tolerated;
 * >4h cross-midnight artefacts excluded). Maternity-7h early-out is structural
 * and not counted. Reads the dashboard summary + byFunction conformance.
 */
export default function TardinessPanel({ d, ar }: { d: any; ar: boolean }) {
  const s = d?.summary || {};
  const byFn: any[] = (d?.distributions?.byFunction || []).filter((f: any) => f.conformance != null);
  const conf = s.conformance != null ? Number(s.conformance) : null;

  const Chip = ({ icon: Ic, color, label, value, sub }: any) => (
    <div className="rounded-xl p-3 flex items-center gap-2.5" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      <div className="w-9 h-9 rounded-lg grid place-items-center flex-shrink-0" style={{ background: `${color}1f`, color }}><Ic size={16} strokeWidth={2.2} /></div>
      <div className="min-w-0">
        <div className="text-lg font-extrabold leading-none" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        <div className="text-[10px] mt-1 truncate" style={{ color: 'var(--text-3)' }}>{label}{sub ? ` · ${sub}` : ''}</div>
      </div>
    </div>
  );

  return (
    <Section no={ar ? '٢' : '2'} icon={ShieldCheck} color={adhHue(conf)}
      title={ar ? 'الالتزام والتأخير' : 'Tardiness & conformance'}
      desc={ar ? 'الكونفورمانس يحتسب الاستئذانات المعتمدة — التأخير المصرّح لا يخصم'
              : 'Conformance folds approved permissions — a permitted late/early still conforms'}>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(160px,200px) 1fr' }}>
        {/* conformance gauge */}
        <div className="rounded-xl grid place-items-center py-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <Gauge value={conf ?? 0} label={ar ? 'كونفورمانس' : 'Conformance'} color={adhHue(conf)} size={148}
            sub={<span>{nfmt(s.records)} {ar ? 'يوم' : 'days'}</span>} />
        </div>

        {/* tardiness / early-out chips + explainer */}
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <Chip icon={Clock} color={RPAL.warn} value={nfmt(s.late_days)} label={ar ? 'أيام تأخير' : 'Late days'} sub={dur(s.late_min)} />
            <Chip icon={LogOut} color={RPAL.warn} value={nfmt(s.early_days)} label={ar ? 'خروج مبكر' : 'Early-out'} sub={dur(s.early_min)} />
          </div>
          <div className="rounded-xl p-3 flex items-start gap-2.5" style={{ background: `${RPAL.brand}0e`, border: `1px solid ${RPAL.brand}33` }}>
            <Info size={14} style={{ color: RPAL.brand, flexShrink: 0, marginTop: 1 }} />
            <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {ar ? 'تسامح ٦ دقائق: التأخير يُحتسب فقط بين ٧ و٢٤٠ دقيقة (على أساس السيستم). أكثر من ٤ ساعات يُستبعد كأثر عبور منتصف الليل، وخروج أمهات الـ٧ ساعات المبكر بنيوي ولا يُحتسب.'
                 : '6-minute tolerance: tardiness is credited only between 7 and 240 minutes (system basis). Above 4h is set aside as cross-midnight artefact, and maternity-7h early-out is structural — not counted.'}
            </p>
          </div>
        </div>
      </div>

      {/* per-function conformance */}
      {byFn.length > 0 && (
        <div className="rounded-xl p-3 mt-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div className="text-[10.5px] font-bold uppercase tracking-wide mb-2.5" style={{ color: 'var(--text-3)' }}>
            {ar ? 'الكونفورمانس حسب الفنكشن' : 'Conformance by function'}
          </div>
          <div className="space-y-2">
            {byFn.slice(0, 14).map((f: any, i: number) => {
              const c = Number(f.conformance);
              return (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="text-[11px] truncate" style={{ width: 116, color: 'var(--text-2)' }} title={f.k}>{f.k || '—'}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, c))}%`, background: adhHue(c), transition: 'width .8s cubic-bezier(.4,0,.2,1)' }} />
                  </div>
                  <span className="text-[11px] font-bold text-end" style={{ width: 42, color: adhHue(c) }}>{pct1(c)}</span>
                  <span className="text-[10px] text-end" style={{ width: 66, color: 'var(--text-3)' }}>{f.late ? `${dur(f.late)} ${ar ? 'تأخير' : 'late'}` : '—'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}
