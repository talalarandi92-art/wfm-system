import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Attaches tenant context to every request.
 * Source priority: JWT payload (set by JwtStrategy) > X-Tenant-Slug header.
 * The actual tenant_id is resolved from the JWT in JwtStrategy.validate().
 * This middleware only ensures the field exists on the request object.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request & { tenantId?: string }, _res: Response, next: NextFunction) {
    // tenantId will be populated by JwtStrategy once the token is validated.
    // For unauthenticated routes (login, health) it remains undefined.
    next();
  }
}
