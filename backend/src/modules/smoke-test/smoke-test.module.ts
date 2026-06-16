import { Module } from '@nestjs/common';
import { GeneratorModule } from '@modules/schedule-generator/generator.module';
import { SmokeTestController } from './smoke-test.controller';
import { SmokeTestService } from './smoke-test.service';

@Module({
  imports: [GeneratorModule],
  controllers: [SmokeTestController],
  providers: [SmokeTestService],
  exports: [SmokeTestService],
})
export class SmokeTestModule {}
