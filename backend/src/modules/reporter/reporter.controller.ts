import { Controller, Get, Post, Delete, Body, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import type { Response } from 'express';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ReporterService } from './reporter.service';

class RecipeDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsArray() sections?: string[];
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) scheduleTime?: string | null;
  @IsOptional() @IsArray() recipients?: string[];
  @IsOptional() @IsBoolean() enabled?: boolean;
}
class GenerateDto {
  @IsOptional() @IsString() recipeId?: string;
  @IsOptional() @IsArray() sections?: string[];
  @IsOptional() @IsString() date?: string;
}

@ApiTags('Reporter')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('reports.view')   // deny-by-default flip 2026-07-06 — reads; writes override below
@Controller({ path: 'reporter', version: '1' })
export class ReporterController {
  constructor(private readonly svc: ReporterService) {}

  @Get('recipes')
  @ApiOperation({ summary: 'List report recipes' })
  recipes(@CurrentUser() u: any) { return this.svc.listRecipes(u.tenantId); }

  @Post('recipes')
  @RequirePermissions('reports.custom')
  @ApiOperation({ summary: 'Create/update a report recipe' })
  saveRecipe(@CurrentUser() u: any, @Body() dto: RecipeDto) { return this.svc.saveRecipe(u.tenantId, u.id ?? u.sub, dto); }

  @Delete('recipes/:id')
  @RequirePermissions('reports.custom')
  deleteRecipe(@CurrentUser() u: any, @Param('id') id: string) { return this.svc.deleteRecipe(u.tenantId, id); }

  @Post('generate')
  @RequirePermissions('reports.custom')
  @ApiOperation({ summary: 'Generate a report now' })
  async generate(@CurrentUser() u: any, @Body() dto: GenerateDto) {
    let recipe: any = undefined;
    if (dto.recipeId) { const list = await this.svc.listRecipes(u.tenantId); recipe = list.find((r: any) => r.id === dto.recipeId); }
    return this.svc.generate(u.tenantId, { recipe, sections: dto.sections, date: dto.date, trigger: 'manual', recipeId: dto.recipeId });
  }

  @Get('runs')
  @ApiOperation({ summary: 'List recent report runs' })
  runs(@CurrentUser() u: any) { return this.svc.listRuns(u.tenantId); }

  @Get('runs/:id')
  run(@CurrentUser() u: any, @Param('id') id: string) { return this.svc.getRun(u.tenantId, id); }

  @Get('runs/:id/excel')
  @ApiOperation({ summary: 'Download a report run as Excel' })
  async excel(@CurrentUser() u: any, @Param('id') id: string, @Res() res: Response) {
    const out = await this.svc.excel(u.tenantId, id);
    if (!out) return res.status(404).json({ message: 'Run not found' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${out.name}"`);
    return res.send(out.buffer);
  }
}
