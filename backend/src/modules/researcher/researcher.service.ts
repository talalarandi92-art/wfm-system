import { Injectable } from '@nestjs/common';
import { LlmService } from '@modules/llm/llm.service';
import { CATALOG, gapList, ResearchItem } from './researcher.catalog';

/**
 * Researcher — scouts WFM/contact-center innovations and brings the team the
 * benefit. Today it serves a curated catalog mapped to our platform's gaps (free,
 * offline). With an LLM key (+ internet) it can synthesize fresh findings and pull
 * live sources on top of this base.
 */
@Injectable()
export class ResearcherService {
  constructor(private readonly llm: LlmService) {}

  status() { return { configured: this.llm.isConfigured(), model: this.llm.isConfigured() ? this.llm.modelName : null, items: CATALOG.length, gaps: gapList().length }; }

  feed() {
    const byCat = new Map<string, ResearchItem[]>();
    for (const i of CATALOG) { if (!byCat.has(i.category)) byCat.set(i.category, []); byCat.get(i.category)!.push(i); }
    return {
      total: CATALOG.length,
      gaps: gapList().length,
      items: CATALOG,
      byCategory: [...byCat.entries()].map(([category, items]) => ({ category, items })),
    };
  }

  async digest() {
    const gaps = gapList();
    if (this.llm.isConfigured()) {
      const corpus = gaps.map(g => `- ${g.titleAr}: ${g.summaryAr} (لدينا: ${g.status})`).join('\n');
      const text = await this.llm.chat(
        'أنت باحث WFM يرصد أحدث الممارسات ويربطها بمنصّة العميل. اكتب موجزاً بحثياً قصيراً بأهم 3 فرص تطوير مرتّبة بالأولوية بالعربي.',
        [{ role: 'user', content: `الفجوات مقابل أفضل الممارسات:\n${corpus}` }], 700);
      if (text) return { llm: true, digest: text, gaps: gaps.length };
    }
    return {
      llm: false,
      digest: gaps.slice(0, 5).map(g => `🔬 ${g.titleAr}\n${g.summaryAr}\n↳ ${g.actionAr}`).join('\n\n'),
      gaps: gaps.length,
    };
  }
}
