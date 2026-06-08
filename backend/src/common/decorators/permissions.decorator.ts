import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/** Declare required permission codes on a route or controller. */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Mark a route as publicly accessible (no JWT required). */
export const Public = () => SetMetadata('is_public', true);
