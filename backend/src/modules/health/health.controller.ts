import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck, HealthCheckService, TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '@common/decorators/permissions.decorator';

@ApiTags('Health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Health check — database connectivity' })
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
    ]);
  }
}
