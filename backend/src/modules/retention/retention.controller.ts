import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { RetentionService } from './retention.service';

@ApiTags('Retention')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'retention', version: '1' })
@RequirePermissions('settings.edit') // admin-only maintenance surface
export class RetentionController {
  constructor(private readonly svc: RetentionService) {}

  @Get('status')
  @ApiOperation({
    summary:
      'Retention preview: per-table row count, oldest row, and how many rows the next daily prune would remove (dry — no delete)',
  })
  status() {
    return this.svc.status();
  }
}
