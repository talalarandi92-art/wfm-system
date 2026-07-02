import { useSearchParams } from 'react-router-dom';
import { Users, LayoutDashboard, Clock, CalendarRange, Home, ShieldCheck, FileSearch, GitCompareArrows, Wrench, LayoutGrid } from 'lucide-react';
import HubTabs from '@/components/HubTabs';
import RosterPage from '@/pages/Roster';
import RosterDashboardPage from '@/pages/RosterDashboard';
import OtExceptionsPage from '@/pages/OtExceptions';
import ScheduleAnalysisPage from '@/pages/ScheduleAnalysis';
import WfhHrReportPage from '@/pages/WfhHrReport';
import DataQualityPage from '@/pages/DataQuality';
import SystemAuditPage from '@/pages/SystemAudit';
import ScheduleChangeLogPage from '@/pages/ScheduleChangeLog';
import ReportBuilderPage from '@/pages/ReportBuilder';
import DashboardBuilderPage from '@/pages/DashboardBuilder';

type HubTab = 'grid' | 'dashboard' | 'ot' | 'analysis' | 'wfh' | 'quality' | 'audit' | 'changes' | 'report-builder' | 'dashboard-builder';

const TABS: { key: HubTab; icon: typeof Users; ar: string; en: string }[] = [
  { key: 'grid',              icon: Users,            ar: 'الروستر',          en: 'Roster' },
  { key: 'dashboard',         icon: LayoutDashboard,  ar: 'اللوحة',           en: 'Dashboard' },
  { key: 'ot',                icon: Clock,            ar: 'OT والاستثناءات',  en: 'OT & Exceptions' },
  { key: 'analysis',          icon: CalendarRange,    ar: 'تحليل الجدول',     en: 'Schedule Analysis' },
  { key: 'wfh',               icon: Home,             ar: 'تقرير WFH',        en: 'WFH HR Report' },
  { key: 'quality',           icon: ShieldCheck,      ar: 'جودة البيانات',    en: 'Data Quality' },
  { key: 'audit',             icon: FileSearch,       ar: 'تدقيق الأنظمة',    en: 'System Audit' },
  { key: 'changes',           icon: GitCompareArrows, ar: 'تغييرات الجدول',   en: 'Change Log' },
  { key: 'report-builder',    icon: Wrench,           ar: 'منشئ التقارير',    en: 'Report Builder' },
  { key: 'dashboard-builder', icon: LayoutGrid,       ar: 'باني الداشبورد',   en: 'Dashboard Builder' },
];

/**
 * Roster Reports hub — merges the formerly-scattered roster-reconciliation
 * reporting pages (10 sibling routes) behind ONE nav entry with ?tab= tabs,
 * exactly like the other 6 hubs. Old routes (/roster-dashboard, /ot-exceptions,
 * /schedule-analysis, /wfh-hr-report, /data-quality, /system-audit,
 * /schedule-change-log, /report-builder, /dashboard-builder) redirect here,
 * so every existing link/button keeps working.
 */
export default function RosterHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: HubTab = TABS.some(t => t.key === raw) ? (raw as HubTab) : 'grid';

  return (
    <div className="page-enter">
      <HubTabs tabs={TABS} active={tab} onChange={k => setParams({ tab: k }, { replace: true })} />

      {tab === 'grid'              && <RosterPage />}
      {tab === 'dashboard'         && <RosterDashboardPage />}
      {tab === 'ot'                && <OtExceptionsPage />}
      {tab === 'analysis'          && <ScheduleAnalysisPage />}
      {tab === 'wfh'               && <WfhHrReportPage />}
      {tab === 'quality'           && <DataQualityPage />}
      {tab === 'audit'             && <SystemAuditPage />}
      {tab === 'changes'           && <ScheduleChangeLogPage />}
      {tab === 'report-builder'    && <ReportBuilderPage />}
      {tab === 'dashboard-builder' && <DashboardBuilderPage />}
    </div>
  );
}
