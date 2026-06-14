import { Module } from '@nestjs/common';
import { SlaEscalationService } from './sla-escalation.service';
import { SlaEscalationController } from './sla-escalation.controller';

@Module({
  controllers: [SlaEscalationController],
  providers: [SlaEscalationService],
})
export class SlaEscalationModule {}
