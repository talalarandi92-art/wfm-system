import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useUiStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/api/client';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import ImportPage from '@/pages/Import';
import Placeholder from '@/pages/Placeholder';
import AppLayout from '@/components/Layout/AppLayout';
import ProtectedRoute from '@/components/ProtectedRoute';

export default function App() {
  const { lang, dark } = useUiStore();
  const { isAuthenticated, setTokens } = useAuthStore();

  // Apply direction and dark mode on mount / lang change
  useEffect(() => {
    document.documentElement.lang = lang;
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
          <Route path="schedule"   element={<Placeholder title="Schedule" />} />
          <Route path="attendance" element={<Placeholder title="Attendance" />} />
          <Route path="requests"   element={<Placeholder title="Requests" />} />
          <Route path="capacity"   element={<Placeholder title="Capacity Planning" />} />
          <Route path="rta"        element={<Placeholder title="Live Monitoring" />} />
          <Route path="outages"    element={<Placeholder title="Outages" />} />
          <Route path="scorecard"  element={<Placeholder title="Scorecard" />} />
          <Route path="employees"  element={<Placeholder title="Employees" />} />
          <Route path="users"      element={<Placeholder title="Users" />} />
          <Route path="import"     element={<ImportPage />} />
          <Route path="reports"    element={<Placeholder title="Reports" />} />
          <Route path="settings"   element={<Placeholder title="Settings" />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
