import { Module } from '@nestjs/common';
import { AnalystModule } from '@modules/analyst/analyst.module';
import { AutoModeController } from './automode.controller';
import { AutoModeService } from './automode.service';

@Module({
  imports: [AnalystModule],
  controllers: [AutoModeController],
  providers: [AutoModeService],
  exports: [AutoModeService],
})
export class AutoModeModule {}
