import { Module } from '@nestjs/common';
import { CoverageController } from './coverage.controller';

@Module({ controllers: [CoverageController] })
export class CoverageModule {}
