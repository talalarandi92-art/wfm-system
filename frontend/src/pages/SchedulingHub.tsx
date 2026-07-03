import { useSearchParams } from 'react-router-dom';
import { Calendar, Zap, Shuffle, Megaphone, CalendarCog, Clock, Wand2, Waves, Layers } from 'lucide-react';
import HubTabs from '@/components/HubTabs';
import { useAuthStore } from '@/store/auth.store';
import SchedulePage from '@/pages/Schedule';
import ScheduleGeneratorPage from '@/pages/ScheduleGenerator';
import ShiftRotationPage from '@/pages/ShiftRotation';
import CampaignsPage from '@/pages/Campaigns';
import ScheduleChangesPage from '@/pages/ScheduleChanges';
import HourlyAnalyticsPage from '@/pages/HourlyAnalytics';
import ScheduleDemandPage from '@/pages/ScheduleDemand';
import ForecastWeekPage from '@/pages/ForecastWeek';
import LadderRotationPage from '@/pages/LadderRotation';

type HubTab = 'schedule' | 'generator' | 'ladder' | 'forecast' | 'hourly' | 'demand' | 'rotation' | 'campaigns' | 'changes';

const TABS: { key: HubTab; icon: typeof Calendar; ar: string; en: string; permission: string }[] = [
  { key: 'schedule',  icon: Calendar,    ar: 'الجدول',        en: 'Schedule',   permission: 'schedule.view' },
  { key: 'generator', icon: Zap,         ar: 'توليد الجدول',  en: 'Generator',  permission: 'schedule.generate' },
  { key: 'ladder',    icon: Layers,      ar: 'الدوران التدريجي', en: 'Laddered Rotation', permission: 'schedule.generate' },
  // (Director 2026-07-03) everything schedule-related lives HERE — the live week forecast +
  // hourly HC + demand/health moved in from AnalyticsHub so generate → forecast → schedule are ONE place.
  { key: 'forecast',  icon: Waves,       ar: 'توقّع الأسبوع', en: 'Week Forecast', permission: 'attendance.view_team' },
  { key: 'hourly',    icon: Clock,       ar: 'HC بالساعة',    en: 'Hourly HC',  permission: 'attendance.view_team' },
  { key: 'demand',    icon: Wand2,       ar: 'الطلب والصحة',  en: 'Demand & Health', permission: 'schedule.generate' },
  { key: 'rotation',  icon: Shuffle,     ar: 'الدوران',       en: 'Rotation',   permission: 'schedule.edit' },
  { key: 'changes',   icon: CalendarCog, ar: 'تغيير الجدول',  en: 'Changes',    permission: 'schedule.view' },
  { key: 'campaigns', icon: Megaphone,   ar: 'الحملات',       en: 'Campaigns',  permission: 'schedule.view' },
];

/**
 * Merges Schedule, Generator, Hourly HC, Demand & Health, Rotation and Campaigns
 * behind one nav entry with tabs. Each tab is gated by its own permission (so an
 * RTA with only schedule.view sees just the Schedule tab). Active tab lives in
 * the URL (?tab=) so deep links and the old routes (which redirect here) land on
 * the right tab.
 */
export default function SchedulingHub() {
  const hasPermission = useAuthStore(s => s.hasPermission);
  const [params, setParams] = useSearchParams();

  const visible = TABS.filter(t => hasPermission(t.permission));
  const raw = params.get('tab') as HubTab | null;
  const tab: HubTab = visible.some(t => t.key === raw) ? raw! : (visible[0]?.key ?? 'schedule');

  return (
    <div className="page-enter">
      {visible.length > 1 && (
        <HubTabs tabs={visible} active={tab} onChange={k => setParams({ tab: k }, { replace: true })} />
      )}

      {tab === 'schedule'  && <SchedulePage />}
      {tab === 'generator' && <ScheduleGeneratorPage />}
      {tab === 'ladder'    && <LadderRotationPage />}
      {tab === 'forecast'  && <ForecastWeekPage />}
      {tab === 'hourly'    && <HourlyAnalyticsPage />}
      {tab === 'demand'    && <ScheduleDemandPage />}
      {tab === 'rotation'  && <ShiftRotationPage />}
      {tab === 'changes'   && <ScheduleChangesPage />}
      {tab === 'campaigns' && <CampaignsPage />}
    </div>
  );
}
