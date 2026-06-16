import { Module } from '@nestjs/common';
import { HealthGuardModule } from '@modules/health-guard/health-guard.module';
import { SecurityGuardModule } from '@modules/security-guard/security-guard.module';
import { AnalystModule } from '@modules/analyst/analyst.module';
import { SmokeTestModule } from '@modules/smoke-test/smoke-test.module';
import { DiagnosticsController } from './diagnostics.controller';

@Module({
  imports: [HealthGuardModule, SecurityGuardModule, AnalystModule, SmokeTestModule],
  controllers: [DiagnosticsController],
})
export class DiagnosticsModule {}
