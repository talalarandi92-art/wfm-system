import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule }   from '@modules/auth/auth.module';
import { UsersModule }  from '@modules/users/users.module';
import { HealthModule } from '@modules/health/health.module';
import { ImportModule } from '@modules/import/import.module';
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
  ],
  providers: [
    // Apply ThrottlerGuard globally
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .forRoutes('*');
  }
}
