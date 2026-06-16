import { Module } from '@nestjs/common';
import { AttritionController } from './attrition.controller';

@Module({
  controllers: [AttritionController],
})
export class AttritionModule {}
