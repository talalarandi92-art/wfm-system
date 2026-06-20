import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { LeaveBalancesModule } from '@modules/leave-balances/leave-balances.module';

@Module({
  imports: [LeaveBalancesModule],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
