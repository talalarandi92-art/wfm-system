/**
 * Report Library (Builder v2 · BLD-5) — the SAVED LIBRARY / gallery capstone.
 *
 * One gallery over every saved REPORT and DASHBOARD the user may see (their own
 * + anything a teammate shared). Filter by type, search by name, sort by recency.
 * Each card carries the actions a library needs: Open (launch into the matching
 * builder pre-loaded), Duplicate, Rename, Share/Unshare, Delete. RBAC mirrors the
 * backend: everyone sees own + shared; only the OWNER can rename / share / delete.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Library, Wrench, LayoutGrid, Copy, Pencil, Share2, Trash2, Globe, Lock,
  ExternalLink, Search, User, X,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import {
  useInjectDsStyles, tp, ts, NxCard, NxPageHeader, NxEmpty, NxLoading, NxError,
} from '@/components/ds';
import { StatTile } from '@/components/dazzle';

type Kind = 'report' | 'dashboard';
type LibItem = {
  id: string; kind: Kind; name: string; description?: string | null;
  source_key?: string; section_count?: number; widget_count?: number;
  shared?: boolean; is_owner?: boolean; owner_name?: string | null; updated_at?: string;
};
type Source = { key: string; label_en: string; label_ar: string };
type TypeFilter = 'all' | Kind;
type SortBy = 'updated' | 'name';

const RPT_COLOR = '#a78bfa';   // report accent (violet)
const DSH_COLOR = '#6366f1';   // dashboard accent (indigo)

export default function ReportLibraryPage() {
  useInjectDsStyles();
  const nav = useNavigate();
  const { lang, dark } = useUiStore(); const ar = lang === 'ar';
  const L = (en: string, arv: string) => (ar ? arv : en);

  const [reports, setReports] = useState<LibItem[]>([]);
  const [dashboards, setDashboards] = useState<LibItem[]>([]);
  const [sources, setSources] = useState<Record<string, Source>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);   // id currently mutating

  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('updated');

  /* ── load ── */
  const refresh = useCallback(async () => {
    setErr(false);
    try {
      const [r, d]: any = await Promise.all([
        apiClient.get('/report-builder-v2/saved-reports'),
        apiClient.get('/report-builder-v2/saved-dashboards'),
      ]);
      setReports((r.data ?? []).map((x: any): LibItem => ({ ...x, kind: 'report' })));
      setDashboards((d.data ?? []).map((x: any): LibItem => ({ ...x, kind: 'dashboard' })));
    } catch { setErr(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    apiClient.get('/report-builder-v2/sources')
      .then((r: any) => {
        const map: Record<string, Source> = {};
        for (const s of (r.data?.sources ?? [])) map[s.key] = s;
        setSources(map);
      }).catch(() => {});
  }, [refresh]);

  /* ── unified + filtered + sorted ── */
  const items = useMemo(() => {
    let all: LibItem[] = [...reports, ...dashboards];
    if (typeFilter !== 'all') all = all.filter(i => i.kind === typeFilter);
    const term = q.trim().toLowerCase();
    if (term) all = all.filter(i => i.name.toLowerCase().includes(term) || (i.owner_name ?? '').toLowerCase().includes(term));
    all.sort((a, b) => sortBy === 'name'
      ? a.name.localeCompare(b.name)
      : String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
    return all;
  }, [reports, dashboards, typeFilter, q, sortBy]);

  const counts = useMemo(() => ({
    reports: reports.length, dashboards: dashboards.length,
    shared: [...reports, ...dashboards].filter(i => i.shared).length,
    mine: [...reports, ...dashboards].filter(i => i.is_owner).length,
  }), [reports, dashboards]);

  const srcLabel = (key?: string) => {
    if (!key) return '';
    const s = sources[key]; return s ? (ar ? s.label_ar : s.label_en) : key;
  };

  /* ── actions ── */
  const base = (i: LibItem) => `/report-builder-v2/saved-${i.kind}s/${i.id}`;

  const openItem = (i: LibItem) => {
    if (i.kind === 'report') nav(`/roster?tab=report-builder&load=${i.id}`);
    else nav(`/roster?tab=dashboard-builder&load=${i.id}&view=1`);
  };
  const duplicate = async (i: LibItem) => {
    setBusy(i.id);
    try { await apiClient.post(`${base(i)}/duplicate`); await refresh(); }
    catch { alert(L('Duplicate failed.', 'فشل النسخ.')); }
    finally { setBusy(null); }
  };
  const rename = async (i: LibItem) => {
    const name = window.prompt(L('New name:', 'الاسم الجديد:'), i.name);
    if (!name || name === i.name) return;
    setBusy(i.id);
    try { await apiClient.put(base(i), { name }); await refresh(); }
    catch { alert(L('Rename failed.', 'فشل إعادة التسمية.')); }
    finally { setBusy(null); }
  };
  const toggleShare = async (i: LibItem) => {
    setBusy(i.id);
    try { await apiClient.put(base(i), { shared: !i.shared }); await refresh(); }
    catch { alert(L('Share change failed.', 'فشل تغيير المشاركة.')); }
    finally { setBusy(null); }
  };
  const remove = async (i: LibItem) => {
    if (!window.confirm(L(`Delete "${i.name}"? This cannot be undone.`, `حذف "${i.name}"؟ لا يمكن التراجع.`))) return;
    setBusy(i.id);
    try { await apiClient.delete(base(i)); await refresh(); }
    catch { alert(L('Delete failed.', 'فشل الحذف.')); }
    finally { setBusy(null); }
  };

  /* ── styles ── */
  const border = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
  const chip = (active: boolean, color = '#6366f1'): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
    border: `1px solid ${active ? color + '80' : border}`, background: active ? `${color}20` : (dark ? 'rgba(255,255,255,0.03)' : '#fff'), color: active ? color : ts(dark),
  });
  const iconBtn = (color: string): React.CSSProperties => ({
    width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', cursor: 'pointer',
    border: `1px solid ${border}`, background: dark ? 'rgba(255,255,255,0.03)' : '#fff', color,
  });
  const selectStyle: React.CSSProperties = {
    padding: '7px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600,
    background: dark ? 'rgba(255,255,255,0.05)' : '#fff', border: `1px solid ${border}`, color: tp(dark), outline: 'none', cursor: 'pointer',
  };

  return (
    <div dir={ar ? 'rtl' : 'ltr'} style={{ animation: 'ds-fadein .4s ease' }}>
      <NxPageHeader
        title="Report Library" titleAr="مكتبة التقارير"
        desc="Every saved report & dashboard — open, duplicate, rename, share or delete"
        descAr="كل التقارير واللوحات المحفوظة — افتح، انسخ، أعد التسمية، شارك أو احذف"
        icon={Library} color="#8b5cf6" dark={dark} ar={ar}
        onRefresh={refresh}
      />

      {/* ── summary tiles ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        <StatTile icon={Wrench}     label={L('Reports', 'التقارير')}    num={counts.reports}    color={RPT_COLOR} delay={0} />
        <StatTile icon={LayoutGrid} label={L('Dashboards', 'اللوحات')}  num={counts.dashboards} color={DSH_COLOR} delay={60} />
        <StatTile icon={Globe}      label={L('Shared', 'مشترك')}        num={counts.shared}     color="#22c55e"   delay={120} />
        <StatTile icon={User}       label={L('Mine', 'ملكي')}           num={counts.mine}       color="#f59e0b"   delay={180} />
      </div>

      {/* ── controls ── */}
      <NxCard dark={dark} pad="12px 14px" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* search */}
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: 'absolute', insetInlineStart: 10, top: '50%', transform: 'translateY(-50%)', color: ts(dark) }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={L('Search by name or owner…', 'ابحث بالاسم أو المالك…')}
              style={{ width: '100%', padding: '8px 12px', paddingInlineStart: 32, borderRadius: 10, fontSize: 12.5,
                background: dark ? 'rgba(255,255,255,0.05)' : '#fff', border: `1px solid ${border}`, color: tp(dark), outline: 'none' }} />
            {q && <button onClick={() => setQ('')} style={{ ...iconBtn('#ef4444'), position: 'absolute', insetInlineEnd: 4, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, border: 'none', background: 'transparent' }}><X size={13} /></button>}
          </div>
          {/* type filter */}
          <div style={{ display: 'inline-flex', gap: 6 }}>
            {([['all', L('All', 'الكل')], ['report', L('Reports', 'التقارير')], ['dashboard', L('Dashboards', 'اللوحات')]] as [TypeFilter, string][]).map(([v, lbl]) => (
              <button key={v} onClick={() => setTypeFilter(v)} style={chip(typeFilter === v, '#8b5cf6')}>{lbl}</button>
            ))}
          </div>
          {/* sort */}
          <select value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)} style={selectStyle}>
            <option value="updated">{L('Recently updated', 'الأحدث تحديثاً')}</option>
            <option value="name">{L('Name (A→Z)', 'الاسم (أ→ي)')}</option>
          </select>
        </div>
      </NxCard>

      {/* ── states ── */}
      {loading && <NxLoading dark={dark} ar={ar} />}
      {!loading && err && <NxError onRetry={refresh} dark={dark} ar={ar} />}
      {!loading && !err && items.length === 0 && (
        <NxEmpty icon={Library} ar={ar} dark={dark}
          title={q || typeFilter !== 'all' ? 'No matches' : 'Your library is empty'}
          titleAr={q || typeFilter !== 'all' ? 'لا توجد نتائج' : 'مكتبتك فارغة'}
          desc={q || typeFilter !== 'all' ? 'Try a different search or filter.' : 'Build a report or dashboard and press Save — it lands here.'}
          descAr={q || typeFilter !== 'all' ? 'جرّب بحثاً أو فلتراً مختلفاً.' : 'أنشئ تقريراً أو لوحة واضغط حفظ — سيظهر هنا.'} />
      )}

      {/* ── gallery ── */}
      {!loading && !err && items.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {items.map(i => {
            const isRpt = i.kind === 'report';
            const accent = isRpt ? RPT_COLOR : DSH_COLOR;
            const Ic = isRpt ? Wrench : LayoutGrid;
            const summary = isRpt
              ? srcLabel(i.source_key)
              : `${i.section_count ?? 0} ${L('sections', 'أقسام')} · ${i.widget_count ?? 0} ${L('widgets', 'أدوات')}`;
            return (
              <NxCard key={`${i.kind}-${i.id}`} dark={dark} pad="0" hover style={{ overflow: 'hidden', opacity: busy === i.id ? 0.55 : 1, transition: 'opacity .15s' }}>
                <div style={{ padding: '14px 16px' }}>
                  {/* type + shared badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: `${accent}1e`, color: accent }}>
                      <Ic size={11} /> {isRpt ? L('Report', 'تقرير') : L('Dashboard', 'لوحة')}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
                      background: i.shared ? 'rgba(34,197,94,0.14)' : (dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'), color: i.shared ? '#22c55e' : ts(dark) }}>
                      {i.shared ? <Globe size={10} /> : <Lock size={10} />} {i.shared ? L('Shared', 'مشترك') : L('Private', 'خاص')}
                    </span>
                  </div>

                  {/* name */}
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: tp(dark), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.name}</div>
                  {/* summary */}
                  <div style={{ fontSize: 11.5, color: ts(dark), marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary || L('—', '—')}</div>
                  {/* owner + updated */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 10.5, color: ts(dark) }}>
                    <User size={11} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {i.is_owner ? L('You', 'أنت') : (i.owner_name || L('Teammate', 'زميل'))}
                    </span>
                    {i.updated_at && <span style={{ marginInlineStart: 'auto' }}>{String(i.updated_at).slice(0, 10)}</span>}
                  </div>
                </div>

                {/* actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderTop: `1px solid ${border}`, background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)' }}>
                  <button onClick={() => openItem(i)} disabled={busy === i.id}
                    style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 12px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none', background: accent, color: '#fff' }}>
                    <ExternalLink size={13} /> {L('Open', 'فتح')}
                  </button>
                  <button onClick={() => duplicate(i)} disabled={busy === i.id} title={L('Duplicate', 'نسخ')} style={iconBtn('#38bdf8')}><Copy size={14} /></button>
                  {i.is_owner && <>
                    <button onClick={() => rename(i)} disabled={busy === i.id} title={L('Rename', 'إعادة تسمية')} style={iconBtn('#f59e0b')}><Pencil size={14} /></button>
                    <button onClick={() => toggleShare(i)} disabled={busy === i.id} title={i.shared ? L('Unshare', 'إلغاء المشاركة') : L('Share', 'مشاركة')} style={iconBtn(i.shared ? '#22c55e' : ts(dark))}><Share2 size={14} /></button>
                    <button onClick={() => remove(i)} disabled={busy === i.id} title={L('Delete', 'حذف')} style={iconBtn('#ef4444')}><Trash2 size={14} /></button>
                  </>}
                </div>
              </NxCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
