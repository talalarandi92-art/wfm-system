import { useSearchParams } from 'react-router-dom';
import { Calendar, Zap, Shuffle, Megaphone, CalendarCog } from 'lucide-react';
import HubTabs from '@/components/HubTabs';
import { useAuthStore } from '@/store/auth.store';
import SchedulePage from '@/pages/Schedule';
import ScheduleGeneratorPage from '@/pages/ScheduleGenerator';
import ShiftRotationPage from '@/pages/ShiftRotation';
import CampaignsPage from '@/pages/Campaigns';
import ScheduleChangesPage from '@/pages/ScheduleChanges';

type HubTab = 'schedule' | 'generator' | 'rotation' | 'campaigns' | 'changes';

const TABS: { key: HubTab; icon: typeof Calendar; ar: string; en: string; permission: string }[] = [
  { key: 'schedule',  icon: Calendar,    ar: 'الجدول',        en: 'Schedule',   permission: 'schedule.view' },
  { key: 'generator', icon: Zap,         ar: 'توليد الجدول',  en: 'Generator',  permission: 'schedule.generate' },
  { key: 'rotation',  icon: Shuffle,     ar: 'الدوران',       en: 'Rotation',   permission: 'schedule.edit' },
  { key: 'changes',   icon: CalendarCog, ar: 'تغيير الجدول',  en: 'Changes',    permission: 'schedule.view' },
  { key: 'campaigns', icon: Megaphone,   ar: 'الحملات',       en: 'Campaigns',  permission: 'schedule.view' },
];

/**
 * Merges Schedule, Generator, Rotation and Campaigns behind one nav entry with
 * tabs. Each tab is gated by its own permission (so an RTA with only
 * schedule.view sees just the Schedule tab). Active tab lives in the URL (?tab=)
 * so deep links and the old /generator, /rotation, /campaigns routes (which
 * redirect here) land on the right tab.
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
      {tab === 'rotation'  && <ShiftRotationPage />}
      {tab === 'changes'   && <ScheduleChangesPage />}
      {tab === 'campaigns' && <CampaignsPage />}
    </div>
  );
}
