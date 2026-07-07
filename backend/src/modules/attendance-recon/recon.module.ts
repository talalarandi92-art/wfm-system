import { Module } from '@nestjs/common';
import { ReconController } from './recon.controller';
import { RosterFairnessController } from './roster-fairness.controller';
import { ReconService } from './recon.service';
import { RosterIngestionService } from './roster-ingestion.service';
import { RosterSharedService } from './roster-shared.service';

@Module({ controllers: [ReconController, RosterFairnessController], providers: [ReconService, RosterIngestionService, RosterSharedService] })
export class ReconModule {}
