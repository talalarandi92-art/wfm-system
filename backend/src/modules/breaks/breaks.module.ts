import { Module } from '@nestjs/common';
import { BreaksController } from './breaks.controller';
import { BreaksService } from './breaks.service';
import { BreakSchedulerService } from './break-scheduler.service';

@Module({
  controllers: [BreaksController],
  providers: [BreaksService, BreakSchedulerService],
  exports: [BreaksService],
})
export class BreaksModule {}
