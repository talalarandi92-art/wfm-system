import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '@common/decorators/permissions.decorator';
import { User } from '@database/entities/user.entity';

/**
 * RBAC is enforced server-side ONLY.
 * Never rely on frontend to hide/show based on permissions.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Public routes carry no permissions by design (JwtAuthGuard already skipped auth).
    const isPublic = this.reflector.getAllAndOverride<boolean>('is_public', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const { user }: { user: User } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Access denied');

    // Auth self-service routes (logout / change-password / MFA / me): any authenticated user.
    const authOnly = this.reflector.getAllAndOverride<boolean>('auth_only', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (authOnly) return true;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // DENY-BY-DEFAULT (2026-07-06, EXECUTION_BRIEF risk #1): an authenticated route with no
    // declared @RequirePermissions is a wiring bug, not an open door. Previously this
    // returned true and left ~53 handlers reachable by any authenticated user.
    if (!required || required.length === 0) {
      throw new ForbiddenException('Route declares no permissions (deny-by-default)');
    }

    const userCodes = user.permissionCodes;
    const hasAll = required.every(code => userCodes.includes(code));

    if (!hasAll) {
      throw new ForbiddenException(
        `Missing required permission(s): ${required.filter(c => !userCodes.includes(c)).join(', ')}`
      );
    }

    return true;
  }
}
