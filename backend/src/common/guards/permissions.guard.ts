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
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const { user }: { user: User } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Access denied');

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
