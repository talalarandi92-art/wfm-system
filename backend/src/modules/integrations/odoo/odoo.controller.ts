import {
  Controller, Get, Post, Put, Body, Query,
  Request, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { OdooService, OdooConfig } from './odoo.service';

@ApiTags('Integrations — Odoo')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('settings.edit')   // integration config + syncs are admin-only
@Controller('integrations/odoo')
export class OdooController {
  constructor(private readonly odoo: OdooService) {}

  /** Test Odoo connection */
  @Post('test')
  @ApiOperation({ summary: 'Test Odoo connection with provided credentials' })
  @HttpCode(HttpStatus.OK)
  testConnection(@Body() config: OdooConfig) {
    return this.odoo.testConnection(config);
  }

  /** Save Odoo config */
  @Put('config')
  @ApiOperation({ summary: 'Save Odoo API configuration' })
  async saveConfig(@Request() req: any, @Body() config: OdooConfig) {
    await this.odoo.saveConfig(req.user.tenantId, config);
    return { ok: true };
  }

  /** Get Odoo config (API key masked) */
  @Get('config')
  @ApiOperation({ summary: 'Get Odoo configuration' })
  async getConfig(@Request() req: any) {
    const cfg = await this.odoo.getConfig(req.user.tenantId);
    if (cfg?.apiKey) cfg.apiKey = cfg.apiKey.slice(0, 4) + '••••••••';
    return cfg;
  }

  /** Preview employees from Odoo (without committing) */
  @Post('employees/preview')
  @ApiOperation({ summary: 'Preview employees from Odoo' })
  @HttpCode(HttpStatus.OK)
  async previewEmployees(@Request() req: any, @Body() body: { config?: OdooConfig }) {
    const config = body.config ?? await this.odoo.getConfig(req.user.tenantId);
    if (!config) return { error: 'No Odoo config found. Save config first.' };
    const employees = await this.odoo.fetchEmployees(config);
    return { count: employees.length, sample: employees.slice(0, 20) };
  }

  /** Sync employees Odoo → WFM */
  @Post('employees/sync')
  @ApiOperation({ summary: 'Sync employees from Odoo to WFM' })
  @HttpCode(HttpStatus.OK)
  async syncEmployees(@Request() req: any, @Body() body: { config?: OdooConfig }) {
    const config = body.config ?? await this.odoo.getConfig(req.user.tenantId);
    if (!config) return { error: 'No Odoo config found.' };
    return this.odoo.syncEmployeesToWfm(req.user.tenantId, config);
  }

  /** Preview leaves from Odoo */
  @Post('leaves/preview')
  @ApiOperation({ summary: 'Preview approved leaves from Odoo for a date range' })
  @HttpCode(HttpStatus.OK)
  async previewLeaves(
    @Request() req: any,
    @Body() body: { config?: OdooConfig; dateFrom: string; dateTo: string },
  ) {
    const config = body.config ?? await this.odoo.getConfig(req.user.tenantId);
    if (!config) return { error: 'No Odoo config found.' };
    const leaves = await this.odoo.fetchLeaves(config, body.dateFrom, body.dateTo);
    return { count: leaves.length, leaves: leaves.slice(0, 50) };
  }

  /** Sync leaves Odoo → WFM schedule */
  @Post('leaves/sync')
  @ApiOperation({ summary: 'Sync approved leaves from Odoo to WFM schedule' })
  @HttpCode(HttpStatus.OK)
  async syncLeaves(
    @Request() req: any,
    @Body() body: { config?: OdooConfig; dateFrom: string; dateTo: string },
  ) {
    const config = body.config ?? await this.odoo.getConfig(req.user.tenantId);
    if (!config) return { error: 'No Odoo config found.' };
    return this.odoo.syncLeavesToWfm(req.user.tenantId, config, body.dateFrom, body.dateTo);
  }

  /** Sync history */
  @Get('history')
  @ApiOperation({ summary: 'Get Odoo sync history' })
  getHistory(@Request() req: any) {
    return this.odoo.getSyncHistory(req.user.tenantId);
  }
}
