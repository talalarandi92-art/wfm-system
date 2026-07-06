import { Module } from '@nestjs/common';
import { AmeyoController } from './ameyo.controller';
import { AmeyoService } from './ameyo.service';

@Module({
  controllers: [AmeyoController],
  providers: [AmeyoService],
  exports: [AmeyoService],
})
export class AmeyoModule {}
