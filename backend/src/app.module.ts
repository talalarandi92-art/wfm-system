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
        entities:     [__dirname + '/database/entities/**/*.entity{.ts,.js}'],
        migrations:   [__dirname + '/database/migrations/**/*{.ts,.js}'],
        synchronize:  false,   // NEVER true — schema managed by SQL migrations
        logging:      config.get('NODE_ENV') === 'development' ? ['error', 'warn'] : ['error'],
        ssl:          config.get('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
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
