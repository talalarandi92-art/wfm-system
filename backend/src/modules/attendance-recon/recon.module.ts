import { Module } from '@nestjs/common';
import { ReconController } from './recon.controller';
import { ReconService } from './recon.service';
import { RosterIngestionService } from './roster-ingestion.service';

@Module({ controllers: [ReconController], providers: [ReconService, RosterIngestionService] })
export class ReconModule {}
