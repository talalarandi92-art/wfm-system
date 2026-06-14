import {
  Controller, Get, Post, Patch, Delete, Param, Query, Body,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { KbService } from './kb.service';

interface ArticleBody {
  categoryId?: string | null;
  title: string; titleAr?: string;
  body?: string; bodyAr?: string;
  tags?: string[];
  status?: 'draft' | 'published';
}

@ApiTags('Knowledge Base')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('kb.view')
@Controller({ path: 'knowledge-base', version: '1' })
export class KbController {
  constructor(private readonly kb: KbService) {}

  /* ── Categories ─────────────────────────────────────────────────────────── */
  @Get('categories')
  @ApiOperation({ summary: 'List categories with published article counts' })
  categories(@CurrentUser() user: any) {
    return this.kb.listCategories(user.tenantId);
  }

  @Post('categories')
  @RequirePermissions('kb.manage')
  @ApiOperation({ summary: 'Create a category' })
  createCategory(@CurrentUser() user: any, @Body() b: { name: string; nameAr?: string; icon?: string }) {
    return this.kb.createCategory(user.tenantId, b.name, b.nameAr ?? '', b.icon ?? '📁');
  }

  @Delete('categories/:id')
  @RequirePermissions('kb.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a category (articles kept, uncategorized)' })
  deleteCategory(@CurrentUser() user: any, @Param('id') id: string) {
    return this.kb.deleteCategory(user.tenantId, id);
  }

  /* ── Articles ───────────────────────────────────────────────────────────── */
  @Get('articles')
  @ApiOperation({ summary: 'List/search articles' })
  articles(
    @CurrentUser() user: any,
    @Query('category') categoryId?: string,
    @Query('search') search?: string,
    @Query('drafts') drafts?: string,
  ) {
    const includeDrafts = drafts === 'true' && (user.permissionCodes?.includes?.('kb.manage') ?? false);
    return this.kb.listArticles(user.tenantId, { categoryId, search, includeDrafts });
  }

  @Get('articles/:id')
  @ApiOperation({ summary: 'Get a single article (increments view count)' })
  article(@CurrentUser() user: any, @Param('id') id: string) {
    return this.kb.getArticle(user.tenantId, id, true);
  }

  @Get('articles/:id/versions')
  @ApiOperation({ summary: 'List version history of an article' })
  versions(@CurrentUser() user: any, @Param('id') id: string) {
    return this.kb.listVersions(user.tenantId, id);
  }

  @Post('articles')
  @RequirePermissions('kb.manage')
  @ApiOperation({ summary: 'Create an article (draft or published)' })
  create(@CurrentUser() user: any, @Body() b: ArticleBody) {
    return this.kb.createArticle(user.tenantId, user.id, b);
  }

  @Patch('articles/:id')
  @RequirePermissions('kb.manage')
  @ApiOperation({ summary: 'Update an article (snapshots previous version)' })
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() b: ArticleBody) {
    return this.kb.updateArticle(user.tenantId, user.id, id, b);
  }

  @Delete('articles/:id')
  @RequirePermissions('kb.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an article' })
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.kb.deleteArticle(user.tenantId, id);
  }
}
