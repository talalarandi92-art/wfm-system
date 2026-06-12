import { Module } from '@nestjs/common';
import { RtaController } from './rta.controller';

@Module({ controllers: [RtaController] })
export class RtaModule {}
