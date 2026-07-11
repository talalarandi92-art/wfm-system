import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

/**
 * Employee Identity module (Scorecard program wave B2, spec §10).
 * A resolved cross-system MAP over the canonical `employee_identity` spine.
 */
@Module({
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class EmployeeIdentityModule {}
