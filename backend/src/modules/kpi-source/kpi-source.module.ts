import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { KpiSourceController } from './kpi-source.controller';
import { KpiSourceService } from './kpi-source.service';

@Module({
  imports: [MulterModule.register({ storage: memoryStorage() })],
  controllers: [KpiSourceController],
  providers: [KpiSourceService],
  exports: [KpiSourceService],
})
export class KpiSourceModule {}
