import { Module } from '@nestjs/common';
import { ReportBuilderV2Controller } from './report-builder-v2.controller';
import { ReportBuilderV2Service } from './report-builder-v2.service';

/** BUILDER v2 — universal self-service report/dashboard engine (BLD-1). */
@Module({ controllers: [ReportBuilderV2Controller], providers: [ReportBuilderV2Service] })
export class ReportBuilderV2Module {}
