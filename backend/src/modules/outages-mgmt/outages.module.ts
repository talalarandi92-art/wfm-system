import { Module } from '@nestjs/common';
import { OutagesController } from './outages.controller';

@Module({ controllers: [OutagesController] })
export class OutagesMgmtModule {}
