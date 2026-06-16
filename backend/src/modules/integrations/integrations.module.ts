import { Module } from '@nestjs/common';
import { SprinklrService }    from './sprinklr/sprinklr.service';
import { SprinklrController } from './sprinklr/sprinklr.controller';
import { OdooService }        from './odoo/odoo.service';
import { OdooController }     from './odoo/odoo.controller';
import { AmeyoController }    from './ameyo/ameyo.controller';

@Module({
  controllers: [SprinklrController, OdooController, AmeyoController],
  providers:   [SprinklrService, OdooService],
  exports:     [SprinklrService, OdooService],
})
export class IntegrationsModule {}
