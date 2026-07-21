import { useSearchParams } from 'react-router-dom';
import { Calendar, Zap, Shuffle, Megaphone, CalendarCog, Clock, Wand2, Waves, Layers, Activity, Sparkles, BadgeCheck } from 'lucide-react';
import GroupedTabs, { TabGroupDef, GroupedTabDef } from '@/components/GroupedTabs';
import { useAuthStore } from '@/store/auth.store';
import SchedulePage from '@/pages/Schedule';
import GeneratorPanel from '@/pages/schedule/GeneratorPanel';
import QualityPanel from '@/pages/schedule/QualityPanel';
import ShiftRotationPage from '@/pages/ShiftRotation';
import CampaignsPage from '@/pages/Campaigns';
import ScheduleChangesPage from '@/pages/ScheduleChanges';
import HourlyAnalyticsPage from '@/pages/HourlyAnalytics';
import ScheduleDemandPage from '@/pages/ScheduleDemand';
import ForecastWeekPage from '@/pages/ForecastWeek';
import LadderRotationPage from '@/pages/LadderRotation';

type HubTab = 'schedule' | 'generator' | 'ladder' | 'forecast' | 'hourly' | 'quality' | 'demand' | 'rotation' | 'campaigns' | 'changes';

type GatedTab = GroupedTabDef & { permission: string };
type GatedGroup = Omit<TabGroupDef, 'tabs'> & { tabs: GatedTab[] };

/**
 * The 9 former flat tabs regrouped into 6 groups (R1 rollout).
 * Tab KEYS are unchanged — every existing `?tab=` deep link and the
 * App.tsx redirects keep working exactly as before. Each sub-tab keeps
 * its own permission gate (an RTA with only schedule.view sees just the
 * Schedule group); groups whose tabs are all gated away disappear.
 */
const GROUPS: GatedGroup[] = [
  {
    key: 'schedule', label: 'Schedule', labelAr: 'الجدول', icon: Calendar,
    tabs: [
      { key: 'schedule',  label: 'Schedule',  labelAr: 'الجدول',  icon: Calendar,  permission: 'schedule.view' },
      { key: 'campaigns', label: 'Campaigns', labelAr: 'الحملات', icon: Megaphone, permission: 'schedule.view' },
    ],
  },
  {
    key: 'generate', label: 'Generate', labelAr: 'التوليد', icon: Sparkles,
    tabs: [
      { key: 'generator', label: 'Generator',         labelAr: 'توليد الجدول',    icon: Zap,    permission: 'schedule.generate' },
      { key: 'ladder',    label: 'Laddered Rotation', labelAr: 'الدوران التدريجي', icon: Layers, permission: 'schedule.generate' },
    ],
  },
  {
    // (Director 2026-07-03) everything schedule-related lives HERE — the live week forecast +
    // hourly HC + demand/health moved in from AnalyticsHub so generate → forecast → schedule are ONE place.
    key: 'coverage', label: 'Coverage', labelAr: 'التغطية', icon: Activity,
    tabs: [
      { key: 'forecast', label: 'Week Forecast', labelAr: 'توقّع الأسبوع', icon: Waves, permission: 'attendance.view_team' },
      { key: 'hourly',   label: 'Hourly HC',     labelAr: 'HC بالساعة',    icon: Clock, permission: 'attendance.view_team' },
      // Stage 2B: grade an existing week (coverage/fairness/compliance) — panel
      // graceful-hides its score until /roster-v2/schedule-quality is deployed.
      { key: 'quality',  label: 'Schedule Quality', labelAr: 'جودة الجدول', icon: BadgeCheck, permission: 'schedule.view' },
    ],
  },
  {
    key: 'demand', label: 'Demand', labelAr: 'الطلب', icon: Wand2,
    tabs: [
      { key: 'demand', label: 'Demand & Health', labelAr: 'الطلب والصحة', icon: Wand2, permission: 'schedule.generate' },
    ],
  },
  {
    key: 'rotation', label: 'Rotation', labelAr: 'التدوير', icon: Shuffle,
    tabs: [
      { key: 'rotation', label: 'Rotation', labelAr: 'الدوران', icon: Shuffle, permission: 'schedule.edit' },
    ],
  },
  {
    key: 'changes', label: 'Changes', labelAr: 'التغييرات', icon: CalendarCog,
    tabs: [
      { key: 'changes', label: 'Changes', labelAr: 'تغيير الجدول', icon: CalendarCog, permission: 'schedule.view' },
    ],
  },
];

/**
 * Merges Schedule, Generator, Hourly HC, Demand & Health, Rotation and Campaigns
 * behind one nav entry with grouped tabs. Each tab is gated by its own permission.
 * Active tab lives in the URL (?tab=) so deep links and the old routes (which
 * redirect here) land on the right tab.
 */
export default function SchedulingHub() {
  const hasPermission = useAuthStore(s => s.hasPermission);
  const [params] = useSearchParams();

  // Permission-filter sub-tabs, then drop groups left empty.
  const visibleGroups: TabGroupDef[] = GROUPS
    .map(g => ({ ...g, tabs: g.tabs.filter(t => hasPermission(t.permission)) }))
    .filter(g => g.tabs.length > 0);

  const visible = visibleGroups.flatMap(g => g.tabs);
  const raw = params.get('tab') as HubTab | null;
  const tab: HubTab = visible.some(t => t.key === raw) ? raw! : ((visible[0]?.key as HubTab) ?? 'schedule');

  return (
    <div className="page-enter">
      {visible.length > 1 && (
        <GroupedTabs groups={visibleGroups} defaultTab={visible[0]?.key} />
      )}

      {tab === 'schedule'  && <SchedulePage />}
      {tab === 'generator' && <GeneratorPanel />}
      {tab === 'ladder'    && <LadderRotationPage />}
      {tab === 'forecast'  && <ForecastWeekPage />}
      {tab === 'hourly'    && <HourlyAnalyticsPage />}
      {tab === 'quality'   && <QualityPanel />}
      {tab === 'demand'    && <ScheduleDemandPage />}
      {tab === 'rotation'  && <ShiftRotationPage />}
      {tab === 'changes'   && <ScheduleChangesPage />}
      {tab === 'campaigns' && <CampaignsPage />}
    </div>
  );
}
