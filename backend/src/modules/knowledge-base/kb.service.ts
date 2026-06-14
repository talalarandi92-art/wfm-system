import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

interface ArticleInput {
  categoryId?: string | null;
  title: string; titleAr?: string;
  body?: string; bodyAr?: string;
  tags?: string[];
  status?: 'draft' | 'published';
}

@Injectable()
export class KbService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

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
