import { useState, useEffect, useCallback } from 'react';
import {
  Megaphone, Plus, Trash2, Pencil, Calendar, AlertTriangle,
  Loader2, X, Check, TrendingUp,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { card as cardStyle, tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface Campaign {
  id: string; name: string; campaignType: string;
  startDate: string; endDate: string;
  restrictRequests: boolean; restrictedTypes: string[];
  requiredHcUpliftPct: number; color: string; notes: string | null;
  isActive: boolean; status: 'upcoming' | 'active' | 'past'; createdByName: string | null;
}

const TYPES: { code: string; ar: string; en: string; color: string }[] = [
  { code: 'flash_sale',   ar: 'عرض خاطف',   en: 'Flash Sale',   color: '#f59e0b' },
  { code: 'mega_sale',    ar: 'تخفيض كبير', en: 'Mega Sale',    color: '#ef4444' },
  { code: 'eid',          ar: 'العيد',       en: 'Eid',          color: '#22c55e' },
  { code: 'ramadan',      ar: 'رمضان',       en: 'Ramadan',      color: '#8b5cf6' },
  { code: 'national_day', ar: 'العيد الوطني', en: 'National Day', color: '#06b6d4' },
  { code: 'other',        ar: 'أخرى',        en: 'Other',        color: '#64748b' },
];

const REQ_TYPES: { code: string; ar: string; en: string }[] = [
  { code: 'annual',     ar: 'إجازة سنوية', en: 'Annual leave' },
  { code: 'emergency',  ar: 'طارئة',        en: 'Emergency' },
  { code: 'shift_swap', ar: 'تبديل شفت',    en: 'Shift swap' },
  { code: 'off_swap',   ar: 'تبديل OFF',    en: 'Off swap' },
  { code: 'wfh',        ar: 'عمل من البيت', en: 'WFH' },
  { code: 'permission', ar: 'استئذان',      en: 'Permission' },
];

const STATUS_META: Record<string, { ar: string; en: string; color: string }> = {
  active:   { ar: 'فعّالة الآن', en: 'Active now', color: '#22c55e' },
  upcoming: { ar: 'قادمة',       en: 'Upcoming',   color: '#f59e0b' },
  past:     { ar: 'منتهية',      en: 'Past',       color: '#64748b' },
};

const emptyForm = () => ({
  id: '' as string,
  name: '', campaignType: 'flash_sale',
  startDate: '', endDate: '',
  restrictRequests: true,
  restrictedTypes: ['annual', 'emergency', 'shift_swap', 'off_swap', 'wfh'] as string[],
  requiredHcUpliftPct: 0,
  notes: '',
});

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function CampaignsPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [list, setList]       = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShow]   = useState(false);
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState(emptyForm());

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await apiClient.get<Campaign[]>('/campaigns'); setList(Array.isArray(data) ? data : []); }
    catch { setList([]); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew  = () => { setForm(emptyForm()); setShow(true); };
  const openEdit = (c: Campaign) => {
    setForm({
      id: c.id, name: c.name, campaignType: c.campaignType,
      startDate: c.startDate, endDate: c.endDate,
      restrictRequests: c.restrictRequests, restrictedTypes: c.restrictedTypes ?? [],
      requiredHcUpliftPct: c.requiredHcUpliftPct, notes: c.notes ?? '',
    });
    setShow(true);
  };

  const toggleType = (code: string) =>
    setForm(f => ({ ...f, restrictedTypes: f.restrictedTypes.includes(code)
      ? f.restrictedTypes.filter(t => t !== code) : [...f.restrictedTypes, code] }));

  const save = async () => {
    if (!form.name.trim() || !form.startDate || !form.endDate) return;
    if (form.endDate < form.startDate) return;
    setSaving(true);
    try {
      if (form.id) await apiClient.patch(`/campaigns/${form.id}`, form);
      else         await apiClient.post('/campaigns', form);
      setShow(false); await load();
    } catch {}
    setSaving(false);
  };

  const remove = async (id: string) => {
    try { await apiClient.delete(`/campaigns/${id}`); await load(); } catch {}
  };

  const typeMeta = (code: string) => TYPES.find(t => t.code === code) ?? TYPES[TYPES.length - 1];
  const input = {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10, color: '#e2e8f0', padding: '8px 10px', fontSize: 13, outline: 'none', width: '100%',
  } as const;

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.22)' }}>
            <Megaphone size={18} style={{ color: '#f59e0b' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>
              {ar ? 'تقويم الحملات' : 'Campaign Calendar'}
            </h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>
              {ar ? 'فترات الذروة — تقيّد الطلبات وترفع التغطية المطلوبة' : 'Peak windows — restrict requests & uplift required HC'}
            </p>
          </div>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold hover:opacity-80 transition-opacity"
          style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
          <Plus size={14} /> {ar ? 'حملة جديدة' : 'New campaign'}
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : list.length === 0 ? (
        <div className="text-center py-20" style={{ color: '#475569' }}>
          <Calendar size={32} className="mx-auto mb-3" style={{ color: '#334155' }} />
          <p className="text-sm">{ar ? 'لا توجد حملات — أضف أول حملة' : 'No campaigns yet — add your first one'}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(c => {
            const tm = typeMeta(c.campaignType);
            const sm = STATUS_META[c.status];
            return (
              <div key={c.id} style={{ ...cardStyle(dark), padding: 16, borderInlineStart: `3px solid ${tm.color}` }}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate" style={{ color: tp(dark) }}>{c.name}</div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded mt-1 inline-block"
                      style={{ background: `${tm.color}22`, color: tm.color }}>{ar ? tm.ar : tm.en}</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-semibold"
                    style={{ background: `${sm.color}22`, color: sm.color }}>{ar ? sm.ar : sm.en}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] mb-2" style={{ color: tsColor(dark) }}>
                  <Calendar size={11} /> {c.startDate} → {c.endDate}
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {c.restrictRequests && c.restrictedTypes.map(t => {
                    const rt = REQ_TYPES.find(x => x.code === t);
                    return <span key={t} className="text-[9px] px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>{ar ? rt?.ar ?? t : rt?.en ?? t}</span>;
                  })}
                  {!c.restrictRequests && <span className="text-[10px]" style={{ color: '#475569' }}>{ar ? 'بدون تقييد' : 'No restriction'}</span>}
                </div>
                {c.requiredHcUpliftPct > 0 && (
                  <div className="flex items-center gap-1 text-[11px] mb-2" style={{ color: '#22d3ee' }}>
                    <TrendingUp size={11} /> +{c.requiredHcUpliftPct}% {ar ? 'تغطية مطلوبة' : 'required HC'}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <button onClick={() => openEdit(c)} className="flex items-center gap-1 text-[11px] hover:opacity-80" style={{ color: '#818cf8' }}>
                    <Pencil size={11} /> {ar ? 'تعديل' : 'Edit'}
                  </button>
                  <button onClick={() => remove(c.id)} className="flex items-center gap-1 text-[11px] hover:opacity-80 ms-auto" style={{ color: '#f87171' }}>
                    <Trash2 size={11} /> {ar ? 'حذف' : 'Delete'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShow(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
            style={{ background: dark ? '#0f172a' : '#fff', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold" style={{ color: tp(dark) }}>
                {form.id ? (ar ? 'تعديل حملة' : 'Edit campaign') : (ar ? 'حملة جديدة' : 'New campaign')}
              </h2>
              <button onClick={() => setShow(false)}><X size={16} style={{ color: '#64748b' }} /></button>
            </div>

            <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'الاسم' : 'Name'}</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={input} className="mb-3"
              placeholder={ar ? 'مثال: تخفيضات نهاية الشهر' : 'e.g. End-of-month sale'} />

            <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'النوع' : 'Type'}</label>
            <select value={form.campaignType} onChange={e => setForm(f => ({ ...f, campaignType: e.target.value }))} style={input} className="mb-3">
              {TYPES.map(t => <option key={t.code} value={t.code} style={{ background: '#0f172a' }}>{ar ? t.ar : t.en}</option>)}
            </select>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'من' : 'From'}</label>
                <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} style={input} />
              </div>
              <div>
                <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'إلى' : 'To'}</label>
                <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} style={input} />
              </div>
            </div>

            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input type="checkbox" checked={form.restrictRequests} onChange={e => setForm(f => ({ ...f, restrictRequests: e.target.checked }))} />
              <span className="text-xs" style={{ color: tp(dark) }}>{ar ? 'تقييد الطلبات خلال الفترة' : 'Restrict requests during window'}</span>
            </label>

            {form.restrictRequests && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {REQ_TYPES.map(rt => {
                  const on = form.restrictedTypes.includes(rt.code);
                  return (
                    <button key={rt.code} onClick={() => toggleType(rt.code)}
                      className="text-[11px] px-2 py-1 rounded-lg flex items-center gap-1 transition-colors"
                      style={{ background: on ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${on ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.1)'}`,
                        color: on ? '#f87171' : '#64748b' }}>
                      {on && <Check size={10} />} {ar ? rt.ar : rt.en}
                    </button>
                  );
                })}
              </div>
            )}

            <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>
              {ar ? 'رفع التغطية المطلوبة %' : 'Required HC uplift %'}
            </label>
            <input type="number" min={0} max={200} value={form.requiredHcUpliftPct}
              onChange={e => setForm(f => ({ ...f, requiredHcUpliftPct: parseInt(e.target.value, 10) || 0 }))} style={input} className="mb-3" />

            <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'ملاحظات' : 'Notes'}</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ ...input, minHeight: 56 }} className="mb-4" />

            {form.endDate && form.startDate && form.endDate < form.startDate && (
              <div className="flex items-center gap-1.5 text-[11px] mb-3" style={{ color: '#f87171' }}>
                <AlertTriangle size={11} /> {ar ? 'تاريخ النهاية قبل البداية' : 'End date is before start date'}
              </div>
            )}

            <button onClick={save} disabled={saving || !form.name.trim() || !form.startDate || !form.endDate}
              className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity"
              style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
              {saving ? <Loader2 size={14} className="animate-spin inline" /> : (form.id ? (ar ? 'حفظ' : 'Save') : (ar ? 'إضافة' : 'Add'))}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
