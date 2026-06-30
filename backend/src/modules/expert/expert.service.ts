import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LlmService } from '@modules/llm/llm.service';
import { AnalystService } from '@modules/analyst/analyst.service';
import { KNOWLEDGE, searchKnowledge, KnowledgeTopic } from './expert.knowledge';

// Stop-words ignored when matching a question against the Knowledge Base.
const KB_STOP = new Set(('the a an and or of to in on for with at by from is are was how what when which '
  + 'في من على الى إلى عن مع هذا هذه ذلك التي الذي او أو كيف ماذا متى وين شو ايش كم').split(/\s+/));

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

  /**
   * Local retrieval over the ingested Contact Center Knowledge Base (kb_articles).
   * Keyword-ranked, no LLM — this is how the bot "learned" the real KB content.
   */
  private async searchKb(tid: string, question: string, limit = 3) {
    const wordsArr = (question.match(/[\p{L}\p{N}]{3,}/gu) || [])
      .filter(w => !KB_STOP.has(w.toLowerCase())).slice(0, 6);
    if (!wordsArr.length) return [] as any[];
    const params: any[] = [tid];
    const conds: string[] = [];
    const scores: string[] = [];
    for (const w of wordsArr) {
      params.push(`%${w}%`);
      const i = params.length;
      conds.push(`(a.title ILIKE $${i} OR a.body ILIKE $${i})`);
      scores.push(`(CASE WHEN a.title ILIKE $${i} OR a.body ILIKE $${i} THEN 1 ELSE 0 END)`);
    }
    params.push(limit);
    try {
      const rows = await this.ds.query(
        `SELECT a.title, c.name AS category, (${scores.join(' + ')}) AS score,
                LEFT(regexp_replace(a.body, '[#*\`>_]', '', 'g'), 700) AS excerpt
           FROM kb_articles a LEFT JOIN kb_categories c ON c.id = a.category_id
          WHERE a.tenant_id = $1 AND a.status = 'published' AND (${conds.join(' OR ')})
          ORDER BY score DESC, length(a.body) ASC
          LIMIT $${params.length}`, params);
      return rows.filter((r: any) => Number(r.score) > 0);
    } catch { return []; }
  }

  async ask(tid: string, question: string) {
    const matched = searchKnowledge(question, 4);
    const kb = await this.searchKb(tid, question, 3);
    const kbBlock = kb.length
      ? '\n\n' + kb.map((r: any) => `📗 ${r.category ? '[' + r.category + '] ' : ''}${r.title}\n${(r.excerpt || '').trim()}`).join('\n\n')
      : '';
    const kbSources = kb.map((r: any) => `KB: ${r.title}`);
    if (this.llm.isConfigured()) {
      const kbCorpus = kb.map((r: any) => `## ${r.title}\n${r.excerpt}`).join('\n\n');
      const corpus = matched.map(k => `## ${k.titleAr}\n${k.body}`).join('\n\n') + (kbCorpus ? '\n\n# دليل المعرفة (KB)\n' + kbCorpus : '');
      // Light live context so answers are grounded in the actual operation.
      const assess = await this.analyst.assess(tid).catch(() => null);
      const live = assess ? `الوضع الحالي: ${assess.headline}؛ أقسام بخطر: ${assess.coverage.functions.filter((f: any) => f.verdict === 'danger').map((f: any) => f.functionName).join('، ') || 'لا شيء'}.` : '';
      const system = `أنت مستشار WFM/كول-سنتر خبير عالمي. اعتمد حصراً على هذه المعرفة المعتمدة وأجب بدقّة عملية بالعربي:\n\n${corpus}`;
      const text = await this.llm.chat(system, [{ role: 'user', content: `${question}\n\n${live}` }], 1100);
      if (text) return { llm: true, answer: text, sources: [...matched.map(k => k.titleAr), ...kbSources] };
    }
    // Fallback (local-only): surface the most relevant knowledge + real KB articles.
    return {
      llm: false,
      answer: matched.map(k => `📘 ${k.titleAr}\n${k.body}`).join('\n\n') + kbBlock,
      sources: [...matched.map(k => k.titleAr), ...kbSources],
    };
  }
}
