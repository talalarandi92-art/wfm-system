import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LlmService } from '@modules/llm/llm.service';
import { CATALOG, gapList, ResearchItem } from './researcher.catalog';

/**
 * Researcher — scouts WFM/contact-center innovations and brings the team the
 * benefit. The catalog carries a baseline status, but each item's REAL status is
 * detected live against this deployment's database — so once a gap is actually
 * built, it stops being reported as a gap (no more "for show" stale list).
 */
@Injectable()
export class ResearcherService {
  constructor(
    private readonly llm: LlmService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  /** Run each item's SQL detectors and upgrade its baseline status to the live truth. */
  private async resolve(tenantId: string): Promise<ResearchItem[]> {
    const probe = async (sql?: string): Promise<boolean> => {
      if (!sql) return false;
      try {
        const r = await this.ds.query(sql, [tenantId]);
        return r.length > 0 && Number(r[0].n) > 0;
      } catch { return false; }
    };
    return Promise.all(CATALOG.map(async (item) => {
      if (!item.detect) return item;
      let status = item.status;
      if (await probe(item.detect.haveSql)) status = 'have';
      else if (status !== 'have' && await probe(item.detect.partialSql)) status = 'partial';
      return { ...item, status };
    }));
  }

  async status(tenantId: string) {
    const items = await this.resolve(tenantId);
    return {
      configured: this.llm.isConfigured(),
      model: this.llm.isConfigured() ? this.llm.modelName : null,
      items: items.length,
      gaps: items.filter(i => i.status !== 'have').length,
    };
  }

  async feed(tenantId: string) {
    const items = await this.resolve(tenantId);
    const byCat = new Map<string, ResearchItem[]>();
    for (const i of items) { if (!byCat.has(i.category)) byCat.set(i.category, []); byCat.get(i.category)!.push(i); }
    return {
      total: items.length,
      gaps: items.filter(i => i.status !== 'have').length,
      resolved: items.filter(i => i.status === 'have').length,
      items,
      byCategory: [...byCat.entries()].map(([category, items]) => ({ category, items })),
    };
  }

  async digest(tenantId: string) {
    const resolved = await this.resolve(tenantId);
    const gaps = resolved.filter(i => i.status !== 'have');
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
