import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { Section, StackBar, PRESENCE, RPAL, nfmt, pct1, adhHue } from './kit';

/**
 * §1 — Attendance summary. The presence mix (office / wfh / off / leave / sick /
 * absent) as ONE clean aggregate stacked bar, then per-function worked-share so a
 * team leader sees at a glance who is present vs. resting/out. Reads the dashboard
 * summary + byFunction distribution (already filtered by the page's date/function).
 */
export default function AttendancePanel({ d, ar }: { d: any; ar: boolean }) {
  const s = d?.summary;
  const byFn: any[] = d?.distributions?.byFunction || [];

  const segs = useMemo(() => PRESENCE.map(p => ({
    key: p.key, label: ar ? p.ar : p.en, color: p.color, value: Number(s?.[p.key] || 0),
  })), [s, ar]);
  const total = segs.reduce((a, x) => a + x.value, 0) || 1;

  return (
    <Section no={ar ? '١' : '1'} icon={Users} color={RPAL.office}
      title={ar ? 'ملخّص الحضور' : 'Attendance summary'}
      desc={ar ? 'توزيع أيام الروستر: مكتب / WFH / أوف / إجازة / سيك / غياب — ثم حصة العمل لكل فنكشن'
              : 'Roster-day mix: office / WFH / off / leave / sick / absent — then worked-share per function'}>
      {/* aggregate presence stacked bar */}
      <div className="mb-3">
        <StackBar segments={segs} height={16} />
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5">
          {segs.map(sg => (
            <div key={sg.key} className="flex items-center gap-1.5">
              <span style={{ width: 9, height: 9, borderRadius: 3, background: sg.color, flexShrink: 0 }} />
              <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{sg.label}</span>
              <span className="text-[11px] font-bold" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{nfmt(sg.value)}</span>
              <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{Math.round((100 * sg.value) / total)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* per-function worked share */}
      {byFn.length > 0 && (
        <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div className="text-[10.5px] font-bold uppercase tracking-wide mb-2.5" style={{ color: 'var(--text-3)' }}>
            {ar ? 'حسب الفنكشن — حصة العمل والكونفورمانس' : 'By function — worked share & conformance'}
          </div>
          <div className="space-y-2">
            {byFn.slice(0, 14).map((f: any, i: number) => {
              const worked = Number(f.worked || 0), n = Number(f.n || 0);
              const rest = Math.max(0, n - worked);
              return (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="text-[11px] truncate" style={{ width: 116, color: 'var(--text-2)' }} title={f.k}>{f.k || '—'}</span>
                  <div className="flex-1"><StackBar height={10} segments={[
                    { key: 'worked', label: ar ? 'عمل' : 'Worked', value: worked, color: RPAL.office },
                    { key: 'rest', label: ar ? 'أوف/إجازة/غياب' : 'Off/leave/out', value: rest, color: RPAL.off },
                  ]} /></div>
                  <span className="text-[11px] font-semibold text-end" style={{ width: 62, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>
                    {nfmt(worked)}<span style={{ color: 'var(--text-3)' }}>/{nfmt(n)}</span>
                  </span>
                  <span className="text-[11px] font-bold text-end" style={{ width: 42, color: adhHue(f.conformance) }}>
                    {f.conformance != null ? pct1(f.conformance) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}
