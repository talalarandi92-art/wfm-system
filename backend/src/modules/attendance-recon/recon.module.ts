import { Module } from '@nestjs/common';
import { ReconController } from './recon.controller';
import { RosterFairnessController } from './roster-fairness.controller';
import { RosterHourlyController } from './roster-hourly.controller';
import { RosterGenerateController } from './roster-generate.controller';
import { RosterAnalyticsController } from './roster-analytics.controller';
import { WfhReportController } from './wfh-report.controller';
import { ScheduleOpsController } from './schedule-ops.controller';
import { RosterReportsController } from './roster-reports.controller';
import { DataTrustController } from './data-trust.controller';
import { ExplainController } from './explain.controller';
import { OtTrackerController } from './ot-tracker.controller';
import { ReconService } from './recon.service';
import { RosterIngestionService } from './roster-ingestion.service';
import { RosterSharedService } from './roster-shared.service';
import { OtTrackerService } from './ot-tracker.service';
import { OtYearService } from './ot-year.service';
import { DataSpanService } from './data-span.service';

@Module({ controllers: [ReconController, RosterFairnessController, RosterHourlyController, RosterGenerateController, RosterAnalyticsController, WfhReportController, ScheduleOpsController, RosterReportsController, OtTrackerController, DataTrustController, ExplainController], providers: [ReconService, RosterIngestionService, RosterSharedService, OtTrackerService, OtYearService, DataSpanService] })
export class ReconModule {}
