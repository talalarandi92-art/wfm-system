import { Module } from '@nestjs/common';
import { OpsController } from './ops.controller';
import { OpsUploadService } from './ops-upload.service';
import { PeopleInsightsService } from './people-insights.service';

@Module({
  controllers: [OpsController],
  providers: [OpsUploadService, PeopleInsightsService],
})
export class OpsAnalyticsModule {}
