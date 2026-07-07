import { Controller, Get, Post, Param, Query, Body, UseGuards, Request } from '@nestjs/common';
import {
  IsString, IsOptional, IsArray, IsBoolean, IsNumber,
  IsObject, ValidateNested, Min, Max, IsIn,
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
  @IsOptional() @IsArray()                    femaleLateFunctionIds?: string[];
  // Behavioral merge (Director 2026-07-08): classic structures as options
  @IsOptional() @IsIn(['lowest-demand', 'weekend-fair']) offStrategy?: 'lowest-demand' | 'weekend-fair';
  @IsOptional() @IsBoolean()                  rotationFairness?: boolean;
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

  /**
   * POST /schedule-generator/generate-demand — THE generator (behavioral merge,
   * Director-approved 2026-07-08): staffing-engine forecast→Erlang demand basis,
   * per-function allocation, honest gaps; classic engine's weekend-fair OFF
   * structure + rotation-band fairness available via options.offStrategy /
   * options.rotationFairness. The classic /generate remains for comparison and
   * is slated for retirement once the UI is fully repointed.
   */
  @Post('generate-demand')
  @RequirePermissions('schedule.generate')
  generateDemand(
    @Request() req: any,
    @Body() body: GenerateDto,   // validated: offStrategy IsIn, rotationFairness IsBoolean, bounds on offDaysPerWeek/internProductivity (was `options?: any` — bypassed the DTO)
  ) {
    return this.svc.generateDemandDriven(req.user.tenantId, body.weekStart, body.options);
  }

  /**
   * POST /schedule-generator/generate-demand/save — regenerate + save the
   * demand-driven result as a draft schedule_version (D-077). The existing
   * versions/:id/publish path then applies it to agents unchanged.
   */
  @Post('generate-demand/save')
  @RequirePermissions('schedule.create')
  async saveDemand(
    @Request() req: any,
    @Body() body: SaveDto,   // validated (SaveDto extends GenerateDto) — was `options?: any`, bypassing the DTO
  ) {
    const result = await this.svc.generateDemandDriven(req.user.tenantId, body.weekStart, body.options);
    const versionId = await this.svc.saveDemandDraft(req.user.tenantId, result, req.user.userId, body.label);
    await this.svc.logFemaleOverride(req.user.tenantId, req.user.userId ?? null, body.options);
    return { ...result, versionId };
  }

  /**
   * GET /schedule-generator/shift-rate?weekStart=YYYY-MM-DD
   * Rotation % per employee BEFORE approved swaps (fairness basis) vs AFTER.
   */
  @Get('shift-rate')
  getShiftRate(
    @Request() req: any,
    @Query('weekStart') weekStart?: string,
  ) {
    const ws = /^\d{4}-\d{2}-\d{2}$/.test(weekStart ?? '')
      ? weekStart!
      : new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    return this.svc.getShiftRateComparison(req.user.tenantId, ws);
  }

  /** Save generated schedule as draft */
  @Post('save')
  @RequirePermissions('schedule.create')
  save(@Request() req: any, @Body() body: SaveDto) {
    return this.svc.generate(req.user.tenantId, body.weekStart, body.functionIds, body.options)
      .then((result) =>
        this.svc.saveDraft(req.user.tenantId, result, req.user.userId, body.label)
          .then(async (versionId) => {
            await this.svc.logFemaleOverride(req.user.tenantId, req.user.userId ?? null, body.options);
            return { ...result, versionId };
          }),
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
