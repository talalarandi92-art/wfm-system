import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BookOpen, Search, Plus, Folder, FileText, Eye, Clock, Tag,
  Edit3, Trash2, X, Save, ChevronRight, History, ArrowLeft,
  CheckCircle2, FileEdit, Globe, Sparkles,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useUiStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface Category { id: string; name: string; name_ar: string; icon: string; article_count: number }
interface ArticleListItem {
  id: string; category_id: string | null; title: string; title_ar: string;
  tags: string[]; status: 'draft' | 'published'; view_count: number;
  published_at: string | null; updated_at: string;
  category_name: string | null; category_icon: string | null;
  author_name: string | null; excerpt: string;
}
interface ArticleFull extends ArticleListItem {
  body: string; body_ar: string; editor_name: string | null;
  category_name_ar: string | null; created_at: string;
}
interface Version { id: string; version_no: number; title: string; created_at: string; edited_by_name: string }

const fmtD = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/* ─── Minimal markdown → HTML (headings, bold, italic, lists, links, code) ── */
function mdToHtml(md: string): string {
  if (!md) return '';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = esc(md);
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>')
             .replace(/^## (.*)$/gm, '<h2>$1</h2>')
             .replace(/^# (.*)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
             .replace(/\*(.+?)\*/g, '<em>$1</em>')
             .replace(/`(.+?)`/g, '<code>$1</code>');
  html = html.replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  // bullet lists
  html = html.replace(/(?:^- .*(?:\n|$))+/gm, m => {
    const items = m.trim().split('\n').map(l => `<li>${l.replace(/^- /, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  html = html.split(/\n{2,}/).map(block =>
    /^<(h\d|ul|li)/.test(block.trim()) ? block : `<p>${block.replace(/\n/g, '<br/>')}</p>`
  ).join('');
  return html;
}

/* ─── Editor Modal ──────────────────────────────────────────────────────── */
function ArticleEditor({ article, categories, onClose, onSaved, ar }: {
  article: Partial<ArticleFull> | null; categories: Category[];
  onClose: () => void; onSaved: () => void; ar: boolean;
}) {
  const [title, setTitle]       = useState(article?.title ?? '');
  const [titleAr, setTitleAr]   = useState(article?.title_ar ?? '');
  const [body, setBody]         = useState(article?.body ?? '');
  const [categoryId, setCat]    = useState(article?.category_id ?? '');
  const [tags, setTags]         = useState((article?.tags ?? []).join(', '));
  const [preview, setPreview]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const isEdit = !!article?.id;

  const save = async (status: 'draft' | 'published') => {
    if (!title.trim()) return;
    setSaving(true);
    const payload = {
      categoryId: categoryId || null,
      title: title.trim(), titleAr: titleAr.trim(),
      body, status,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
    };
    try {
      if (isEdit) await apiClient.patch(`/knowledge-base/articles/${article!.id}`, payload);
      else await apiClient.post('/knowledge-base/articles', payload);
      onSaved();
    } catch {} finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] rounded-2xl flex flex-col overflow-hidden"
        style={{ background: '#0f1527', border: '1px solid rgba(255,255,255,0.12)' }}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/[0.07] flex-shrink-0">
          <h3 className="text-sm font-bold text-white">{isEdit ? (ar ? 'تعديل المقال' : 'Edit Article') : (ar ? 'مقال جديد' : 'New Article')}</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setPreview(p => !p)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                ${preview ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:bg-white/5'}`}>
              <Eye size={12} className="inline me-1" /> {ar ? 'معاينة' : 'Preview'}
            </button>
            <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16} /></button>
          </div>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-3">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder={ar ? 'العنوان (إنجليزي)' : 'Title (English)'}
              className="px-3 py-2 rounded-xl text-sm text-white outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }} />
            <input value={titleAr} onChange={e => setTitleAr(e.target.value)} placeholder={ar ? 'العنوان (عربي)' : 'Title (Arabic)'} dir="rtl"
              className="px-3 py-2 rounded-xl text-sm text-white outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select value={categoryId} onChange={e => setCat(e.target.value)}
              className="px-3 py-2 rounded-xl text-sm text-white outline-none cursor-pointer"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <option value="" style={{ background: '#0f1527' }}>{ar ? 'بدون تصنيف' : 'No category'}</option>
              {categories.map(c => <option key={c.id} value={c.id} style={{ background: '#0f1527' }}>{c.icon} {c.name_ar || c.name}</option>)}
            </select>
            <input value={tags} onChange={e => setTags(e.target.value)} placeholder={ar ? 'وسوم مفصولة بفاصلة' : 'Tags, comma-separated'}
              className="px-3 py-2 rounded-xl text-sm text-white outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }} />
          </div>

          {preview ? (
            <div className="px-4 py-3 rounded-xl kb-prose min-h-[240px]"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
              dangerouslySetInnerHTML={{ __html: mdToHtml(body) }} />
          ) : (
            <textarea value={body} onChange={e => setBody(e.target.value)}
              placeholder={ar
                ? 'محتوى المقال... يدعم Markdown:\n# عنوان\n**عريض**  *مائل*  `كود`\n- نقطة\n[رابط](https://...)'
                : 'Article content... supports Markdown:\n# Heading\n**bold**  *italic*  `code`\n- bullet\n[link](https://...)'}
              className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none resize-none font-mono leading-relaxed"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', minHeight: 240 }} />
          )}
        </div>

        <div className="px-5 py-3 flex items-center justify-end gap-2 border-t border-white/[0.07] flex-shrink-0">
          <button onClick={() => save('draft')} disabled={!title.trim() || saving}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-300 transition-all disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <FileEdit size={13} className="inline me-1" /> {ar ? 'حفظ كمسودة' : 'Save as Draft'}
          </button>
          <button onClick={() => save('published')} disabled={!title.trim() || saving}
            className="px-4 py-2 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#4338ca,#6366f1)' }}>
            <Globe size={13} className="inline me-1" /> {ar ? 'نشر' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Article Reader ────────────────────────────────────────────────────── */
function ArticleReader({ id, ar, canManage, onBack, onEdit, onDeleted }: {
  id: string; ar: boolean; canManage: boolean;
  onBack: () => void; onEdit: (a: ArticleFull) => void; onDeleted: () => void;
}) {
  const [article, setArticle] = useState<ArticleFull | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [showVersions, setShowVersions] = useState(false);

  useEffect(() => {
    apiClient.get(`/knowledge-base/articles/${id}`).then((r: any) => setArticle(r.data)).catch(() => {});
    apiClient.get(`/knowledge-base/articles/${id}/versions`).then((r: any) => setVersions(r.data)).catch(() => {});
  }, [id]);

  const del = async () => {
    if (!confirm(ar ? 'حذف هذا المقال نهائياً؟' : 'Delete this article permanently?')) return;
    await apiClient.delete(`/knowledge-base/articles/${id}`).catch(() => {});
    onDeleted();
  };

  if (!article) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
    </div>
  );

  const body = ar ? (article.body_ar || article.body) : (article.body || article.body_ar);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-all">
        <ArrowLeft size={14} /> {ar ? 'رجوع للقائمة' : 'Back to list'}
      </button>

      <div className="p-6 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            {article.category_name && (
              <span className="inline-flex items-center gap-1 text-[10px] text-indigo-300 mb-1.5 px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(99,102,241,0.12)' }}>
                {article.category_icon} {ar ? (article.category_name_ar || article.category_name) : article.category_name}
              </span>
            )}
            <h1 className="text-xl font-bold text-white leading-snug">{ar ? (article.title_ar || article.title) : article.title}</h1>
          </div>
          {article.status === 'draft' && (
            <span className="flex-shrink-0 text-[10px] font-bold text-amber-300 px-2 py-1 rounded-lg"
              style={{ background: 'rgba(245,158,11,0.12)' }}>{ar ? 'مسودة' : 'DRAFT'}</span>
          )}
        </div>

        <div className="flex items-center gap-3 text-[10px] text-slate-500 mb-4 flex-wrap">
          {article.author_name && <span>✍️ {article.author_name}</span>}
          <span className="flex items-center gap-1"><Eye size={11} /> {article.view_count}</span>
          <span className="flex items-center gap-1"><Clock size={11} /> {fmtD(article.updated_at)}</span>
          {article.editor_name && article.editor_name !== article.author_name && (
            <span>{ar ? 'آخر تعديل:' : 'edited by'} {article.editor_name}</span>
          )}
        </div>

        {article.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {article.tags.map(t => (
              <span key={t} className="flex items-center gap-1 text-[10px] text-slate-400 px-2 py-0.5 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.05)' }}><Tag size={9} /> {t}</span>
            ))}
          </div>
        )}

        <div className="kb-prose" dangerouslySetInnerHTML={{ __html: mdToHtml(body) }} />

        {canManage && (
          <div className="flex items-center gap-2 mt-6 pt-4 border-t border-white/[0.07]">
            <button onClick={() => onEdit(article)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white transition-all"
              style={{ background: 'linear-gradient(135deg,#4338ca,#6366f1)' }}>
              <Edit3 size={13} /> {ar ? 'تعديل' : 'Edit'}
            </button>
            {versions.length > 0 && (
              <button onClick={() => setShowVersions(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                <History size={13} /> {ar ? 'السجل' : 'History'} ({versions.length})
              </button>
            )}
            <button onClick={del}
              className="ms-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all">
              <Trash2 size={13} /> {ar ? 'حذف' : 'Delete'}
            </button>
          </div>
        )}

        {showVersions && (
          <div className="mt-4 space-y-1.5">
            {versions.map(v => (
              <div key={v.id} className="flex items-center justify-between px-3 py-2 rounded-xl text-[11px]"
                style={{ background: 'rgba(255,255,255,0.03)' }}>
                <span className="text-slate-300">v{v.version_no} · {v.title}</span>
                <span className="text-slate-600">{v.edited_by_name} · {fmtD(v.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────────────── */
export default function KnowledgeBasePage() {
  const { lang } = useUiStore();
  const { hasPermission } = useAuthStore();
  const ar = lang === 'ar';
  const canManage = hasPermission('kb.manage');

  const [categories, setCategories] = useState<Category[]>([]);
  const [articles, setArticles]     = useState<ArticleListItem[]>([]);
  const [activeCat, setActiveCat]   = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [showDrafts, setShowDrafts] = useState(false);
  const [reading, setReading]       = useState<string | null>(null);
  const [editor, setEditor]         = useState<Partial<ArticleFull> | null | undefined>(undefined);
  const [loading, setLoading]       = useState(false);
  const [whatsNew, setWhatsNew]     = useState<any>(null);

  const loadCategories = useCallback(() => {
    apiClient.get('/knowledge-base/categories').then((r: any) => setCategories(r.data)).catch(() => {});
  }, []);

  const loadArticles = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (activeCat) params.set('category', activeCat);
    if (search) params.set('search', search);
    if (showDrafts && canManage) params.set('drafts', 'true');
    apiClient.get(`/knowledge-base/articles?${params}`).then((r: any) => setArticles(r.data))
      .catch(() => {}).finally(() => setLoading(false));
  }, [activeCat, search, showDrafts, canManage]);

  useEffect(() => { loadCategories(); }, []);
  useEffect(() => { const t = setTimeout(loadArticles, search ? 300 : 0); return () => clearTimeout(t); }, [loadArticles]);
  useEffect(() => { apiClient.get('/knowledge-base/whats-new?days=45').then((r: any) => setWhatsNew(r.data)).catch(() => {}); }, []);

  // article_id -> change_type (NEW takes priority over UPDATED) for badging cards
  const changeMap = useMemo(() => {
    const m: Record<string, string> = {};
    (whatsNew?.items ?? []).forEach((it: any) => {
      if (!it.article_id) return;
      if (it.change_type === 'new' || !m[it.article_id]) m[it.article_id] = it.change_type;
    });
    return m;
  }, [whatsNew]);

  const totalArticles = categories.reduce((s, c) => s + Number(c.article_count), 0);

  if (reading) {
    return (
      <ArticleReader id={reading} ar={ar} canManage={canManage}
        onBack={() => { setReading(null); loadArticles(); }}
        onEdit={(a) => { setReading(null); setEditor(a); }}
        onDeleted={() => { setReading(null); loadArticles(); loadCategories(); }} />
    );
  }

  return (
    <div className="space-y-4">
      {/* style for rendered markdown */}
      <style>{`
        .kb-prose { color: #cbd5e1; font-size: 14px; line-height: 1.75; }
        .kb-prose h1 { font-size: 20px; font-weight: 700; color: #fff; margin: 16px 0 8px; }
        .kb-prose h2 { font-size: 17px; font-weight: 700; color: #fff; margin: 14px 0 6px; }
        .kb-prose h3 { font-size: 15px; font-weight: 600; color: #e2e8f0; margin: 12px 0 4px; }
        .kb-prose p { margin: 8px 0; }
        .kb-prose ul { margin: 8px 0; padding-inline-start: 22px; list-style: disc; }
        .kb-prose li { margin: 3px 0; }
        .kb-prose code { background: rgba(99,102,241,0.15); color: #a5b4fc; padding: 1px 6px; border-radius: 5px; font-size: 12px; }
        .kb-prose a { color: #818cf8; text-decoration: underline; }
        .kb-prose strong { color: #fff; }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.15)' }}>
            <BookOpen size={18} className="text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{ar ? 'قاعدة المعرفة' : 'Knowledge Base'}</h1>
            <p className="text-xs text-slate-500">{totalArticles} {ar ? 'مقال منشور' : 'published articles'}</p>
          </div>
        </div>
        {canManage && (
          <button onClick={() => setEditor(null)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white transition-all"
            style={{ background: 'linear-gradient(135deg,#4338ca,#6366f1)' }}>
            <Plus size={14} /> {ar ? 'مقال جديد' : 'New Article'}
          </button>
        )}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl max-w-xl"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <Search size={15} className="text-slate-500 flex-shrink-0" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={ar ? 'ابحث في المقالات والوسوم...' : 'Search articles and tags...'}
          className="flex-1 bg-transparent text-sm text-white outline-none placeholder-slate-600" />
        {canManage && (
          <button onClick={() => setShowDrafts(d => !d)}
            className={`text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all flex-shrink-0
              ${showDrafts ? 'bg-amber-500/20 text-amber-300' : 'text-slate-500 hover:bg-white/5'}`}>
            {ar ? 'المسودات' : 'Drafts'}
          </button>
        )}
      </div>

      {/* What's New / Updated — continuous-learning feed */}
      {whatsNew && (Number(whatsNew.counts?.new || 0) + Number(whatsNew.counts?.updated || 0)) > 0 && (
        <div className="rounded-2xl p-4"
          style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.07), rgba(59,130,246,0.07))', border: '1px solid rgba(99,102,241,0.18)' }}>
          <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Sparkles size={15} className="text-emerald-400" />
              <span className="text-sm font-bold text-white">{ar ? 'الجديد والمحدّث' : "What's New"}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full text-emerald-300" style={{ background: 'rgba(34,197,94,0.15)' }}>
                {whatsNew.counts.new} {ar ? 'جديد' : 'new'}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full text-blue-300" style={{ background: 'rgba(59,130,246,0.15)' }}>
                {whatsNew.counts.updated} {ar ? 'محدّث' : 'updated'}</span>
            </div>
            {whatsNew.lastImport && (
              <span className="text-[10px] text-slate-500">{ar ? 'آخر مزامنة' : 'Last sync'}: {fmtD(whatsNew.lastImport.created_at)}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {whatsNew.items.slice(0, 12).map((it: any, i: number) => (
              <button key={i} onClick={() => it.article_id && setReading(it.article_id)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] text-slate-200 hover:bg-white/[0.06] transition-all"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: it.change_type === 'new' ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.15)', color: it.change_type === 'new' ? '#6ee7b7' : '#93c5fd' }}>
                  {it.change_type === 'new' ? (ar ? 'جديد' : 'NEW') : (ar ? 'محدّث' : 'UPD')}</span>
                {it.category_icon && <span>{it.category_icon}</span>}
                <span className="truncate max-w-[210px]">{it.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Categories sidebar */}
        <div className="space-y-1">
          <button onClick={() => setActiveCat(null)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all text-start
              ${!activeCat ? 'bg-indigo-500/15 text-white' : 'text-slate-400 hover:bg-white/5'}`}>
            <span className="flex items-center gap-2"><Folder size={14} /> {ar ? 'كل المقالات' : 'All Articles'}</span>
            <span className="text-[10px] text-slate-500">{totalArticles}</span>
          </button>
          {categories.map(c => (
            <button key={c.id} onClick={() => setActiveCat(c.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all text-start
                ${activeCat === c.id ? 'bg-indigo-500/15 text-white' : 'text-slate-400 hover:bg-white/5'}`}>
              <span className="flex items-center gap-2 min-w-0"><span>{c.icon}</span>
                <span className="truncate">{ar ? (c.name_ar || c.name) : c.name}</span></span>
              <span className="text-[10px] text-slate-500 flex-shrink-0">{c.article_count}</span>
            </button>
          ))}
        </div>

        {/* Articles list */}
        <div className="lg:col-span-3 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            </div>
          ) : articles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-600">
              <FileText size={32} className="opacity-25" />
              <p className="text-sm">{ar ? 'لا توجد مقالات' : 'No articles found'}</p>
              {canManage && <button onClick={() => setEditor(null)} className="text-xs text-indigo-400 hover:underline">{ar ? 'أنشئ أول مقال' : 'Create the first one'}</button>}
            </div>
          ) : (
            articles.map(a => (
              <button key={a.id} onClick={() => setReading(a.id)}
                className="w-full text-start p-4 rounded-2xl transition-all hover:bg-white/[0.04] group"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {a.category_icon && <span className="text-xs">{a.category_icon}</span>}
                      <h3 className="text-sm font-bold text-white truncate group-hover:text-indigo-300 transition-all">
                        {ar ? (a.title_ar || a.title) : a.title}
                      </h3>
                      {a.status === 'draft' && (
                        <span className="flex-shrink-0 text-[9px] font-bold text-amber-300 px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(245,158,11,0.12)' }}>{ar ? 'مسودة' : 'DRAFT'}</span>
                      )}
                      {changeMap[a.id] && (
                        <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded"
                          style={{ background: changeMap[a.id] === 'new' ? 'rgba(34,197,94,0.14)' : 'rgba(59,130,246,0.14)', color: changeMap[a.id] === 'new' ? '#6ee7b7' : '#93c5fd' }}>
                          {changeMap[a.id] === 'new' ? (ar ? 'جديد' : 'NEW') : (ar ? 'محدّث' : 'UPDATED')}</span>
                      )}
                    </div>
                    {a.excerpt && <p className="text-[11px] text-slate-500 line-clamp-2 mb-2">{a.excerpt.trim()}</p>}
                    <div className="flex items-center gap-3 text-[10px] text-slate-600 flex-wrap">
                      {a.author_name && <span>{a.author_name}</span>}
                      <span className="flex items-center gap-1"><Eye size={10} /> {a.view_count}</span>
                      <span className="flex items-center gap-1"><Clock size={10} /> {fmtD(a.updated_at)}</span>
                      {a.tags?.slice(0, 3).map(t => (
                        <span key={t} className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.05)' }}>{t}</span>
                      ))}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-slate-600 group-hover:text-indigo-400 transition-all flex-shrink-0 mt-1" />
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {editor !== undefined && (
        <ArticleEditor article={editor} categories={categories} ar={ar}
          onClose={() => setEditor(undefined)}
          onSaved={() => { setEditor(undefined); loadArticles(); loadCategories(); }} />
      )}
    </div>
  );
}
