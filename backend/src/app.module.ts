import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard }      from '@common/guards/jwt-auth.guard';
import { PermissionsGuard }  from '@common/guards/permissions.guard';
import { AuthModule }   from '@modules/auth/auth.module';
import { UsersModule }  from '@modules/users/users.module';
import { HealthModule } from '@modules/health/health.module';
import { ImportModule }     from '@modules/import/import.module';
import { AttendanceModule } from '@modules/attendance/attendance.module';
import { ScheduleModule }   from '@modules/schedule/schedule.module';
import { GeneratorModule }  from '@modules/schedule-generator/generator.module';
import { RotationModule }   from '@modules/schedule-rotation/rotation.module';
import { PermissionRequestModule } from '@modules/permission-requests/permission-request.module';
import { RequestsModule }          from '@modules/requests/requests.module';
import { CapacityModule }          from '@modules/capacity/capacity.module';
import { ForecastingModule }       from '@modules/forecasting/forecasting.module';
import { LeaveBalancesModule }     from '@modules/leave-balances/leave-balances.module';
import { EmployeeMergeModule }     from '@modules/employee-merge/employee-merge.module';
import { EmployeesModule }         from '@modules/employees/employees.module';
import { DashboardModule }         from '@modules/dashboard/dashboard.module';
import { RtaModule }               from '@modules/rta/rta.module';
import { OutagesMgmtModule }       from '@modules/outages-mgmt/outages.module';
import { ScorecardModule }         from '@modules/scorecard/scorecard.module';
import { KpiSourceModule }         from '@modules/kpi-source/kpi-source.module';
import { ReportsModule }           from '@modules/reports/reports.module';
import { SettingsModule }          from '@modules/settings/settings.module';
import { TechnicalIssuesModule }  from '@modules/technical-issues/technical-issues.module';
import { BreaksModule }           from '@modules/breaks/breaks.module';
import { IntegrationsModule }     from '@modules/integrations/integrations.module';
import { CalendarModule }         from '@modules/calendar/calendar.module';
import { SkillsModule }           from '@modules/skills/skills.module';
import { NotificationsModule }    from '@modules/notifications/notifications.module';
import { ChatModule }             from '@modules/chat/chat.module';
import { OpsAnalyticsModule }     from '@modules/operations-analytics/ops.module';
import { KnowledgeBaseModule }    from '@modules/knowledge-base/kb.module';
import { AgentSelfModule }        from '@modules/agent-self/me.module';
import { WorkforceAnalyticsModule } from '@modules/workforce-analytics/analytics.module';
import { ProductivityModule }       from '@modules/productivity/productivity.module';
import { ReconModule }              from '@modules/attendance-recon/recon.module';
import { CampaignsModule }         from '@modules/campaigns/campaigns.module';
import { AttendanceCorrectionsModule } from '@modules/attendance-corrections/attendance-corrections.module';
import { ScheduleChangesModule }    from '@modules/schedule-changes/schedule-changes.module';
import { SlaEscalationModule }       from '@modules/sla-escalation/sla-escalation.module';
import { CoachingModule }            from '@modules/coaching/coaching.module';
import { ControlDashboardModule }    from '@modules/control-dashboard/control-dashboard.module';
import { CoverageModule }            from '@modules/coverage/coverage.module';
import { HealthGuardModule }         from '@modules/health-guard/health-guard.module';
import { AnalystModule }             from '@modules/analyst/analyst.module';
import { ReporterModule }            from '@modules/reporter/reporter.module';
import { LlmModule }                 from '@modules/llm/llm.module';
import { AdvisorModule }             from '@modules/advisor/advisor.module';
import { SecurityGuardModule }       from '@modules/security-guard/security-guard.module';
import { ExpertModule }              from '@modules/expert/expert.module';
import { ScorecardGuardModule }      from '@modules/scorecard-guard/scorecard-guard.module';
import { ResearcherModule }          from '@modules/researcher/researcher.module';
import { KnowledgeLedgerModule }     from '@modules/knowledge-ledger/knowledge-ledger.module';
import { TeamLearningModule }        from '@modules/team-learning/team-learning.module';
import { SmokeTestModule }           from '@modules/smoke-test/smoke-test.module';
import { DiagnosticsModule }         from '@modules/diagnostics/diagnostics.module';
import { AttritionModule }           from '@modules/attrition/attrition.module';
import { AutoModeModule }            from '@modules/automode/automode.module';
import { ChiefModule }               from '@modules/chief/chief.module';
import { BotsModule }                from '@modules/bots/bots.module';
import { TenantMiddleware } from '@common/middleware/tenant.middleware';

@Module({
  imports: [
    // Environment config — available globally
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),

    // PostgreSQL via TypeORM
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host:     config.get<string>('POSTGRES_HOST', 'localhost'),
        port:     config.get<number>('POSTGRES_PORT', 5432),
        database: config.get<string>('POSTGRES_DB', 'wfm_db'),
        username: config.get<string>('POSTGRES_USER', 'wfm_user'),
        password: config.get<string>('POSTGRES_PASSWORD'),
        entities:     [
          __dirname + '/database/entities/**/*.entity{.ts,.js}',
          __dirname + '/modules/**/*.entity{.ts,.js}',
        ],
        migrations:   [__dirname + '/database/migrations/**/*{.ts,.js}'],
        synchronize:  false,   // NEVER true — schema managed by SQL migrations
        logging:      config.get('NODE_ENV') === 'development' ? ['error', 'warn'] : ['error'],
        // SSL only when explicitly enabled (managed DB / external host). A containerized
        // Postgres on the same Docker network does not use SSL — POSTGRES_SSL stays false.
        // When SSL is on we VALIDATE the server certificate by default; only set
        // POSTGRES_SSL_INSECURE=true to accept a self-signed cert (avoids silent MITM exposure).
        ssl:          config.get('POSTGRES_SSL') === 'true'
                        ? { rejectUnauthorized: config.get('POSTGRES_SSL_INSECURE') !== 'true' }
                        : false,
        extra: {
          max: 20,             // Connection pool max
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        },
      }),
    }),

    // Global rate limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ([{
        ttl:   config.get<number>('RATE_LIMIT_TTL_SECONDS', 60) * 1000,
        limit: config.get<number>('RATE_LIMIT_MAX_REQUESTS', 100),
      }]),
    }),

    AuthModule,
    UsersModule,
    HealthModule,
    ImportModule,
    AttendanceModule,
    ScheduleModule,
    GeneratorModule,
    RotationModule,
    PermissionRequestModule,
    RequestsModule,
    CapacityModule,
    ForecastingModule,
    LeaveBalancesModule,
    EmployeeMergeModule,
    EmployeesModule,
    DashboardModule,
    RtaModule,
    OutagesMgmtModule,
    ScorecardModule,
    KpiSourceModule,
    ReportsModule,
    SettingsModule,
    TechnicalIssuesModule,
    BreaksModule,
    IntegrationsModule,
    CalendarModule,
    SkillsModule,
    NotificationsModule,
    ChatModule,
    OpsAnalyticsModule,
    KnowledgeBaseModule,
    AgentSelfModule,
    WorkforceAnalyticsModule,
    ProductivityModule,
    ReconModule,
    CampaignsModule,
    AttendanceCorrectionsModule,
    ScheduleChangesModule,
    SlaEscalationModule,
    CoachingModule,
    ControlDashboardModule,
    CoverageModule,
    HealthGuardModule,
    AnalystModule,
    ReporterModule,
    LlmModule,
    AdvisorModule,
    SecurityGuardModule,
    ExpertModule,
    ScorecardGuardModule,
    ResearcherModule,
    KnowledgeLedgerModule,
    TeamLearningModule,
    SmokeTestModule,
    DiagnosticsModule,
    AttritionModule,
    AutoModeModule,
    ChiefModule,
    BotsModule,
  ],
  providers: [
    // Guard execution order: Throttler → JWT → Permissions
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .forRoutes('*');
  }
}
