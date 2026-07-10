import { useSearchParams } from 'react-router-dom';
import { Users, LayoutDashboard, Clock, CalendarRange, Home, ShieldCheck, FileSearch, GitCompareArrows, Wrench, LayoutGrid, FileBarChart } from 'lucide-react';
import GroupedTabs, { TabGroupDef } from '@/components/GroupedTabs';
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

/**
 * The 10 former flat tabs regrouped into 5 groups (R1 rollout).
 * Tab KEYS are unchanged — every existing `?tab=` deep link and the
 * App.tsx redirects keep working exactly as before.
 */
const GROUPS: TabGroupDef[] = [
  {
    key: 'grid', label: 'Grid', labelAr: 'الجدول', icon: Users,
    tabs: [
      { key: 'grid', label: 'Roster', labelAr: 'الروستر', icon: Users },
    ],
  },
  {
    key: 'dashboard', label: 'Dashboard', labelAr: 'لوحة المتابعة', icon: LayoutDashboard,
    tabs: [
      { key: 'dashboard', label: 'Dashboard',         labelAr: 'اللوحة',       icon: LayoutDashboard },
      { key: 'analysis',  label: 'Schedule Analysis', labelAr: 'تحليل الجدول', icon: CalendarRange },
    ],
  },
  {
    key: 'reports', label: 'Reports', labelAr: 'التقارير', icon: FileBarChart,
    tabs: [
      { key: 'ot',      label: 'OT & Exceptions', labelAr: 'OT والاستثناءات', icon: Clock },
      { key: 'wfh',     label: 'WFH HR Report',   labelAr: 'تقرير WFH',       icon: Home },
      { key: 'quality', label: 'Data Quality',    labelAr: 'جودة البيانات',   icon: ShieldCheck },
      { key: 'audit',   label: 'System Audit',    labelAr: 'تدقيق الأنظمة',   icon: FileSearch },
    ],
  },
  {
    key: 'builders', label: 'Builders', labelAr: 'المنشئات', icon: Wrench,
    tabs: [
      { key: 'report-builder',    label: 'Report Builder',    labelAr: 'منشئ التقارير', icon: Wrench },
      { key: 'dashboard-builder', label: 'Dashboard Builder', labelAr: 'باني الداشبورد', icon: LayoutGrid },
    ],
  },
  {
    key: 'changes', label: 'Changes', labelAr: 'التغييرات', icon: GitCompareArrows,
    tabs: [
      { key: 'changes', label: 'Change Log', labelAr: 'تغييرات الجدول', icon: GitCompareArrows },
    ],
  },
];

const ALL_KEYS = GROUPS.flatMap(g => g.tabs.map(t => t.key));

/**
 * Roster Reports hub — merges the formerly-scattered roster-reconciliation
 * reporting pages (10 sibling routes) behind ONE nav entry with ?tab= tabs,
 * now organized into 5 groups via GroupedTabs. Old routes (/roster-dashboard,
 * /ot-exceptions, /schedule-analysis, /wfh-hr-report, /data-quality,
 * /system-audit, /schedule-change-log, /report-builder, /dashboard-builder)
 * redirect here, so every existing link/button keeps working.
 */
export default function RosterHub() {
  const [params] = useSearchParams();
  const raw = params.get('tab');
  const tab: HubTab = raw && ALL_KEYS.includes(raw) ? (raw as HubTab) : 'grid';

  return (
    <div className="page-enter">
      <GroupedTabs groups={GROUPS} defaultTab="grid" />

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
