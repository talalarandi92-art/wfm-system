import { Module } from '@nestjs/common';
import { CapacityController } from './capacity.controller';
import { CapacityService } from './capacity.service';
import { StaffingService } from './staffing.service';

@Module({
  controllers: [CapacityController],
  providers: [CapacityService, StaffingService],
  exports: [CapacityService, StaffingService],
})
export class CapacityModule {}
