import { Module } from '@nestjs/common';
import { ScheduleChangesController } from './schedule-changes.controller';

@Module({ controllers: [ScheduleChangesController] })
export class ScheduleChangesModule {}
