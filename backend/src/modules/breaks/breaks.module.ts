import { Module } from '@nestjs/common';
import { BreaksController } from './breaks.controller';
import { BreaksService } from './breaks.service';
import { BreakSchedulerService } from './break-scheduler.service';
import { BreakPolicyService } from './break-policy.service';
import { BreakReleaseService } from './break-release.service';
import { BreakReportsService } from './break-reports.service';
import { BreakSimulationService } from './break-simulation.service';
import { CoverageModule } from '../coverage/coverage.module';

@Module({
  imports: [CoverageModule],   // CoverageRebuildService — in-process headcount_intervals rebuild
  controllers: [BreaksController],
  providers: [BreaksService, BreakSchedulerService, BreakPolicyService, BreakReleaseService, BreakReportsService, BreakSimulationService],
  exports: [BreaksService, BreakPolicyService, BreakReleaseService],
})
export class BreaksModule {}
