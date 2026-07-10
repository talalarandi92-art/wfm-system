import { Module } from '@nestjs/common';
import { BreaksController } from './breaks.controller';
import { BreaksService } from './breaks.service';
import { BreakSchedulerService } from './break-scheduler.service';
import { BreakPolicyService } from './break-policy.service';
import { CoverageModule } from '../coverage/coverage.module';

@Module({
  imports: [CoverageModule],   // CoverageRebuildService — in-process headcount_intervals rebuild
  controllers: [BreaksController],
  providers: [BreaksService, BreakSchedulerService, BreakPolicyService],
  exports: [BreaksService, BreakPolicyService],
})
export class BreaksModule {}
