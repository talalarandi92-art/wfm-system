import { Module } from '@nestjs/common';
import { LlmModule } from '@modules/llm/llm.module';
import { KbController } from './kb.controller';
import { KbService } from './kb.service';

@Module({
  imports: [LlmModule],
  controllers: [KbController],
  providers: [KbService],
})
export class KnowledgeBaseModule {}
