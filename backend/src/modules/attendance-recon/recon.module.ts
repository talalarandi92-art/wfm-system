import { Module } from '@nestjs/common';
import { ReconController } from './recon.controller';
import { RosterFairnessController } from './roster-fairness.controller';
import { RosterHourlyController } from './roster-hourly.controller';
import { RosterGenerateController } from './roster-generate.controller';
import { RosterAnalyticsController } from './roster-analytics.controller';
import { ReconService } from './recon.service';
import { RosterIngestionService } from './roster-ingestion.service';
import { RosterSharedService } from './roster-shared.service';

@Module({ controllers: [ReconController, RosterFairnessController, RosterHourlyController, RosterGenerateController, RosterAnalyticsController], providers: [ReconService, RosterIngestionService, RosterSharedService] })
export class ReconModule {}
