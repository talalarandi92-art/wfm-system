import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useUiStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/api/client';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import ImportPage          from '@/pages/Import';
import AttendanceDashboard from '@/pages/AttendanceDashboard';
import SchedulePage           from '@/pages/Schedule';
import ScheduleGeneratorPage from '@/pages/ScheduleGenerator';
import ShiftRotationPage      from '@/pages/ShiftRotation';
import RequestsPage            from '@/pages/Requests';
import CapacityPage            from '@/pages/Capacity';
import EmployeeMergePage       from '@/pages/EmployeeMerge';
import UserManagementPage      from '@/pages/UserManagement';
import EmployeesPage           from '@/pages/Employees';
import RTAPage                 from '@/pages/RTA';
import OutagesPage             from '@/pages/Outages';
import TechnicalIssuesPage     from '@/pages/TechnicalIssues';
import ScorecardPage           from '@/pages/Scorecard';
import BreaksPage              from '@/pages/Breaks';
import ReportsPage             from '@/pages/Reports';
import SettingsPage            from '@/pages/Settings';
import CalendarPage            from '@/pages/Calendar';
import SkillsPage              from '@/pages/Skills';
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
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"  element={<Dashboard />} />
          <Route path="schedule"     element={<SchedulePage />} />
          <Route path="generator"   element={<ScheduleGeneratorPage />} />
          <Route path="rotation"    element={<ShiftRotationPage />} />
          <Route path="attendance" element={<AttendanceDashboard />} />
          <Route path="requests"   element={<RequestsPage />} />
          <Route path="breaks"     element={<BreaksPage />} />
          <Route path="capacity"   element={<CapacityPage />} />
          <Route path="rta"              element={<RTAPage />} />
          <Route path="outages"         element={<OutagesPage />} />
          <Route path="technical-issues" element={<TechnicalIssuesPage />} />
          <Route path="scorecard"  element={<ScorecardPage />} />
          <Route path="employees"  element={<EmployeesPage />} />
          <Route path="employee-merge" element={<EmployeeMergePage />} />
          <Route path="users"      element={<UserManagementPage />} />
          <Route path="import"     element={<ImportPage />} />
          <Route path="reports"    element={<ReportsPage />} />
          <Route path="settings"   element={<SettingsPage />} />
          <Route path="calendar"   element={<CalendarPage />} />
          <Route path="skills"     element={<SkillsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
