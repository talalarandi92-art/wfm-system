import { useState, useEffect, useCallback } from 'react';
import {
  Settings as SettingsIcon, Save, RotateCcw, ChevronRight,
  Code, Building2, Users, Loader2, Check, X, Tag,
  Shield, ToggleLeft, ToggleRight, Calendar, Zap,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { card as cardStyle, tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface Setting { key: string; value: any; description: string }
interface ShiftCode {
  code: string; descriptionAr: string; description: string;
  startTime: string; endTime: string; workingHours: number;
  isSplitShift: boolean; isCrossMidnight: boolean; isWfh: boolean;
  isRamadan: boolean; isSupervisor: boolean; isWorkingShift: boolean;
  isLeaveCode: boolean; isAbsenceCode: boolean; allowsFemale: boolean;
  isActive: boolean; displayColor: string | null; categoryName: string | null;
}
interface FuncRow { id: string; name: string; headcount: string; active_count: string }

type View = 'overview' | 'settings' | 'shifts' | 'functions';

const GROUP_ICONS: Record<string, any> = {
  schedule:   Calendar,
  attendance: Users,
  capacity:   Zap,
  security:   Shield,
  general:    SettingsIcon,
};
const GROUP_COLORS: Record<string, string> = {
  schedule:          '#818cf8',
  attendance:        '#34d399',
  capacity:          '#22d3ee',
  security:          '#f87171',
  technical_issues:  '#fb923c',
  general:           '#fbbf24',
};

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function SettingsPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [view, setView]         = useState<View>('overview');
  const [settings, setSettings] = useState<Record<string, Setting[]>>({});
  const [shifts, setShifts]     = useState<ShiftCode[]>([]);
  const [funcs, setFuncs]       = useState<FuncRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState<string | null>(null);
  const [saved, setSaved]       = useState<string | null>(null);
  const [edits, setEdits]       = useState<Record<string, any>>({});
  const [shiftFilter, setShiftFilter] = useState('');

  const loadSettings = useCallback(async () => {
    setLoading(true);
    const { data } = await apiClient.get('/settings');
    setSettings(data);
    setLoading(false);
  }, []);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    const { data } = await apiClient.get('/settings/shift-codes');
    setShifts(data); setLoading(false);
  }, []);

  const loadFuncs = useCallback(async () => {
    setLoading(true);
    const { data } = await apiClient.get('/settings/functions');
    setFuncs(data); setLoading(false);
  }, []);

  useEffect(() => {
    if (view === 'settings') loadSettings();
    else if (view === 'shifts') loadShifts();
    else if (view === 'functions') loadFuncs();
  }, [view]);

  const saveSetting = async (key: string, rawVal: string) => {
    setSaving(key);
    let parsed: any = rawVal;
    try { parsed = JSON.parse(rawVal); } catch { /* keep string */ }
    try {
      await apiClient.patch(`/settings/${key}`, { value: parsed });
      setSaved(key);
      setTimeout(() => setSaved(null), 2000);
      loadSettings();
    } catch {}
    setSaving(null);
  };

  const filteredShifts = shifts.filter(s =>
    !shiftFilter || s.code.toLowerCase().includes(shiftFilter.toLowerCase())
      || (s.description?.toLowerCase().includes(shiftFilter.toLowerCase()))
      || (s.descriptionAr?.includes(shiftFilter))
  );

  const VIEWS: { id: View; labelAr: string; labelEn: string; icon: any; descAr: string; descEn: string; color: string }[] = [
    { id: 'settings',   labelAr: 'الإعدادات العامة', labelEn: 'General Settings', icon: SettingsIcon, descAr: 'إعدادات النظام المجمّعة', descEn: 'System-wide configuration', color: '#818cf8' },
    { id: 'shifts',     labelAr: 'قاموس الورديات',  labelEn: 'Shift Dictionary', icon: Code,         descAr: 'تعريفات أكواد الورديات',  descEn: 'Shift code definitions',   color: '#34d399' },
    { id: 'functions',  labelAr: 'الوظائف',          labelEn: 'Functions',        icon: Building2,    descAr: 'وظائف قسم الاتصال',       descEn: 'Contact center functions', color: '#fbbf24' },
  ];

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'}>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)' }}>
          <SettingsIcon size={18} style={{ color: '#818cf8' }} />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>
            {ar ? 'الإعدادات' : 'Settings'}
          </h1>
          {view !== 'overview' && (
            <button onClick={() => setView('overview')} className="text-xs flex items-center gap-1 hover:opacity-70" style={{ color: '#818cf8' }}>
              <span>←</span> {ar ? 'رجوع' : 'Back'}
            </button>
          )}
        </div>
      </div>

      {/* ── Overview grid ─────────────────────────────────────────────── */}
      {view === 'overview' && (
        <div className="grid gap-4 sm:grid-cols-3">
          {VIEWS.map(v => (
            <button key={v.id} onClick={() => setView(v.id)}
              className="text-start group transition-all hover:scale-[1.01]"
              style={{ ...cardStyle(dark), padding: 20, border: `1px solid ${v.color}25` }}>
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"
                style={{ background: `${v.color}15` }}>
                <v.icon size={18} style={{ color: v.color }} />
              </div>
              <div className="text-sm font-bold mb-1" style={{ color: tp(dark) }}>
                {ar ? v.labelAr : v.labelEn}
              </div>
              <div className="text-xs" style={{ color: tsColor(dark) }}>
                {ar ? v.descAr : v.descEn}
              </div>
              <div className="mt-4 flex items-center gap-1 text-xs" style={{ color: v.color }}>
                <span>{ar ? 'فتح' : 'Open'}</span>
                <ChevronRight size={11} />
              </div>
            </button>
          ))}
        </div>
      )}

      {loading && view !== 'overview' && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} />
        </div>
      )}

      {/* ── General settings ──────────────────────────────────────────── */}
      {view === 'settings' && !loading && (
        <div className="space-y-4">
          {Object.entries(settings).map(([group, items]) => {
            const GIcon = GROUP_ICONS[group] ?? SettingsIcon;
            const color = GROUP_COLORS[group] ?? '#64748b';
            return (
              <div key={group} className="rounded-2xl overflow-hidden"
                style={{ ...cardStyle(dark), border: `1px solid ${color}20` }}>
                <div className="flex items-center gap-2 px-4 py-3"
                  style={{ background: `${color}08`, borderBottom: `1px solid ${color}15` }}>
                  <GIcon size={14} style={{ color }} />
                  <span className="text-sm font-semibold capitalize" style={{ color }}>{group}</span>
                </div>
                <div className="divide-y" style={{ '--tw-divide-opacity': '0.05' } as any}>
                  {items.map(item => {
                    const key = item.key;
                    const currentVal = JSON.stringify(item.value);
                    const editVal = edits[key] ?? currentVal;
                    const isEdited = editVal !== currentVal;
                    const isBool = typeof item.value === 'boolean';
                    return (
                      <div key={key} className="px-4 py-3 flex items-center gap-4 flex-wrap">
                        <div className="flex-1 min-w-48">
                          <div className="text-xs font-medium font-mono" style={{ color: '#e2e8f0' }}>{key}</div>
                          {item.description && <div className="text-[10px] mt-0.5" style={{ color: '#475569' }}>{item.description}</div>}
                        </div>
                        <div className="flex items-center gap-2">
                          {isBool ? (
                            <button onClick={() => {
                              const newVal = !item.value;
                              saveSetting(key, JSON.stringify(newVal));
                            }}>
                              {item.value
                                ? <ToggleRight size={22} style={{ color: '#34d399' }} />
                                : <ToggleLeft size={22} style={{ color: '#475569' }} />}
                            </button>
                          ) : (
                            <input
                              value={editVal}
                              onChange={e => setEdits(d => ({ ...d, [key]: e.target.value }))}
                              className="text-xs rounded-xl px-3 py-1.5 outline-none w-40"
                              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${isEdited ? '#818cf8' : 'rgba(255,255,255,0.1)'}`, color: '#e2e8f0', fontFamily: 'monospace' }} />
                          )}
                          {isEdited && !isBool && (
                            <>
                              <button onClick={() => saveSetting(key, editVal)} disabled={saving === key}
                                className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
                                style={{ color: '#34d399' }}>
                                {saving === key ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                              </button>
                              <button onClick={() => setEdits(d => { const n = { ...d }; delete n[key]; return n; })}
                                className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
                                style={{ color: '#f87171' }}>
                                <RotateCcw size={12} />
                              </button>
                            </>
                          )}
                          {saved === key && <Check size={12} style={{ color: '#34d399' }} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Shift codes ────────────────────────────────────────────────── */}
      {view === 'shifts' && !loading && (
        <div>
          <div className="mb-4 flex items-center gap-3 flex-wrap">
            <input value={shiftFilter} onChange={e => setShiftFilter(e.target.value)}
              placeholder={ar ? 'بحث عن كود...' : 'Search code...'}
              className="text-xs rounded-xl px-3 py-2 outline-none w-52"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0' }} />
            <span className="text-xs" style={{ color: '#475569' }}>
              {filteredShifts.length} / {shifts.length} {ar ? 'كود' : 'codes'}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filteredShifts.map(s => (
              <div key={s.code}
                style={{
                  ...cardStyle(dark), padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
                  border: `1px solid ${s.isActive ? (dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)') : (dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)')}`,
                  opacity: s.isActive ? 1 : 0.5,
                }}>
                {/* Code + badges */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold font-mono px-2 py-0.5 rounded-lg"
                    style={{ background: s.displayColor ? `${s.displayColor}25` : (dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'), color: s.displayColor ?? tp(dark) }}>
                    {s.code}
                  </span>
                  <span className="text-xs" style={{ color: tsColor(dark) }}>{ar && s.descriptionAr ? s.descriptionAr : s.description}</span>
                </div>
                {/* Times */}
                {s.startTime && (
                  <div className="text-[11px] font-mono" style={{ color: '#64748b' }}>
                    {s.startTime}–{s.endTime}
                    {s.isSplitShift && s.startTime && ` + split`}
                    {s.workingHours > 0 && <span className="ms-2" style={{ color: '#818cf8' }}>{s.workingHours}h</span>}
                  </div>
                )}
                {/* Tags */}
                <div className="flex flex-wrap gap-1">
                  {s.categoryName && <Tag1 label={s.categoryName} color="#64748b" />}
                  {s.isCrossMidnight && <Tag1 label={ar ? 'يتجاوز منتصف الليل' : 'Cross-midnight'} color="#a78bfa" />}
                  {s.isWfh && <Tag1 label="WFH" color="#818cf8" />}
                  {s.isRamadan && <Tag1 label={ar ? 'رمضان' : 'Ramadan'} color="#fbbf24" />}
                  {s.isSupervisor && <Tag1 label={ar ? 'مشرف' : 'Supervisor'} color="#22d3ee" />}
                  {s.isLeaveCode && <Tag1 label={ar ? 'إجازة' : 'Leave'} color="#a78bfa" />}
                  {s.isAbsenceCode && <Tag1 label={ar ? 'غياب' : 'Absence'} color="#f87171" />}
                  {!s.allowsFemale && s.isWorkingShift && <Tag1 label={ar ? 'ذكر فقط' : 'Male only'} color="#fb923c" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Functions ──────────────────────────────────────────────────── */}
      {view === 'functions' && !loading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {funcs.map(f => (
            <div key={f.id} style={{ ...cardStyle(dark), padding: 16 }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold" style={{ color: tp(dark) }}>{f.name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(52,211,153,0.1)', color: '#34d399' }}>
                  {f.active_count} {ar ? 'نشط' : 'active'}
                </span>
              </div>
              <div className="text-xs" style={{ color: tsColor(dark) }}>
                {ar ? `${f.headcount} موظف إجمالاً` : `${f.headcount} total employees`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tag1({ label, color }: { label: string; color: string }) {
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: `${color}18`, color }}>
      {label}
    </span>
  );
}
