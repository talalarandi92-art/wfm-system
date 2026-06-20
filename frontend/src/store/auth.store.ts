import { create } from 'zustand';
import { AuthState, AuthUser } from '@/types/auth.types';
import { authApi } from '@/api/client';

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: localStorage.getItem('access_token'),
  refreshToken: localStorage.getItem('refresh_token'),
  isAuthenticated: !!localStorage.getItem('access_token'),
  isLoading: false,

  login: async (email, password, mfaCode) => {
    set({ isLoading: true });
    try {
      const { data } = await authApi.login(email, password, mfaCode);
      if (data?.mfaRequired) {
        set({ isLoading: false });
        return { mfaRequired: true };
      }
      localStorage.setItem('access_token', data.accessToken);
      localStorage.setItem('refresh_token', data.refreshToken);
      set({
        user: data.user,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        isAuthenticated: true,
        isLoading: false,
      });
      return {};
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  logout: () => {
    authApi.logout().catch(() => {});
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
  },

  setTokens: (access, refresh, user) => {
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    set({ accessToken: access, refreshToken: refresh, user, isAuthenticated: true });
  },

  hasPermission: (code) => get().user?.permissions.includes(code) ?? false,
  hasRole: (role) => get().user?.roles.includes(role) ?? false,
}));
