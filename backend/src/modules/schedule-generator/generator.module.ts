import { Module } from '@nestjs/common';
import { GeneratorController } from './generator.controller';
import { GeneratorService } from './generator.service';
import { CapacityModule } from '../capacity/capacity.module';

@Module({
  imports: [CapacityModule],   // demand-driven generation reads the live-plan requirement curve
  controllers: [GeneratorController],
  providers: [GeneratorService],
  exports: [GeneratorService],
})
export class GeneratorModule {}
