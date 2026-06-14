import { Module } from '@nestjs/common';
import { AttendanceCorrectionsController } from './attendance-corrections.controller';

@Module({ controllers: [AttendanceCorrectionsController] })
export class AttendanceCorrectionsModule {}
