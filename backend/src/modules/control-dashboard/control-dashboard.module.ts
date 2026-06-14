import { Module } from '@nestjs/common';
import { ControlDashboardController } from './control-dashboard.controller';

@Module({ controllers: [ControlDashboardController] })
export class ControlDashboardModule {}
