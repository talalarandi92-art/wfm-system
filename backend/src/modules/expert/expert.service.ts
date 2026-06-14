import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LlmService } from '@modules/llm/llm.service';
import { AnalystService } from '@modules/analyst/analyst.service';
import { KNOWLEDGE, searchKnowledge, KnowledgeTopic } from './expert.knowledge';

/**
 * Expert Advisor — a second, deeply-taught advisor. Its brain is a curated WFM
 * knowledge corpus (strongest industry sources + our codified rules). Without an
 * LLM key it does keyword retrieval over the corpus (still demonstrates depth);
 * with a key it reasons over the matched knowledge + the live assessment.
 */
@Injectable()
export class ExpertService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly llm: LlmService,
    private readonly analyst: AnalystService,
  ) {}

  status() { return { configured: this.llm.isConfigured(), model: this.llm.isConfigured() ? this.llm.modelName : null, topics: KNOWLEDGE.length }; }

  topics() { return KNOWLEDGE.map(k => ({ topic: k.topic, titleAr: k.titleAr, titleEn: k.titleEn, tags: k.tags })); }

  knowledge(topic?: string): KnowledgeTopic[] {
    if (!topic) return KNOWLEDGE;
    return KNOWLEDGE.filter(k => k.topic === topic);
  }

  async ask(tid: string, question: string) {
    const matched = searchKnowledge(question, 4);
    if (this.llm.isConfigured()) {
      const corpus = matched.map(k => `## ${k.titleAr}\n${k.body}`).join('\n\n');
      // Light live context so answers are grounded in the actual operation.
      const assess = await this.analyst.assess(tid).catch(() => null);
      const live = assess ? `الوضع الحالي: ${assess.headline}؛ أقسام بخطر: ${assess.coverage.functions.filter((f: any) => f.verdict === 'danger').map((f: any) => f.functionName).join('، ') || 'لا شيء'}.` : '';
      const system = `أنت مستشار WFM/كول-سنتر خبير عالمي. اعتمد حصراً على هذه المعرفة المعتمدة وأجب بدقّة عملية بالعربي:\n\n${corpus}`;
      const text = await this.llm.chat(system, [{ role: 'user', content: `${question}\n\n${live}` }], 1100);
      if (text) return { llm: true, answer: text, sources: matched.map(k => k.titleAr) };
    }
    // Fallback: surface the most relevant knowledge sections.
    return {
      llm: false,
      answer: matched.map(k => `📘 ${k.titleAr}\n${k.body}`).join('\n\n'),
      sources: matched.map(k => k.titleAr),
    };
  }
}
