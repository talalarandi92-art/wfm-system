import { useSearchParams } from 'react-router-dom';
import { Crown, Gauge, LayoutDashboard, Sparkles } from 'lucide-react';
import HubTabs from '@/components/HubTabs';
import CommandCenterPage from '@/pages/CommandCenter';
import ControlDashboardsPage from '@/pages/ControlDashboards';
import DashboardPage from '@/pages/Dashboard';
import WfmOverviewPage from '@/pages/WfmOverview';

type HubTab = 'exec' | 'roles' | 'ops' | 'overview';

const TABS: { key: HubTab; icon: typeof Crown; ar: string; en: string }[] = [
  { key: 'exec',     icon: Crown,           ar: 'مركز القيادة',    en: 'Command Center' },
  { key: 'roles',    icon: Gauge,           ar: 'لوحات الأدوار',   en: 'Role Dashboards' },
  { key: 'ops',      icon: LayoutDashboard, ar: 'لوحة التشغيل',    en: 'Ops Dashboard' },
  { key: 'overview', icon: Sparkles,        ar: 'النظرة التنفيذية', en: 'WFM Overview' },
];

/**
 * Executive home — ONE landing instead of four overlapping ones. The flagship
 * Command Center is the default tab; the role-switching Control Dashboards,
 * the ops Dashboard, and the WFM Overview tile launcher become its tabs.
 * Old routes (/dashboard, /control-dashboards, /wfm-overview) redirect here.
 */
export default function CommandCenterHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: HubTab = TABS.some(t => t.key === raw) ? (raw as HubTab) : 'exec';

  return (
    <div className="page-enter">
      <HubTabs tabs={TABS} active={tab} onChange={k => setParams({ tab: k }, { replace: true })} />

      {tab === 'exec'     && <CommandCenterPage />}
      {tab === 'roles'    && <ControlDashboardsPage />}
      {tab === 'ops'      && <DashboardPage />}
      {tab === 'overview' && <WfmOverviewPage />}
    </div>
  );
}
