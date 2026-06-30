import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LlmService } from '@modules/llm/llm.service';

interface ArticleInput {
  categoryId?: string | null;
  title: string; titleAr?: string;
  body?: string; bodyAr?: string;
  tags?: string[];
  status?: 'draft' | 'published';
}

@Injectable()
export class KbService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly llm: LlmService,
  ) {}

  /* ── What's New (continuous-learning change feed) ───────────────────────── */
  async whatsNew(tenantId: string, days = 30, limit = 60) {
    const items = await this.ds.query(
      `SELECT ch.article_id, ch.slug, ch.title, ch.category, ch.change_type, ch.changed_at,
              c.icon AS category_icon
         FROM kb_changes ch
         LEFT JOIN kb_articles a ON a.id = ch.article_id
         LEFT JOIN kb_categories c ON c.id = a.category_id
        WHERE ch.tenant_id = $1 AND ch.changed_at >= NOW() - ($2 || ' days')::interval
        ORDER BY ch.changed_at DESC
        LIMIT $3`, [tenantId, String(days), limit]);
    const counts = await this.ds.query(
      `SELECT change_type, COUNT(*)::int n FROM kb_changes
        WHERE tenant_id = $1 AND changed_at >= NOW() - ($2 || ' days')::interval
        GROUP BY change_type`, [tenantId, String(days)]);
    const lastImport = await this.ds.query(
      `SELECT created_at, articles, words FROM kb_import_log
        WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`, [tenantId]);
    const c: any = { new: 0, updated: 0 };
    counts.forEach((r: any) => { c[r.change_type] = r.n; });
    return { days, counts: c, items, lastImport: lastImport[0] || null };
  }

  /* ── Reply Helper: paste customer message → best-matching reply scripts ──── */
  async suggestReply(tenantId: string, text: string, limit = 6) {
    const q = (text || '').toLowerCase();
    if (q.trim().length < 2) return { matches: [] };
    // intent keywords → category (customer message maps to the reply bucket)
    const INTENT: Record<string, string[]> = {
      'Delivery': ['وين طلب', 'متى يوصل', 'متى بيوصل', 'تأخر', 'تاخر', 'توصيل', 'يوصل', 'ما وصل', 'لساته', 'تتبع', 'شحن', 'delivery', 'late', 'track', 'where is my order', 'arrive', 'shipping', 'shipment'],
      'Order Info': ['طلبي', 'رقم الطلب', 'order number', 'my order', 'order info'],
      'Returns': ['ارجاع', 'إرجاع', 'استرجاع', 'ارجع', 'أرجع', 'رجع', 'return', 'refund', 'استرداد', 'مبلغ', 'فلوس', 'المبلغ', 'مرتجع', 'استرد'],
      'Exchange': ['استبدال', 'تبديل', 'exchange', 'مقاس', 'size', 'بدل', 'أبدل'],
      'Cancellation': ['الغاء', 'إلغاء', 'الغي', 'ألغي', 'إلغي', 'تلغي', 'cancel', 'ابطال', 'بطل', 'ما بدي الطلب', 'ما بدي', 'لا تجهز', "don't want"],
      'Payment': ['دفع', 'payment', 'بطاقة', 'knet', 'كنت', 'فيزا', 'card', 'pay', 'خصم مبلغ', 'انخصم'],
      'Tabby Info': ['تابي', 'tabby'],
      'Tamara': ['تمارا', 'tamara'],
      'Complaint': ['شكوى', 'مشكلة', 'complaint', 'سيء', 'زعلان', 'problem', 'مو راضي', 'غاضب', 'سيئة'],
      'App': ['تطبيق', 'app', 'application', 'الموقع', 'website', 'ما يفتح', 'معلق'],
      'Security Questions': ['تحقق', 'هوية', 'security', 'verify', 'أسئلة الأمان', 'identity'],
      'Empathy': ['اعتذار', 'آسف', 'sorry', 'متضايق'],
      'Product': ['منتج', 'product', 'item', 'بضاعة', 'الغرض'],
      'PNA': ['غير متوفر', 'نفذ', 'out of stock', 'unavailable', 'pna', 'مو موجود'],
      'Promotions': ['خصم', 'عرض', 'كوبون', 'discount', 'promo', 'offer', 'coupon', 'كود'],
      'Reset Password': ['كلمة المرور', 'باسورد', 'password', 'reset', 'نسيت'],
      'Gift Card': ['هدية', 'gift card', 'بطاقة هدايا', 'gift'],
      'Address Info': ['عنوان', 'address', 'منطقة', 'تغيير العنوان'],
    };
    const catScore: Record<string, number> = {};
    for (const cat in INTENT) for (const kw of INTENT[cat]) if (q.includes(kw)) catScore[cat] = (catScore[cat] || 0) + 1;
    // Greetings → Protocols (the greeting / "how may I help" scripts)
    const greet = /\b(hi+|hello+|hey+|good\s*(morning|evening|afternoon))\b/i.test(q)
      || /(مرحب|السلام|سلام|هلا|اهلا|أهلا|هاي|صباح|مساء|اهلين)/.test(q);
    if (greet) catScore['Protocols'] = (catScore['Protocols'] || 0) + 3;

    const tokens = (q.match(/[\p{L}\p{N}]{3,}/gu) || []).filter(w => !['the', 'and', 'you', 'for', 'هذا', 'هذه', 'من', 'على', 'الى', 'في'].includes(w)).slice(0, 25);
    const scripts = await this.ds.query(
      `SELECT category, en, ar, source, code, keywords FROM kb_scripts WHERE tenant_id=$1`, [tenantId]);
    let scored = scripts.map((s: any) => {
      let score = (catScore[s.category] || 0) * 4;
      for (const t of tokens) if ((s.keywords || '').includes(t)) score += 1;
      return { ...s, score };
    }).filter((s: any) => s.score > 0).sort((a: any, b: any) => b.score - a.score);
    // Always respond: if nothing matched, fall back to greeting + ask-for-order scripts.
    if (scored.length === 0) {
      scored = scripts
        .filter((s: any) => ['Protocols', 'Order Info'].includes(s.category))
        .map((s: any) => ({ ...s, score: 0 }))
        .slice(0, 6);
    }
    const matches = scored.slice(0, limit).map((s: any) => ({ category: s.category, en: s.en, ar: s.ar, source: s.source, score: s.score }));

    // Also surface matching KB articles (the policy/guide + its explanation).
    let articles: any[] = [];
    if (tokens.length) {
      const aParams: any[] = [tenantId]; const aConds: string[] = []; const aScore: string[] = [];
      for (const t of tokens) {
        aParams.push(`%${t}%`); const i = aParams.length;
        aConds.push(`(a.title ILIKE $${i} OR a.body ILIKE $${i})`);
        aScore.push(`(CASE WHEN a.title ILIKE $${i} THEN 2 WHEN a.body ILIKE $${i} THEN 1 ELSE 0 END)`);
      }
      const rawArticles = await this.ds.query(
        `SELECT a.id, a.title, c.name AS category, (${aScore.join(' + ')}) AS score,
                LEFT(regexp_replace(COALESCE(NULLIF(a.body,''),''), '[#*\`>_]', '', 'g'), 380)  AS excerpt,
                LEFT(regexp_replace(COALESCE(NULLIF(a.body,''),''), '[#\`>_]', '', 'g'), 9000)   AS body
           FROM kb_articles a LEFT JOIN kb_categories c ON c.id = a.category_id
          WHERE a.tenant_id = $1 AND a.status = 'published' AND (${aConds.join(' OR ')})
          ORDER BY score DESC, length(a.body) ASC LIMIT 8`, aParams)
        .then((r: any) => r.filter((x: any) => Number(x.score) > 0)).catch(() => []);
      const seenTitle = new Set<string>();
      for (const a of rawArticles) {
        const key = (a.title || '').trim().toLowerCase();
        if (seenTitle.has(key)) continue;
        seenTitle.add(key); articles.push(a);
        if (articles.length >= 3) break;
      }
    }

    const topScore = scored[0]?.score || 0;
    const llmConfigured = this.llm.isConfigured();

    // HYBRID: confident local script match AND no policy question → return locally
    // (free, private). Otherwise, if the LLM is enabled, compose a natural reply +
    // a short policy explanation grounded in the scripts + KB articles.
    if ((topScore >= 4 && articles.length === 0) || !llmConfigured) {
      return { mode: topScore >= 4 ? 'local' : 'local-weak', llmConfigured, generated: null, matches, articles };
    }
    const isAr = /[؀-ۿ]/.test(text);
    const scriptCtx = scored.slice(0, 10).map((s: any, i: number) =>
      `${i + 1}. [${s.category}] AR: ${s.ar || '-'} | EN: ${s.en || '-'}`).join('\n');
    const policyCtx = articles.map((a: any, i: number) => `${i + 1}. ${a.title}: ${a.excerpt}`).join('\n') || '(none)';
    const system = `You are a Boutiqaat Contact Center assistant helping an AGENT. Using ONLY the provided scripts + KB policy excerpts, answer in the SAME language as the input (${isAr ? 'Arabic' : 'English'}). Produce two short parts, clearly labelled:
1) "${isAr ? 'الرد المقترح' : 'Suggested reply'}": the message to send the customer (adapt a script; ask for order number if needed).
2) "${isAr ? 'الشرح' : 'Explanation'}": 1–3 lines explaining the relevant policy to the agent.
Be concise, professional, on-brand. Do not invent policy not in the context.

Scripts:
${scriptCtx}

KB policy excerpts:
${policyCtx}`;
    const generated = await this.llm.chat(system, [{ role: 'user', content: text }], 650).catch(() => null);
    return { mode: generated ? 'llm' : 'local-weak', llmConfigured, model: generated ? this.llm.modelName : null, generated, matches, articles };
  }

  /* ── Categories ─────────────────────────────────────────────────────────── */
  listCategories(tenantId: string) {
    return this.ds.query(
      `SELECT c.id, c.name, c.name_ar, c.icon, c.sort_order,
              COUNT(a.id) FILTER (WHERE a.status='published') AS article_count
       FROM kb_categories c
       LEFT JOIN kb_articles a ON a.category_id = c.id AND a.tenant_id = c.tenant_id
       WHERE c.tenant_id = $1
       GROUP BY c.id ORDER BY c.sort_order, c.name`,
      [tenantId],
    );
  }

  async createCategory(tenantId: string, name: string, nameAr: string, icon: string) {
    const [row] = await this.ds.query(
      `INSERT INTO kb_categories (tenant_id, name, name_ar, icon, sort_order)
       VALUES ($1,$2,$3,$4, (SELECT COALESCE(MAX(sort_order),0)+1 FROM kb_categories WHERE tenant_id=$1))
       RETURNING id, name, name_ar, icon, sort_order`,
      [tenantId, name, nameAr ?? name, icon ?? '📁'],
    );
    return row;
  }

  async deleteCategory(tenantId: string, id: string) {
    await this.ds.query(`DELETE FROM kb_categories WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
  }

  /* ── Articles ───────────────────────────────────────────────────────────── */
  /** List published articles (+ drafts if includeDrafts). Filter by category / search. */
  async listArticles(tenantId: string, opts: { categoryId?: string; search?: string; includeDrafts?: boolean }) {
    const params: any[] = [tenantId];
    const where: string[] = ['a.tenant_id = $1'];
    if (!opts.includeDrafts) where.push(`a.status = 'published'`);
    if (opts.categoryId) { params.push(opts.categoryId); where.push(`a.category_id = $${params.length}`); }
    if (opts.search) {
      params.push(`%${opts.search}%`);
      where.push(`(a.title ILIKE $${params.length} OR a.title_ar ILIKE $${params.length}
                   OR a.body ILIKE $${params.length} OR a.body_ar ILIKE $${params.length}
                   OR EXISTS (SELECT 1 FROM unnest(a.tags) t WHERE t ILIKE $${params.length}))`);
    }
    return this.ds.query(
      `SELECT a.id, a.category_id, a.title, a.title_ar, a.tags, a.status,
              a.view_count, a.published_at, a.updated_at,
              c.name AS category_name, c.name_ar AS category_name_ar, c.icon AS category_icon,
              u.username AS author_name,
              LEFT(regexp_replace(COALESCE(NULLIF(a.body,''), a.body_ar, ''), '[#*\`>_-]', '', 'g'), 160) AS excerpt
       FROM kb_articles a
       LEFT JOIN kb_categories c ON c.id = a.category_id
       LEFT JOIN users u ON u.id = a.author_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.status='draft' DESC, a.updated_at DESC`,
      params,
    );
  }

  async getArticle(tenantId: string, id: string, incrementView = false) {
    const [row] = await this.ds.query(
      `SELECT a.*, c.name AS category_name, c.name_ar AS category_name_ar, c.icon AS category_icon,
              u.username AS author_name,
              e.username AS editor_name
       FROM kb_articles a
       LEFT JOIN kb_categories c ON c.id = a.category_id
       LEFT JOIN users u ON u.id = a.author_id
       LEFT JOIN users e ON e.id = a.updated_by
       WHERE a.id=$1 AND a.tenant_id=$2`,
      [id, tenantId],
    );
    if (!row) throw new NotFoundException('Article not found');
    if (incrementView) {
      await this.ds.query(`UPDATE kb_articles SET view_count = view_count + 1 WHERE id=$1`, [id]);
      row.view_count = (row.view_count ?? 0) + 1;
    }
    return row;
  }

  async createArticle(tenantId: string, userId: string, input: ArticleInput) {
    const status = input.status ?? 'draft';
    const [row] = await this.ds.query(
      `INSERT INTO kb_articles
         (tenant_id, category_id, title, title_ar, body, body_ar, tags, status, author_id, updated_by, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9, CASE WHEN $8='published' THEN NOW() ELSE NULL END)
       RETURNING *`,
      [tenantId, input.categoryId ?? null, input.title, input.titleAr ?? null,
       input.body ?? '', input.bodyAr ?? '', input.tags ?? [], status, userId],
    );
    return row;
  }

  async updateArticle(tenantId: string, userId: string, id: string, input: ArticleInput) {
    // Snapshot the current version before overwriting
    const current = await this.getArticle(tenantId, id);
    const [{ next_no }] = await this.ds.query(
      `SELECT COALESCE(MAX(version_no),0)+1 AS next_no FROM kb_article_versions WHERE article_id=$1`, [id],
    );
    await this.ds.query(
      `INSERT INTO kb_article_versions (article_id, version_no, title, title_ar, body, body_ar, edited_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, next_no, current.title, current.title_ar, current.body, current.body_ar, userId],
    );

    const status = input.status ?? current.status;
    const publishedAt = status === 'published' && current.status !== 'published' ? 'NOW()' : 'published_at';
    await this.ds.query(
      `UPDATE kb_articles SET
         category_id=$2, title=$3, title_ar=$4, body=$5, body_ar=$6, tags=$7,
         status=$8, updated_by=$9, updated_at=NOW(), published_at=${publishedAt}
       WHERE id=$1 AND tenant_id=$10`,
      [id, input.categoryId ?? current.category_id, input.title ?? current.title,
       input.titleAr ?? current.title_ar, input.body ?? current.body, input.bodyAr ?? current.body_ar,
       input.tags ?? current.tags, status, userId, tenantId],
    );
    // Re-fetch for a consistent row shape (TypeORM returns [rows,count] for UPDATE...RETURNING)
    return this.getArticle(tenantId, id);
  }

  async deleteArticle(tenantId: string, id: string) {
    await this.ds.query(`DELETE FROM kb_articles WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
  }

  listVersions(tenantId: string, articleId: string) {
    return this.ds.query(
      `SELECT v.id, v.version_no, v.title, v.title_ar, v.created_at,
              u.username AS edited_by_name
       FROM kb_article_versions v
       LEFT JOIN users u ON u.id = v.edited_by
       WHERE v.article_id = $1
         AND EXISTS (SELECT 1 FROM kb_articles a WHERE a.id=v.article_id AND a.tenant_id=$2)
       ORDER BY v.version_no DESC`,
      [articleId, tenantId],
    );
  }
}
