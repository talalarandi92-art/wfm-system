import { Module } from '@nestjs/common';
import { RtaController } from './rta.controller';
import { RtaIntradayService } from './rta-intraday.service';
import { IntegrationsModule } from '../integrations/integrations.module';

/** IntegrationsModule is imported READ-ONLY: /rta/alerts reuses SprinklrService's
 *  already-honest degraded-feed flags (staleSec / isStale / queueFeedMissing)
 *  instead of re-deriving feed health and risking a second, disagreeing answer. */
@Module({
  imports: [IntegrationsModule],
  controllers: [RtaController],
  providers: [RtaIntradayService],
  exports: [RtaIntradayService],
})
export class RtaModule {}
