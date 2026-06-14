import { Module } from '@nestjs/common';
import { OpsController } from './ops.controller';
import { OpsUploadService } from './ops-upload.service';

@Module({
  controllers: [OpsController],
  providers: [OpsUploadService],
})
export class OpsAnalyticsModule {}
