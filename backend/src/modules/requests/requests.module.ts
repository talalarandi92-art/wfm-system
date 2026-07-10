import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { LeaveBalancesModule } from '@modules/leave-balances/leave-balances.module';
import { BreaksModule } from '@modules/breaks/breaks.module';

@Module({
  imports: [LeaveBalancesModule, BreaksModule],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
