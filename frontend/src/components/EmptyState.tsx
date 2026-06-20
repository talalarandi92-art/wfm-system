import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';

/**
 * Consistent empty-state placeholder for lists/tables/dashboards that have no
 * data yet — calmer than a blank panel, with an optional call-to-action.
 */
export default function EmptyState({
  icon: Icon = Inbox, titleAr, titleEn, subAr, subEn, action,
}: {
  icon?: LucideIcon;
  titleAr: string;
  titleEn: string;
  subAr?: string;
  subEn?: string;
  action?: { labelAr: string; labelEn: string; onClick: () => void };
}) {
  const ar = useUiStore(s => s.lang) === 'ar';
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-14 rounded-2xl"
      style={{ background: 'var(--surface)', border: '1px dashed var(--border-strong, var(--border))' }}>
      <div className="flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
        style={{ background: 'rgba(99,102,241,0.10)', color: '#818cf8' }}>
        <Icon size={26} />
      </div>
      <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{ar ? titleAr : titleEn}</div>
      {(subAr || subEn) && (
        <div className="text-xs mt-1.5 max-w-sm" style={{ color: '#94a3b8' }}>{ar ? subAr : subEn}</div>
      )}
      {action && (
        <button onClick={action.onClick} className="btn-primary mt-4 text-xs">
          {ar ? action.labelAr : action.labelEn}
        </button>
      )}
    </div>
  );
}
