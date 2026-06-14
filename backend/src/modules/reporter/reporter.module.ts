import { Module } from '@nestjs/common';
import { AnalystModule } from '@modules/analyst/analyst.module';
import { HealthGuardModule } from '@modules/health-guard/health-guard.module';
import { ReporterController } from './reporter.controller';
import { ReporterService } from './reporter.service';

@Module({
  imports: [AnalystModule, HealthGuardModule],
  controllers: [ReporterController],
  providers: [ReporterService],
  exports: [ReporterService],
})
export class ReporterModule {}
