import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/** Declare required permission codes on a route or controller. */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Mark a route as publicly accessible (no JWT required). */
export const Public = () => SetMetadata('is_public', true);

/**
 * Mark a route as available to ANY authenticated user without a specific permission
 * (auth self-service: logout, change-password, MFA, /auth/me). Required since the
 * 2026-07-06 deny-by-default flip: an authenticated route with no
 * @RequirePermissions/@Public/@AuthOnly is REJECTED by PermissionsGuard, never allowed.
 */
export const AuthOnly = () => SetMetadata('auth_only', true);
