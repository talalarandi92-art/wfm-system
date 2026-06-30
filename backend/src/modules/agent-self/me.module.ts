import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { IntegrationsModule } from '@modules/integrations/integrations.module';

@Module({
  imports: [IntegrationsModule],   // SprinklrService for the agent's own live performance
  controllers: [MeController],
  providers: [MeService],
})
export class AgentSelfModule {}
