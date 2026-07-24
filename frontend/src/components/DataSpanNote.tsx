import { Info, CalendarCheck2 } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import type { DataSpan } from '@/hooks/useDataSpan';

/**
 * States the data coverage on screen, once, in the user's language.
 *
 * A page showing June while the calendar says July is not wrong — but it IS
 * confusing unless it says so. This is the difference between "the system is
 * behind" (a fact the user can act on) and "the system is broken" (what silence
 * looks like). Only appears when the roster is actually behind; on a current
 * system it renders nothing at all.
 */
export function DataSpanNote({ span, onJumpLatest }: { span: DataSpan | null; onJumpLatest?: () => void }) {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  if (!span || !span.roster.to) return null;
  const behind = span.daysBehind ?? 0;
  if (behind <= 2) return null;                       // current enough — say nothing

  const live = span.feeds.filter((f) => f.current && f.key !== 'roster');

  return (
    <div className="rounded-xl px-3 py-2 flex items-start gap-2 flex-wrap"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      <Info size={14} className="mt-0.5 shrink-0" style={{ color: '#f59e0b' }} />
      <div className="text-[11px] leading-relaxed flex-1 min-w-[240px]" style={{ color: 'var(--text-2)' }}>
        {ar
          ? <>الروستر المطابَق يغطي <b>{span.roster.from} → {span.roster.to}</b> ({span.roster.rows.toLocaleString()} سطر ·{' '}
              {span.roster.people} موظف)، يعني <b>{behind} يوم</b> خلف تاريخ اليوم. الصفحة بتفتح على آخر يوم فيه بيانات
              بدل ما تفتح فاضية.</>
          : <>The reconciled roster covers <b>{span.roster.from} → {span.roster.to}</b> ({span.roster.rows.toLocaleString()} rows ·{' '}
              {span.roster.people} people) — <b>{behind} days</b> behind today. This page opens on the latest day that has
              data rather than on an empty "today".</>}
        {live.length > 0 && (
          <> {ar ? ' التغذيات الحيّة محدّثة: ' : ' Live feeds are current: '}
            {live.map((f) => f.label).join(' · ')}.</>
        )}
      </div>
      {onJumpLatest && (
        <button onClick={onJumpLatest}
          className="px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 shrink-0"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>
          <CalendarCheck2 size={12} />{ar ? 'اذهب لآخر بيانات' : 'Jump to latest'}
        </button>
      )}
    </div>
  );
}

export default DataSpanNote;
