import { Module } from '@nestjs/common';
import { LlmModule } from '@modules/llm/llm.module';
import { AnalystModule } from '@modules/analyst/analyst.module';
import { HealthGuardModule } from '@modules/health-guard/health-guard.module';
import { AdvisorController } from './advisor.controller';
import { AdvisorService } from './advisor.service';

@Module({
  imports: [LlmModule, AnalystModule, HealthGuardModule],
  controllers: [AdvisorController],
  providers: [AdvisorService],
  exports: [AdvisorService],
})
export class AdvisorModule {}
