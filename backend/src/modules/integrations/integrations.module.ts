import { Module } from '@nestjs/common';
import { SprinklrService }    from './sprinklr/sprinklr.service';
import { SprinklrController } from './sprinklr/sprinklr.controller';
import { SprinklrReportService }    from './sprinklr/sprinklr-report.service';
import { SprinklrReportController } from './sprinklr/sprinklr-report.controller';
import { OdooService }        from './odoo/odoo.service';
import { OdooController }     from './odoo/odoo.controller';
import { OdooBridgeController } from './odoo/odoo-bridge.controller';
import { AmeyoController }    from './ameyo/ameyo.controller';
import { AmeyoService }       from './ameyo/ameyo.service';

@Module({
  controllers: [SprinklrController, SprinklrReportController, OdooController, OdooBridgeController, AmeyoController],
  providers:   [SprinklrService, SprinklrReportService, OdooService, AmeyoService],
  exports:     [SprinklrService, SprinklrReportService, OdooService, AmeyoService],
})
export class IntegrationsModule {}
