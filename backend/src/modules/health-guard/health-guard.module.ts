import { Module } from '@nestjs/common';
import { HealthGuardController } from './health-guard.controller';
import { HealthGuardService } from './health-guard.service';

@Module({
  controllers: [HealthGuardController],
  providers: [HealthGuardService],
  exports: [HealthGuardService],
})
export class HealthGuardModule {}
