import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ReportBuilderV2Service } from './report-builder-v2.service';

/**
 * BUILDER v2 — universal self-service report/dashboard engine (Sprinklr replacement).
 * One builder over EVERY data domain. All reads gated by reports.view; each data
 * source additionally enforces its own permission + agent self-scope in the service.
 */
@ApiTags('Report Builder v2')
@ApiBearerAuth()
@Controller('report-builder-v2')
@UseGuards(JwtAuthGuard)
export class ReportBuilderV2Controller {
  constructor(private readonly svc: ReportBuilderV2Service) {}

  @Get('sources')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'List data sources the user may build from (permission-filtered)' })
  sources(@Req() req: any) { return this.svc.sources(req.user.permissionCodes ?? []); }

  @Get('sources/:key')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Dimensions + metrics for one data source' })
  sourceDetail(@Req() req: any, @Param('key') key: string) {
    return this.svc.sourceDetail(req.user.permissionCodes ?? [], key);
  }

  @Post('run')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Compile + run a builder request → rows (RBAC + agent self-scope enforced)' })
  run(@Req() req: any, @Body() body: any) {
    return this.svc.run(req.user, body);
  }

  @Post('drill')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Drill an aggregated cell → the underlying un-aggregated rows (same RBAC + agent scope)' })
  drill(@Req() req: any, @Body() body: any) {
    return this.svc.drill(req.user, body);
  }

  /* saved reports */
  @Get('saved-reports')
  @RequirePermissions('reports.view')
  listReports(@Req() req: any) { return this.svc.listReports(req.user.tenantId, req.user.id); }

  @Get('saved-reports/:id')
  @RequirePermissions('reports.view')
  getReport(@Req() req: any, @Param('id') id: string) { return this.svc.getReport(req.user.tenantId, req.user.id, id); }

  @Post('saved-reports')
  @RequirePermissions('reports.view')
  saveReport(@Req() req: any, @Body() b: any) { return this.svc.saveReport(req.user, b); }

  @Post('saved-reports/:id/duplicate')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Duplicate a report (own or shared) into a fresh private copy' })
  duplicateReport(@Req() req: any, @Param('id') id: string) { return this.svc.duplicateReport(req.user, id); }

  @Put('saved-reports/:id')
  @RequirePermissions('reports.view')
  updateReport(@Req() req: any, @Param('id') id: string, @Body() b: any) { return this.svc.updateReport(req.user, id, b); }

  @Delete('saved-reports/:id')
  @RequirePermissions('reports.view')
  deleteReport(@Req() req: any, @Param('id') id: string) { return this.svc.deleteReport(req.user, id); }

  /* saved dashboards */
  @Get('saved-dashboards')
  @RequirePermissions('reports.view')
  listDashboards(@Req() req: any) { return this.svc.listDashboards(req.user.tenantId, req.user.id); }

  @Get('saved-dashboards/:id')
  @RequirePermissions('reports.view')
  getDashboard(@Req() req: any, @Param('id') id: string) { return this.svc.getDashboard(req.user.tenantId, req.user.id, id); }

  @Post('saved-dashboards')
  @RequirePermissions('reports.view')
  saveDashboard(@Req() req: any, @Body() b: any) { return this.svc.saveDashboard(req.user, b); }

  @Post('saved-dashboards/:id/duplicate')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Duplicate a dashboard (own or shared) into a fresh private copy' })
  duplicateDashboard(@Req() req: any, @Param('id') id: string) { return this.svc.duplicateDashboard(req.user, id); }

  @Put('saved-dashboards/:id')
  @RequirePermissions('reports.view')
  updateDashboard(@Req() req: any, @Param('id') id: string, @Body() b: any) { return this.svc.updateDashboard(req.user, id, b); }

  @Delete('saved-dashboards/:id')
  @RequirePermissions('reports.view')
  deleteDashboard(@Req() req: any, @Param('id') id: string) { return this.svc.deleteDashboard(req.user, id); }
}
