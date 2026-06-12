import { Controller, Get, Post, Param, Query, Body, UseGuards, Request } from '@nestjs/common';
import {
  IsString, IsOptional, IsArray, IsBoolean, IsNumber,
  IsObject, ValidateNested, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { GeneratorService } from './generator.service';
import { GeneratorOptions } from './generator.types';

class GeneratorOptionsDto {
  @IsOptional() @IsNumber() @Min(0) @Max(24)  minRestHours?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(3)   offDaysPerWeek?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1)   internProductivity?: number;
  @IsOptional() @IsBoolean()                  allowFemaleN?: boolean;
  @IsOptional() @IsNumber() @Min(1) @Max(4)   weeks?: number;
  @IsOptional() @IsArray()                    functionIds?: string[];
}

class GenerateDto {
  @IsString()
  weekStart!: string;

  @IsOptional() @IsArray()
  functionIds?: string[];

  @IsOptional() @IsObject() @ValidateNested() @Type(() => GeneratorOptionsDto)
  options?: Partial<GeneratorOptions>;
}

class SaveDto extends GenerateDto {
  @IsOptional() @IsString()
  label?: string;
}

@Controller('schedule-generator')
@UseGuards(JwtAuthGuard)
@RequirePermissions('schedule.view_draft')
export class GeneratorController {
  constructor(private readonly svc: GeneratorService) {}

  /** List functions (with employee counts) */
  @Get('functions')
  getFunctions(@Request() req: any) {
    return this.svc.getFunctions(req.user.tenantId);
  }

  /** Available week-start dates */
  @Get('available-weeks')
  getWeeks(@Request() req: any) {
    return this.svc.getAvailableWeeks(req.user.tenantId);
  }

  /** Preview generated schedule (no DB save) */
  @Post('generate')
  @RequirePermissions('schedule.generate')
  generate(@Request() req: any, @Body() body: GenerateDto) {
    return this.svc.generate(req.user.tenantId, body.weekStart, body.functionIds, body.options);
  }

  /** Save generated schedule as draft */
  @Post('save')
  @RequirePermissions('schedule.create')
  save(@Request() req: any, @Body() body: SaveDto) {
    return this.svc.generate(req.user.tenantId, body.weekStart, body.functionIds, body.options)
      .then((result) =>
        this.svc.saveDraft(req.user.tenantId, result, req.user.userId, body.label)
          .then((versionId) => ({ ...result, versionId })),
      );
  }

  /** List saved versions */
  @Get('versions')
  listVersions(@Request() req: any, @Query('weekStart') weekStart?: string) {
    return this.svc.listVersions(req.user.tenantId, weekStart);
  }

  /** Get version entries */
  @Get('versions/:id')
  getVersion(@Request() req: any, @Param('id') id: string) {
    return this.svc.getVersionEntries(req.user.tenantId, id);
  }

  /** Publish version */
  @Post('versions/:id/publish')
  @RequirePermissions('schedule.publish')
  publish(@Request() req: any, @Param('id') id: string) {
    return this.svc.publishVersion(req.user.tenantId, id, req.user.userId);
  }
}
