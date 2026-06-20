import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { KNOWLEDGE } from '@modules/expert/expert.knowledge';
import { CATALOG } from '@modules/researcher/researcher.catalog';
import { PROV_EXPERT, PROV_RESEARCH, DEFAULT_EXPERT, DEFAULT_RESEARCH } from './provenance';

/**
 * Knowledge Ledger — a living report of every piece of knowledge/expertise the
 * platform holds: WHAT it is, the BENEFIT it gives, WHERE it was acquired, and
 * WHEN. Merges the Expert corpus + the Researcher catalog with their provenance,
 * newest first. Grows automatically as knowledge is added.
 */
@ApiTags('Knowledge Ledger')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'knowledge-ledger', version: '1' })
@RequirePermissions('hc.view')
export class KnowledgeLedgerController {
  @Get()
  @ApiOperation({ summary: 'Every knowledge/expertise item with what / benefit / source / date' })
  ledger() {
    const expertise = KNOWLEDGE.map(k => {
      const p = PROV_EXPERT[k.topic] ?? DEFAULT_EXPERT;
      return {
        kind: 'expertise', id: k.topic, category: k.tags[0] ?? k.topic,
        title: k.titleAr,
        what: k.body.length > 220 ? k.body.slice(0, 220) + '…' : k.body,
        benefit: p.benefit, source: p.source, addedAt: p.addedAt,
      };
    });
    const research = CATALOG.map(r => {
      const p = PROV_RESEARCH[r.id] ?? DEFAULT_RESEARCH;
      return {
        kind: 'research', id: r.id, category: r.category, status: r.status,
        title: r.titleAr, what: r.summaryAr,
        benefit: r.actionAr, source: p.source, addedAt: p.addedAt,
      };
    });
    const entries = [...expertise, ...research].sort((a, b) =>
      b.addedAt.localeCompare(a.addedAt) || a.title.localeCompare(b.title));

    return {
      total: entries.length,
      expertise: expertise.length,
      research: research.length,
      entries,
    };
  }
}
