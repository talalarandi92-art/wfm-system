import { Module } from '@nestjs/common';
import { HealthGuardModule } from '@modules/health-guard/health-guard.module';
import { AnalystModule } from '@modules/analyst/analyst.module';
import { ReporterModule } from '@modules/reporter/reporter.module';
import { AdvisorModule } from '@modules/advisor/advisor.module';
import { SecurityGuardModule } from '@modules/security-guard/security-guard.module';
import { ExpertModule } from '@modules/expert/expert.module';
import { ScorecardGuardModule } from '@modules/scorecard-guard/scorecard-guard.module';
import { ResearcherModule } from '@modules/researcher/researcher.module';
import { BotsController } from './bots.controller';

@Module({
  imports: [HealthGuardModule, AnalystModule, ReporterModule, AdvisorModule, SecurityGuardModule, ExpertModule, ScorecardGuardModule, ResearcherModule],
  controllers: [BotsController],
})
export class BotsModule {}
