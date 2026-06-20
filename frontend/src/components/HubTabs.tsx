import type { LucideIcon } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';

export interface HubTabDef {
  key: string;
  icon: LucideIcon;
  ar: string;
  en: string;
}

/**
 * Shared segmented tab bar for the hub pages (Analytics, Attendance, Scheduling…).
 * Replaces seven near-identical inline tab bars with one animated component:
 * the active tab gets a gradient pill that pops in (see `.seg` in index.css).
 */
export default function HubTabs({
  tabs, active, onChange,
}: {
  tabs: readonly HubTabDef[];
  active: string;
  onChange: (key: string) => void;
}) {
  const ar = useUiStore(s => s.lang) === 'ar';
  return (
    <div className="seg flex-wrap mb-5">
      {tabs.map(t => {
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`seg-item flex items-center gap-2 ${active === t.key ? 'active' : ''}`}
          >
            <Icon size={16} />
            {ar ? t.ar : t.en}
          </button>
        );
      })}
    </div>
  );
}
