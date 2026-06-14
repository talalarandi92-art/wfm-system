import { Module } from '@nestjs/common';
import { LlmModule } from '@modules/llm/llm.module';
import { HealthGuardModule } from '@modules/health-guard/health-guard.module';
import { AnalystModule } from '@modules/analyst/analyst.module';
import { SecurityGuardModule } from '@modules/security-guard/security-guard.module';
import { ReporterModule } from '@modules/reporter/reporter.module';
import { AdvisorModule } from '@modules/advisor/advisor.module';
import { AutoModeModule } from '@modules/automode/automode.module';
import { ScorecardGuardModule } from '@modules/scorecard-guard/scorecard-guard.module';
import { ChiefController } from './chief.controller';
import { ChiefService } from './chief.service';

@Module({
  imports: [LlmModule, HealthGuardModule, AnalystModule, SecurityGuardModule, ReporterModule, AdvisorModule, AutoModeModule, ScorecardGuardModule],
  controllers: [ChiefController],
  providers: [ChiefService],
})
export class ChiefModule {}
