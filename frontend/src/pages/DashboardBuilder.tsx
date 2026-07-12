/**
 * Dashboard Composer (Builder v2 · BLD-3)
 *
 * A Sprinklr-style composable dashboard: tabbed SECTIONS, each a responsive
 * grid of WIDGETS. Every widget runs its own /report-builder-v2/run (isolated
 * loading/empty/error). A dashboard-level DateRangePicker pill cascades to all
 * widgets (a widget may pin its own dates to opt out); a dashboard-level
 * function chip cascades to every widget whose source carries a `function` dim.
 * Compose in Edit mode, hand a clean read-only board to a TL in View mode.
 * Save / load / share via /saved-dashboards CRUD.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutGrid, Plus, Save, Bookmark, X, Pencil, Trash2, Eye, Edit3, Sparkles, Filter, FolderOpen, Copy, PanelsTopLeft,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { useInjectDsStyles, card, tp, ts, NxBtn, NxEmpty } from '@/components/ds';
import { DateRangePicker, DateRangeValue, presetById } from '@/components/report-builder/DateRangePicker';
import { WidgetCard } from '@/components/report-builder/dashboard/WidgetCard';
import { WidgetEditor } from '@/components/report-builder/dashboard/WidgetEditor';
import { loadSources } from '@/components/report-builder/dashboard/sourceCatalog';
import {
  SectionConfig, WidgetConfig, SavedDashboard, SavedReportLite, DashFilter,
  newSection, newWidget, defaultRange, uid,
} from '@/components/report-builder/dashboard/types';

/* re-evaluate a stored date_range (rolling presets recompute on load) */
function hydrateRange(dr: any): DateRangeValue {
  if (!dr) return defaultRange();
  const rollId = dr.rolling?.preset;
  const rp = rollId ? presetById(rollId) : null;
  if (rp) { const [f, t] = rp.range(); return { dateFrom: f, dateTo: t, timeFrom: dr.timeFrom ?? '00:00', timeTo: dr.timeTo ?? '23:59', rolling: { preset: rollId } }; }
  if (dr.dateFrom && dr.dateTo) return { dateFrom: dr.dateFrom, dateTo: dr.dateTo, timeFrom: dr.timeFrom ?? '00:00', timeTo: dr.timeTo ?? '23:59', rolling: null };
  return defaultRange();
}

export default function DashboardBuilderPage() {
  useInjectDsStyles();
  const { lang, dark } = useUiStore(); const ar = lang === 'ar';
  const L = (en: string, arv: string) => (ar ? arv : en);

  const [mode, setMode] = useState<'edit' | 'view'>('edit');
  const [sections, setSections] = useState<SectionConfig[]>([newSection(ar ? 'نظرة عامة' : 'Overview')]);
  const [activeSec, setActiveSec] = useState<string>(() => sections[0].id);
  const [dateVal, setDateVal] = useState<DateRangeValue>(defaultRange);
  const [funcFilter, setFuncFilter] = useState('');
  const [functions, setFunctions] = useState<string[]>([]);

  const [dashId, setDashId] = useState<string | null>(null);
  const [dashName, setDashName] = useState(ar ? 'لوحة جديدة' : 'Untitled dashboard');
  const [shared, setShared] = useState(false);
  const [isOwner, setIsOwner] = useState(true);
  const [dirty, setDirty] = useState(false);

  const [savedList, setSavedList] = useState<SavedDashboard[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [savedReports, setSavedReports] = useState<SavedReportLite[]>([]);

  const [editor, setEditor] = useState<{ sectionId: string; widget: WidgetConfig | null } | null>(null);

  const markDirty = () => setDirty(true);

  /* ── initial loads ── */
  useEffect(() => {
    loadSources().catch(() => {});
    refreshSaved();
    apiClient.get('/report-builder-v2/saved-reports').then((r: any) => setSavedReports(r.data ?? [])).catch(() => {});
    // function list for the cascade chip (attendance carries every function)
    apiClient.post('/report-builder-v2/run', { sourceKey: 'attendance', dimensions: ['function'], metrics: ['workedDays'], dateFrom: '2020-01-01', dateTo: new Date().toISOString().slice(0, 10), granularity: 'none', limit: 200 })
      .then((r: any) => setFunctions((r.data?.rows ?? []).map((x: any) => x.function).filter(Boolean).sort()))
      .catch(() => {});
  }, []); // eslint-disable-line

  const refreshSaved = useCallback(() => {
    apiClient.get('/report-builder-v2/saved-dashboards').then((r: any) => setSavedList(r.data ?? [])).catch(() => {});
  }, []);

  const dashDate = useMemo(() => ({ dateFrom: dateVal.dateFrom, dateTo: dateVal.dateTo }), [dateVal.dateFrom, dateVal.dateTo]);
  const section = sections.find(s => s.id === activeSec) ?? sections[0];

  /* ── section ops ── */
  const addSection = () => {
    const name = window.prompt(L('Section name:', 'اسم القسم:'), L(`Section ${sections.length + 1}`, `قسم ${sections.length + 1}`));
    if (!name) return;
    const s = newSection(name); setSections(p => [...p, s]); setActiveSec(s.id); markDirty();
  };
  const renameSection = (id: string) => {
    const cur = sections.find(s => s.id === id); if (!cur) return;
    const name = window.prompt(L('Rename section:', 'إعادة تسمية القسم:'), cur.name);
    if (!name) return; setSections(p => p.map(s => s.id === id ? { ...s, name } : s)); markDirty();
  };
  const deleteSection = (id: string) => {
    if (sections.length <= 1) { window.alert(L('A dashboard needs at least one section.', 'يجب أن تحتوي اللوحة على قسم واحد على الأقل.')); return; }
    if (!window.confirm(L('Delete this section and its widgets?', 'حذف هذا القسم وأدواته؟'))) return;
    setSections(p => { const next = p.filter(s => s.id !== id); if (id === activeSec) setActiveSec(next[0].id); return next; }); markDirty();
  };

  /* ── widget ops ── */
  const upsertWidget = (sectionId: string, w: WidgetConfig) => {
    setSections(p => p.map(s => {
      if (s.id !== sectionId) return s;
      const exists = s.widgets.some(x => x.id === w.id);
      return { ...s, widgets: exists ? s.widgets.map(x => x.id === w.id ? w : x) : [...s.widgets, w] };
    })); markDirty();
  };
  const patchWidget = (sectionId: string, wid: string, patch: Partial<WidgetConfig>) => {
    setSections(p => p.map(s => s.id === sectionId ? { ...s, widgets: s.widgets.map(x => x.id === wid ? { ...x, ...patch } : x) } : s)); markDirty();
  };
  const removeWidget = (sectionId: string, wid: string) => {
    setSections(p => p.map(s => s.id === sectionId ? { ...s, widgets: s.widgets.filter(x => x.id !== wid) } : s)); markDirty();
  };

  /* ── save / load ── */
  const buildFilters = (): DashFilter[] => (funcFilter ? [{ dim: 'function', value: funcFilter }] : []);

  const doSave = async () => {
    let name = dashName;
    let sh = shared;
    if (!dashId || !isOwner) {
      const n = window.prompt(L('Dashboard name:', 'اسم اللوحة:'), dashName); if (!n) return; name = n;
      sh = window.confirm(L('Share with the team? (OK = shared, Cancel = private)', 'مشاركة مع الفريق؟ (موافق = مشترك، إلغاء = خاص)'));
    }
    const body = { name, description: null, sections, dateRange: dateVal, filters: buildFilters(), shared: sh };
    try {
      if (dashId && isOwner) {
        await apiClient.put(`/report-builder-v2/saved-dashboards/${dashId}`, body);
      } else {
        const r: any = await apiClient.post('/report-builder-v2/saved-dashboards', body);
        setDashId(r.data?.id ?? null); setIsOwner(true);
      }
      setDashName(name); setShared(sh); setDirty(false); refreshSaved();
    } catch { window.alert(L('Save failed.', 'فشل الحفظ.')); }
  };

  const doLoad = async (item: SavedDashboard) => {
    try {
      const r: any = await apiClient.get(`/report-builder-v2/saved-dashboards/${item.id}`);
      const d = r.data;
      const secs: SectionConfig[] = (Array.isArray(d.sections) && d.sections.length ? d.sections : [newSection(L('Overview', 'نظرة عامة'))]);
      setSections(secs); setActiveSec(secs[0].id);
      setDateVal(hydrateRange(d.date_range));
      const fn = (Array.isArray(d.filters) ? d.filters : []).find((f: any) => f.dim === 'function');
      setFuncFilter(fn?.value ?? '');
      setDashId(d.id); setDashName(d.name); setShared(!!d.shared); setIsOwner(item.is_owner !== false);
      setDirty(false); setDrawer(false); setMode('edit');
    } catch { window.alert(L('Load failed.', 'فشل التحميل.')); }
  };

  const doDelete = async (id: string) => {
    if (!window.confirm(L('Delete this dashboard?', 'حذف هذه اللوحة؟'))) return;
    try { await apiClient.delete(`/report-builder-v2/saved-dashboards/${id}`); if (dashId === id) newDashboard(); refreshSaved(); } catch {}
  };

  const newDashboard = () => {
    const s = newSection(L('Overview', 'نظرة عامة'));
    setSections([s]); setActiveSec(s.id); setDashId(null); setDashName(L('Untitled dashboard', 'لوحة جديدة'));
    setShared(false); setIsOwner(true); setFuncFilter(''); setDateVal(defaultRange()); setDirty(false);
  };

  const duplicateWidget = (sectionId: string, w: WidgetConfig) => upsertWidget(sectionId, { ...w, id: uid(), title: `${w.title} (copy)` });

  const border = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
  const chip = (active: boolean, color = '#6366f1'): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
    border: `1px solid ${active ? color + '80' : border}`, background: active ? `${color}20` : (dark ? 'rgba(255,255,255,0.03)' : '#fff'), color: active ? color : ts(dark),
  });

  return (
    <div dir={ar ? 'rtl' : 'ltr'} style={{ animation: 'ds-fadein .4s ease' }}>
      {/* ── header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <LayoutGrid size={20} color="#fff" />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          {mode === 'edit' ? (
            <input value={dashName} onChange={e => { setDashName(e.target.value); markDirty(); }}
              style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.02em', color: tp(dark), background: 'transparent', border: 'none', borderBottom: `1px dashed ${border}`, outline: 'none', padding: '2px 0', width: '100%', maxWidth: 420 }} />
          ) : (
            <h1 style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.02em', color: tp(dark), margin: 0 }}>{dashName}</h1>
          )}
          <p style={{ margin: '3px 0 0', fontSize: 12, color: ts(dark), display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(139,92,246,0.14)', color: '#a78bfa' }}><Sparkles size={10} /> Builder v2</span>
            {shared && <span style={{ color: '#22c55e' }}>· {L('shared', 'مشترك')}</span>}
            {dirty && <span style={{ color: '#f59e0b' }}>· {L('unsaved', 'غير محفوظ')}</span>}
            {!isOwner && dashId && <span>· {L('read-only (teammate’s)', 'للعرض (لزميل)')}</span>}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* mode toggle */}
          <div style={{ display: 'inline-flex', borderRadius: 10, border: `1px solid ${border}`, overflow: 'hidden' }}>
            <button onClick={() => setMode('edit')} style={{ ...chip(mode === 'edit', '#8b5cf6'), borderRadius: 0, border: 'none' }}><Edit3 size={13} /> {L('Edit', 'تعديل')}</button>
            <button onClick={() => setMode('view')} style={{ ...chip(mode === 'view', '#22c55e'), borderRadius: 0, border: 'none' }}><Eye size={13} /> {L('View', 'عرض')}</button>
          </div>
          <NxBtn icon={FolderOpen} variant="outline" color="#6366f1" dark={dark} onClick={() => setDrawer(true)}>{L('Open', 'فتح')} {savedList.length ? `(${savedList.length})` : ''}</NxBtn>
          {mode === 'edit' && <NxBtn icon={PanelsTopLeft} variant="ghost" dark={dark} onClick={newDashboard}>{L('New', 'جديد')}</NxBtn>}
          {mode === 'edit' && <NxBtn icon={Save} color="#6366f1" dark={dark} onClick={doSave}>{L('Save', 'حفظ')}</NxBtn>}
        </div>
      </div>

      {/* ── dashboard controls: date pill + function chip (cascade) ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14, padding: '10px 12px', borderRadius: 14, background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)', border: `1px solid ${border}` }}>
        <DateRangePicker value={dateVal} dark={dark} ar={ar} onApply={v => { setDateVal(v); markDirty(); }} />
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Filter size={13} style={{ color: ts(dark) }} />
          <select value={funcFilter} onChange={e => { setFuncFilter(e.target.value); markDirty(); }}
            style={{ padding: '8px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: funcFilter ? 'rgba(99,102,241,0.12)' : (dark ? 'rgba(255,255,255,0.05)' : '#fff'), border: `1px solid ${funcFilter ? 'rgba(99,102,241,0.4)' : border}`, color: funcFilter ? (dark ? '#c7d2fe' : '#4338ca') : ts(dark), cursor: 'pointer', outline: 'none' }}>
            <option value="">{L('All functions', 'كل الوظائف')}</option>
            {functions.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <span style={{ marginInlineStart: 'auto', fontSize: 10.5, color: ts(dark) }}>
          {L('Date & function cascade to every widget (unless a widget pins its own dates).', 'التاريخ والوظيفة يسريان على كل الأدوات (إلا إذا ثبّتت الأداة تاريخها).')}
        </span>
      </div>

      {/* ── section tabs ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 14, borderBottom: `1px solid ${border}`, paddingBottom: 10 }}>
        {sections.map(s => {
          const active = s.id === activeSec;
          return (
            <div key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '7px 12px', borderRadius: 10, cursor: 'pointer',
              background: active ? 'rgba(99,102,241,0.14)' : 'transparent', border: `1px solid ${active ? 'rgba(99,102,241,0.4)' : 'transparent'}` }}
              onClick={() => setActiveSec(s.id)}>
              <span style={{ fontSize: 12.5, fontWeight: active ? 700 : 500, color: active ? (dark ? '#c7d2fe' : '#4338ca') : ts(dark) }}>{s.name}</span>
              <span style={{ fontSize: 10, color: ts(dark), fontWeight: 600 }}>{s.widgets.length}</span>
              {mode === 'edit' && active && <>
                <Pencil size={11} style={{ color: ts(dark), cursor: 'pointer', marginInlineStart: 4 }} onClick={e => { e.stopPropagation(); renameSection(s.id); }} />
                {sections.length > 1 && <X size={12} style={{ color: '#ef4444', cursor: 'pointer' }} onClick={e => { e.stopPropagation(); deleteSection(s.id); }} />}
              </>}
            </div>
          );
        })}
        {mode === 'edit' && <button onClick={addSection} style={{ ...chip(false), borderStyle: 'dashed' }}><Plus size={12} /> {L('Section', 'قسم')}</button>}
      </div>

      {/* ── widget grid ── */}
      {section.widgets.length === 0 && (
        <NxEmpty icon={LayoutGrid} ar={ar} dark={dark}
          title={mode === 'edit' ? 'This section is empty' : 'Nothing to show'}
          titleAr={mode === 'edit' ? 'هذا القسم فارغ' : 'لا شيء للعرض'}
          desc={mode === 'edit' ? 'Add a widget — pick a saved report or build one inline.' : 'Switch to Edit mode to add widgets.'}
          descAr={mode === 'edit' ? 'أضف أداة — اختر تقريراً محفوظاً أو ابنِ واحدة مباشرة.' : 'انتقل لوضع التعديل لإضافة أدوات.'} />
      )}

      <div className="grid gap-3 grid-cols-1 lg:grid-cols-2" style={{ alignItems: 'start' }}>
        {section.widgets.map(w => (
          <div key={w.id} style={{ gridColumn: w.span === 2 ? '1 / -1' : undefined, position: 'relative' }}>
            <WidgetCard
              widget={w} dashDate={dashDate} dashFunc={funcFilter} mode={mode} dark={dark} ar={ar}
              onEdit={() => setEditor({ sectionId: section.id, widget: w })}
              onRemove={() => removeWidget(section.id, w.id)}
              onChange={patch => patchWidget(section.id, w.id, patch)}
            />
            {mode === 'edit' && (
              <button onClick={() => duplicateWidget(section.id, w)} title={L('Duplicate', 'نسخ')}
                style={{ position: 'absolute', bottom: 8, insetInlineEnd: 8, width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center', background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', border: `1px solid ${border}`, color: ts(dark), cursor: 'pointer' }}>
                <Copy size={11} />
              </button>
            )}
          </div>
        ))}
        {mode === 'edit' && (
          <button onClick={() => setEditor({ sectionId: section.id, widget: null })}
            style={{ minHeight: 140, borderRadius: 16, border: `1px dashed ${dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.14)'}`, background: 'transparent', color: ts(dark), cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Plus size={20} /> <span style={{ fontSize: 13, fontWeight: 600 }}>{L('Add widget', 'إضافة أداة')}</span>
          </button>
        )}
      </div>

      {/* ── widget editor ── */}
      {editor && (
        <WidgetEditor
          initial={editor.widget} savedReports={savedReports} dark={dark} ar={ar}
          onCancel={() => setEditor(null)}
          onSave={w => { upsertWidget(editor.sectionId, w); setEditor(null); }}
        />
      )}

      {/* ── saved dashboards drawer ── */}
      {drawer && (
        <div onClick={() => setDrawer(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60, display: 'flex', justifyContent: ar ? 'flex-start' : 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} dir={ar ? 'rtl' : 'ltr'} style={{ width: 360, maxWidth: '90vw', height: '100%', overflowY: 'auto', ...card(dark), borderRadius: 0, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Bookmark size={16} style={{ color: '#6366f1' }} />
              <span style={{ fontSize: 15, fontWeight: 800, color: tp(dark) }}>{L('Saved dashboards', 'اللوحات المحفوظة')}</span>
              <button onClick={() => setDrawer(false)} style={{ marginInlineStart: 'auto', ...chip(false, '#ef4444'), padding: 6 }}><X size={14} /></button>
            </div>
            {savedList.length === 0 && <NxEmpty ar={ar} dark={dark} title="No saved dashboards yet" titleAr="لا توجد لوحات محفوظة" desc="Compose a dashboard and press Save." descAr="أنشئ لوحة واضغط حفظ." />}
            {savedList.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 12, marginBottom: 8, border: `1px solid ${border}`, background: dashId === s.id ? 'rgba(99,102,241,0.1)' : 'transparent' }}>
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => doLoad(s)}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: tp(dark), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                  <div style={{ fontSize: 10.5, color: ts(dark), display: 'flex', gap: 6 }}>
                    {s.shared && <span style={{ color: '#22c55e' }}>{L('shared', 'مشترك')}</span>}
                    {s.is_owner === false && <span>{L('by teammate', 'من زميل')}</span>}
                    {s.updated_at && <span>{String(s.updated_at).slice(0, 10)}</span>}
                  </div>
                </div>
                {s.is_owner !== false && <button onClick={() => doDelete(s.id)} style={{ ...chip(false, '#ef4444'), padding: 6 }}><Trash2 size={12} /></button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
