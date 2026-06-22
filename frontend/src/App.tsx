import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useUiStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/api/client';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import ImportPage          from '@/pages/Import';
import AttendanceHub        from '@/pages/AttendanceHub';
import SchedulingHub          from '@/pages/SchedulingHub';
import RequestsPage            from '@/pages/Requests';
import CapacityPage            from '@/pages/Capacity';
import EmployeesHub           from '@/pages/EmployeesHub';
import UserManagementPage      from '@/pages/UserManagement';
import LiveOpsHub             from '@/pages/LiveOpsHub';
import ScorecardPage           from '@/pages/Scorecard';
import AnalyticsHub            from '@/pages/AnalyticsHub';
import ProductivityPage        from '@/pages/Productivity';
import RosterPage              from '@/pages/Roster';
import RosterDashboardPage     from '@/pages/RosterDashboard';
import ReportBuilderPage       from '@/pages/ReportBuilder';
import DataQualityPage         from '@/pages/DataQuality';
import DashboardBuilderPage    from '@/pages/DashboardBuilder';
import ScheduleChangeLogPage   from '@/pages/ScheduleChangeLog';
import IntervalHeadcountPage    from '@/pages/IntervalHeadcount';
import Agent360Page             from '@/pages/Agent360';
import WfmOverviewPage          from '@/pages/WfmOverview';
import SystemAuditPage          from '@/pages/SystemAudit';
import SettingsPage            from '@/pages/Settings';
import CalendarPage            from '@/pages/Calendar';
import SkillsPage              from '@/pages/Skills';
import WorkspaceHub           from '@/pages/WorkspaceHub';
import AgentHome               from '@/pages/AgentHome';
import OdooIntegrationPage     from '@/pages/OdooIntegration';
import CoachingPage              from '@/pages/Coaching';
import ControlDashboardsPage     from '@/pages/ControlDashboards';
import HourlyCoveragePage        from '@/pages/HourlyCoverage';
import SystemHealthPage          from '@/pages/SystemHealth';
import AnalystPage               from '@/pages/Analyst';
import ReportsBotPage            from '@/pages/ReportsBot';
import BotsHubPage               from '@/pages/BotsHub';
import AdvisorPage               from '@/pages/Advisor';
import SecurityGuardPage         from '@/pages/SecurityGuard';
import ExpertPage                from '@/pages/Expert';
import ChiefPage                 from '@/pages/Chief';
import ScorecardGuardPage        from '@/pages/ScorecardGuard';
import ResearcherPage            from '@/pages/Researcher';
import KnowledgeLedgerPage       from '@/pages/KnowledgeLedger';
import TeamLearningPage          from '@/pages/TeamLearning';
import DiagnosticsPage           from '@/pages/Diagnostics';
import Placeholder from '@/pages/Placeholder';
import AppLayout from '@/components/Layout/AppLayout';
import ProtectedRoute from '@/components/ProtectedRoute';

export default function App() {
  const { lang, dark } = useUiStore();
  const { isAuthenticated, setTokens } = useAuthStore();

  // Apply direction and dark mode on mount / lang change
  useEffect(() => {
    // Use ar-u-hc-h23 to keep Arabic text support while forcing 24h clock in datetime pickers
    document.documentElement.lang = lang === 'ar' ? 'ar-u-hc-h23' : 'en-GB';
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.classList.toggle('dark', dark);
  }, [lang, dark]);

  // Hydrate user from token on page reload
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token && isAuthenticated) {
      authApi.me().then(({ data }) => {
        const refresh = localStorage.getItem('refresh_token') ?? '';
        setTokens(token, refresh, data);
      }).catch(() => {});
    }
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<LandingRedirect />} />
          <Route path="my"         element={<AgentHome />} />
          <Route path="dashboard"  element={<Dashboard />} />
          <Route path="schedule"     element={<SchedulingHub />} />
          <Route path="generator"   element={<Navigate to="/schedule?tab=generator" replace />} />
          <Route path="rotation"    element={<Navigate to="/schedule?tab=rotation" replace />} />
          <Route path="attendance" element={<AttendanceHub />} />
          <Route path="requests"   element={<RequestsPage />} />
          <Route path="breaks"     element={<Navigate to="/attendance?tab=breaks" replace />} />
          <Route path="capacity"   element={<CapacityPage />} />
          <Route path="rta"              element={<LiveOpsHub />} />
          <Route path="outages"         element={<Navigate to="/rta?tab=outages" replace />} />
          <Route path="technical-issues" element={<Navigate to="/rta?tab=technical" replace />} />
          <Route path="scorecard"  element={<ScorecardPage />} />
          <Route path="employees"  element={<EmployeesHub />} />
          <Route path="employee-merge" element={<Navigate to="/employees?tab=merge" replace />} />
          <Route path="users"      element={<UserManagementPage />} />
          <Route path="import"     element={<ImportPage />} />
          <Route path="reports"    element={<Navigate to="/analytics?tab=reports" replace />} />
          <Route path="settings"   element={<SettingsPage />} />
          <Route path="calendar"   element={<CalendarPage />} />
          <Route path="skills"     element={<SkillsPage />} />
          <Route path="chat"       element={<WorkspaceHub />} />
          <Route path="ops-analytics" element={<Navigate to="/analytics?tab=ops" replace />} />
          <Route path="knowledge-base" element={<Navigate to="/chat?tab=kb" replace />} />
          <Route path="integrations/odoo" element={<OdooIntegrationPage />} />
          <Route path="analytics" element={<AnalyticsHub />} />
          <Route path="productivity" element={<ProductivityPage />} />
          <Route path="roster" element={<RosterPage />} />
          <Route path="roster-dashboard" element={<RosterDashboardPage />} />
          <Route path="report-builder" element={<ReportBuilderPage />} />
          <Route path="data-quality" element={<DataQualityPage />} />
          <Route path="dashboard-builder" element={<DashboardBuilderPage />} />
          <Route path="schedule-change-log" element={<ScheduleChangeLogPage />} />
          <Route path="interval-headcount" element={<IntervalHeadcountPage />} />
          <Route path="agent-360" element={<Agent360Page />} />
          <Route path="wfm-overview" element={<WfmOverviewPage />} />
          <Route path="system-audit" element={<SystemAuditPage />} />
          <Route path="campaigns" element={<Navigate to="/schedule?tab=campaigns" replace />} />
          <Route path="attendance-corrections" element={<Navigate to="/attendance?tab=corrections" replace />} />
          <Route path="schedule-changes" element={<Navigate to="/schedule?tab=changes" replace />} />
          <Route path="coaching" element={<CoachingPage />} />
          <Route path="control-dashboards" element={<ControlDashboardsPage />} />
          <Route path="hourly-coverage" element={<HourlyCoveragePage />} />
          <Route path="system-health" element={<SystemHealthPage />} />
          <Route path="analyst" element={<AnalystPage />} />
          <Route path="reports-bot" element={<ReportsBotPage />} />
          <Route path="bots" element={<BotsHubPage />} />
          <Route path="advisor" element={<AdvisorPage />} />
          <Route path="security-guard" element={<SecurityGuardPage />} />
          <Route path="expert" element={<ExpertPage />} />
          <Route path="chief" element={<ChiefPage />} />
          <Route path="scorecard-guard" element={<ScorecardGuardPage />} />
          <Route path="researcher" element={<ResearcherPage />} />
          <Route path="knowledge-ledger" element={<KnowledgeLedgerPage />} />
          <Route path="team-learning" element={<TeamLearningPage />} />
          <Route path="diagnostics" element={<DiagnosticsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

/**
 * Index landing: waits for the user to hydrate, then routes agents (no team/all
 * attendance visibility) to their self-service workspace, and managers/WFM/RTA/HR
 * to the operations dashboard. Avoids a premature redirect while /me is loading.
 */
function LandingRedirect() {
  const { user, hasPermission } = useAuthStore();

  if (!user) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-7 h-7 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  const isManager = hasPermission('attendance.view_team')
    || hasPermission('attendance.view_all')
    || hasPermission('users.view');
  return <Navigate to={isManager ? '/dashboard' : '/my'} replace />;
}
