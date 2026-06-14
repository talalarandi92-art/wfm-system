import { Module } from '@nestjs/common';
import { HealthGuardModule } from '@modules/health-guard/health-guard.module';
import { AnalystController } from './analyst.controller';
import { AnalystService } from './analyst.service';

@Module({
  imports: [HealthGuardModule],
  controllers: [AnalystController],
  providers: [AnalystService],
  exports: [AnalystService],
})
export class AnalystModule {}
