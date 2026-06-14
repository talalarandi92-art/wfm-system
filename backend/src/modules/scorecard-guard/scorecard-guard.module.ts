import { Module } from '@nestjs/common';
import { ScorecardGuardController } from './scorecard-guard.controller';
import { ScorecardGuardService } from './scorecard-guard.service';

@Module({
  controllers: [ScorecardGuardController],
  providers: [ScorecardGuardService],
  exports: [ScorecardGuardService],
})
export class ScorecardGuardModule {}
