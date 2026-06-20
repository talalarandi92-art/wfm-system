export interface LinkedEmployee {
  id: string;
  employeeNo: string;
  fullName: string;
  gender: string;
  functionId: string | null;
  functionName: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  tenantId: string;
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
  employeeId?: string | null;
  employee?: LinkedEmployee | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, mfaCode?: string) => Promise<{ mfaRequired?: boolean }>;
  logout: () => void;
  setTokens: (access: string, refresh: string, user: AuthUser) => void;
  hasPermission: (code: string) => boolean;
  hasRole: (role: string) => boolean;
}
