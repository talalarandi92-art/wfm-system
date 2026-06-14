import { Module } from '@nestjs/common';
import { LlmModule } from '@modules/llm/llm.module';
import { AnalystModule } from '@modules/analyst/analyst.module';
import { ExpertController } from './expert.controller';
import { ExpertService } from './expert.service';

@Module({
  imports: [LlmModule, AnalystModule],
  controllers: [ExpertController],
  providers: [ExpertService],
  exports: [ExpertService],
})
export class ExpertModule {}
