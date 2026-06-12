import {
  Controller, Get, Post, Body, UseGuards,
} from '@nestjs/common';
import {
  ApiTags, ApiBearerAuth, ApiOperation,
} from '@nestjs/swagger';
import { IsUUID, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { EmployeeMergeService } from './employee-merge.service';

class MergeDto {
  @IsUUID()
  survivorId: string;

  @IsUUID()
  mergedId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@ApiTags('Employee Merge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('employees.view')
@Controller('employees')
export class EmployeeMergeController {
  constructor(private readonly svc: EmployeeMergeService) {}

  /** Suspected duplicate employees (same normalized name) — suggestions only */
  @Get('duplicates')
  @ApiOperation({ summary: 'List suspected duplicate employees grouped by normalized name' })
  duplicates(@CurrentUser() user: any) {
    return this.svc.listDuplicates(user.tenantId);
  }

  /** Merge one confirmed duplicate pair (human-confirmed, never automatic) */
  @Post('merge')
  @RequirePermissions('employees.edit')
  @ApiOperation({ summary: 'Merge a duplicate employee into the surviving record' })
  merge(@CurrentUser() user: any, @Body() dto: MergeDto) {
    return this.svc.merge(
      user.tenantId,
      { id: user.id, email: user.email },
      dto.survivorId,
      dto.mergedId,
      dto.reason,
    );
  }
}
