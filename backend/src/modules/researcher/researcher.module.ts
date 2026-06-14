import { Module } from '@nestjs/common';
import { LlmModule } from '@modules/llm/llm.module';
import { ResearcherController } from './researcher.controller';
import { ResearcherService } from './researcher.service';

@Module({
  imports: [LlmModule],
  controllers: [ResearcherController],
  providers: [ResearcherService],
  exports: [ResearcherService],
})
export class ResearcherModule {}
