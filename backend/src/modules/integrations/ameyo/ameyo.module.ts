import { Module } from '@nestjs/common';
import { AmeyoController } from './ameyo.controller';

@Module({
  controllers: [AmeyoController],
})
export class AmeyoModule {}
