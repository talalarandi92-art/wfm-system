import { useRef, KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { tp, ts } from '@/components/ds';

export interface GroupedTabDef {
  key: string;
  label: string;      // EN
  labelAr: string;    // AR
  icon?: LucideIcon;
}

export interface TabGroupDef {
  key: string;
  label: string;      // EN
  labelAr: string;    // AR
  icon?: LucideIcon;
  tabs: GroupedTabDef[];
}

/**
 * GroupedTabs — a two-level tab strip for hubs whose flat tab list outgrew
 * one row (R1 pilot: ChiefHub, 14 tabs → 4 groups).
 *
 * Level 1 (group row) reuses the app's `.seg` segmented style (gradient pill
 * on the active group). Level 2 (sub row) is a calmer inset pill row rendered
 * ONLY for the active group.
 *
 * URL contract — ZERO breakage: the single source of truth stays the SAME
 * `?tab=` param the flat strip used. Sub-tab keys are the old tab keys;
 * landing on any `?tab=x` deep link auto-activates the owning group + sub-tab.
 * Group buttons carry no URL state of their own — clicking a group jumps to
 * that group's last-visited (or first) sub-tab.
 *
 * Theme-aware (var(--surface)/var(--border) + tp/ts), RTL-aware (flex rows
 * follow document dir; arrow-key focus follows reading direction), keyboard
 * accessible (roving tablist per row, Enter/Space to select).
 */
export default function GroupedTabs({
  groups, defaultTab, param = 'tab',
}: {
  groups: readonly TabGroupDef[];
  /** Tab used when the URL has no/unknown ?tab. Defaults to the very first tab. */
  defaultTab?: string;
  /** Search-param name (kept configurable; always 'tab' today). */
  param?: string;
}) {
  const [params, setParams] = useSearchParams();
  const lang = useUiStore(s => s.lang);
  const dark = useUiStore(s => s.dark);
  const ar = lang === 'ar';

  const allTabs = groups.flatMap(g => g.tabs);
  const fallback = defaultTab ?? allTabs[0]?.key ?? '';
  const raw = params.get(param);
  const active = allTabs.some(t => t.key === raw) ? (raw as string) : fallback;
  const activeGroup = groups.find(g => g.tabs.some(t => t.key === active)) ?? groups[0];

  // Remember the last-visited sub-tab per group so switching groups feels stable.
  const lastTab = useRef<Record<string, string>>({});
  lastTab.current[activeGroup.key] = active;

  const select = (key: string) => setParams({ [param]: key }, { replace: true });

  const selectGroup = (g: TabGroupDef) => {
    const remembered = lastTab.current[g.key];
    select(g.tabs.some(t => t.key === remembered) ? remembered! : g.tabs[0].key);
  };

  // Roving arrow-key focus within a row (reading-direction aware).
  const onRowKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const row = e.currentTarget;
    const items = Array.from(row.querySelectorAll<HTMLButtonElement>('button[role="tab"]'));
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const forward = ar ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
    const next = items[(i + (forward ? 1 : -1) + items.length) % items.length];
    next?.focus();
    e.preventDefault();
  };

  return (
    <div className="mb-5">
      {/* Level 1 — group row (app-standard segmented style) */}
      <div className="seg flex-wrap" role="tablist" aria-label={ar ? 'المجموعات' : 'Groups'} onKeyDown={onRowKeyDown}>
        {groups.map(g => {
          const Icon = g.icon;
          const isActive = g.key === activeGroup.key;
          return (
            <button
              key={g.key}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => selectGroup(g)}
              className={`seg-item flex items-center gap-2 ${isActive ? 'active' : ''}`}
            >
              {Icon && <Icon size={16} />}
              {ar ? g.labelAr : g.label}
            </button>
          );
        })}
      </div>

      {/* Level 2 — sub row for the active group only (calm inset pills) */}
      <div
        role="tablist"
        aria-label={ar ? activeGroup.labelAr : activeGroup.label}
        onKeyDown={onRowKeyDown}
        className="flex flex-wrap items-center gap-1 mt-2 px-1"
      >
        {activeGroup.tabs.map(t => {
          const Icon = t.icon;
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => select(t.key)}
              className="flex items-center gap-1.5 transition-colors duration-150"
              style={{
                padding: '4px 12px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                cursor: 'pointer',
                color: isActive ? tp(dark) : ts(dark),
                background: isActive ? 'var(--surface-2, rgba(120,130,160,.12))' : 'transparent',
                border: `1px solid ${isActive ? 'var(--border)' : 'transparent'}`,
              }}
            >
              {Icon && <Icon size={14} />}
              {ar ? t.labelAr : t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
