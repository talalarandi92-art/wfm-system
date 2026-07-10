import { Module } from '@nestjs/common';
import { CoverageController } from './coverage.controller';
import { CoverageRebuildService } from './coverage-rebuild.service';

@Module({
  controllers: [CoverageController],
  providers: [CoverageRebuildService],
  exports: [CoverageRebuildService],
})
export class CoverageModule {}
