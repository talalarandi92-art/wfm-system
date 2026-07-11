import { Module } from '@nestjs/common';
import { KpiRegistryController } from './kpi-registry.controller';
import { KpiRegistryService } from './kpi-registry.service';

@Module({
  controllers: [KpiRegistryController],
  providers: [KpiRegistryService],
  exports: [KpiRegistryService],
})
export class KpiRegistryModule {}
