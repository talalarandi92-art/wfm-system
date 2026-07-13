import { useState, useEffect, useCallback } from 'react';
import {
  Settings as SettingsIcon, Save, RotateCcw, ChevronRight,
  Code, Building2, Users, Loader2, Check, X, Tag,
  Shield, ToggleLeft, ToggleRight, Calendar, Zap, Plane,
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
interface LeaveBal { leaveType: string; configured: boolean; entitlement: number; taken: number; pending: number; remaining: number | null }
interface LeaveRow { employeeId: string; employeeNo: string; name: string; functionName: string | null; balances: LeaveBal[] }

type View = 'overview' | 'settings' | 'shifts' | 'functions' | 'leaves';

const LEAVE_TYPES = ['annual_leave', 'comp_off', 'sick_leave'] as const;
const LEAVE_LABEL: Record<string, { ar: string; en: string }> = {
  annual_leave: { ar: 'سنوية', en: 'Annual' },
  comp_off:     { ar: 'تعويضية', en: 'Comp-off' },
  sick_leave:   { ar: 'مرضية', en: 'Sick' },
};

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

  /* theme-aware neutral tokens — dark keeps the original explicit values; light mirrors
     them with a slate-navy tint. Cards use ds card()/cardStyle(dark); brand accents
     (#818cf8 / #22d3ee) + mid-gray muted text (#64748b / #475569) stay inline. */
  const T = {
    fieldBg:  dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.05)',
    fieldBg2: dark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)',
    bdr:      dark ? 'rgba(255,255,255,0.1)'  : 'rgba(15,23,42,0.12)',
    bdrSoft:  dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.1)',
    bdrRow:   dark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.06)',
    text:     tp(dark),
  };

  const [view, setView]         = useState<View>('overview');
  const [settings, setSettings] = useState<Record<string, Setting[]>>({});
  const [shifts, setShifts]     = useState<ShiftCode[]>([]);
  const [funcs, setFuncs]       = useState<FuncRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState<string | null>(null);
  const [saved, setSaved]       = useState<string | null>(null);
  const [edits, setEdits]       = useState<Record<string, any>>({});
  const [shiftFilter, setShiftFilter] = useState('');
  const [leaves, setLeaves]     = useState<LeaveRow[]>([]);
  const [leaveYear, setLeaveYear] = useState<number>(new Date().getFullYear());
  const [leaveFilter, setLeaveFilter] = useState('');
  const [entEdits, setEntEdits] = useState<Record<string, string>>({});  // `${empId}|${type}` → days
  const [entSaving, setEntSaving] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ applied: number; employeesTouched: number; unmatched: string[] } | null>(null);

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

  const loadLeaves = useCallback(async (year: number) => {
    setLoading(true);
    try {
      const { data } = await apiClient.get(`/leave-balances/all?year=${year}`);
      setLeaves(Array.isArray(data) ? data : []);
    } catch { setLeaves([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (view === 'settings') loadSettings();
    else if (view === 'shifts') loadShifts();
    else if (view === 'functions') loadFuncs();
    else if (view === 'leaves') loadLeaves(leaveYear);
  }, [view, leaveYear]);

  // Parse pasted rows: "employee_no [annual] [comp] [sick]" (tab / comma / space separated).
  const parseBulkRows = (text: string) =>
    text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
      const parts = line.split(/[\t,;]+|\s{1,}/).map(s => s.trim()).filter(Boolean);
      const [employeeNo, a, c, s] = parts;
      const num = (v: string) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
      return { employeeNo, annual_leave: num(a), comp_off: num(c), sick_leave: num(s) };
    }).filter(r => r.employeeNo);

  const submitBulk = async () => {
    const rows = parseBulkRows(bulkText);
    if (!rows.length) return;
    setBulkBusy(true); setBulkResult(null);
    try {
      const { data } = await apiClient.post('/leave-balances/entitlement/bulk', { year: leaveYear, rows });
      setBulkResult(data);
      await loadLeaves(leaveYear);
    } catch {}
    setBulkBusy(false);
  };

  const saveEntitlement = async (employeeId: string, leaveType: string, daysRaw: string) => {
    const days = parseFloat(daysRaw);
    if (!Number.isFinite(days) || days < 0) return;
    const k = `${employeeId}|${leaveType}`;
    setEntSaving(k);
    try {
      await apiClient.post('/leave-balances/entitlement', { employeeId, leaveType, year: leaveYear, days });
      setEntEdits(d => { const n = { ...d }; delete n[k]; return n; });
      await loadLeaves(leaveYear);
    } catch {}
    setEntSaving(null);
  };

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
    { id: 'leaves',     labelAr: 'أرصدة الإجازات',   labelEn: 'Leave Balances',   icon: Plane,        descAr: 'تحديد استحقاق الإجازات للموظفين', descEn: 'Set annual leave entitlements', color: '#22d3ee' },
  ];

  const filteredLeaves = leaves.filter(r =>
    !leaveFilter || r.name.toLowerCase().includes(leaveFilter.toLowerCase())
      || (r.employeeNo ?? '').includes(leaveFilter)
      || (r.functionName ?? '').toLowerCase().includes(leaveFilter.toLowerCase()));

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
                          <div className="text-xs font-medium font-mono" style={{ color: T.text }}>{key}</div>
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
                              style={{ background: T.fieldBg, border: `1px solid ${isEdited ? '#818cf8' : T.bdr}`, color: T.text, fontFamily: 'monospace' }} />
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
              style={{ background: T.fieldBg2, border: `1px solid ${T.bdrSoft}`, color: T.text }} />
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

      {/* ── Leave balances (admin entitlements) ────────────────────────── */}
      {view === 'leaves' && !loading && (
        <div>
          <div className="mb-4 flex items-center gap-3 flex-wrap">
            <input value={leaveFilter} onChange={e => setLeaveFilter(e.target.value)}
              placeholder={ar ? 'بحث بالاسم / الرقم / الوظيفة...' : 'Search name / no. / function...'}
              className="text-xs rounded-xl px-3 py-2 outline-none w-60"
              style={{ background: T.fieldBg2, border: `1px solid ${T.bdrSoft}`, color: T.text }} />
            <div className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'السنة' : 'Year'}</span>
              <select value={leaveYear} onChange={e => setLeaveYear(parseInt(e.target.value, 10))}
                className="text-xs rounded-xl px-2 py-2 outline-none"
                style={{ background: T.fieldBg2, border: `1px solid ${T.bdrSoft}`, color: T.text }}>
                {[0, -1, 1].map(d => { const y = new Date().getFullYear() + d; return <option key={y} value={y}>{y}</option>; })}
              </select>
            </div>
            <span className="text-xs" style={{ color: '#475569' }}>
              {filteredLeaves.length} / {leaves.length} {ar ? 'موظف' : 'employees'}
            </span>
            <button onClick={() => { setBulkOpen(o => !o); setBulkResult(null); }}
              className="text-xs font-semibold px-3 py-2 rounded-xl ms-auto"
              style={{ background: 'rgba(34,211,238,0.12)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.25)' }}>
              {ar ? 'لصق جماعي من Excel' : 'Bulk paste from Excel'}
            </button>
          </div>

          {/* Bulk paste panel */}
          {bulkOpen && (
            <div className="rounded-2xl p-4 mb-4" style={{ ...cardStyle(dark), border: '1px solid rgba(34,211,238,0.2)' }}>
              <p className="text-xs mb-2" style={{ color: tsColor(dark) }}>
                {ar ? 'الصق صفوفاً: رقم الموظف ثم السنوية ثم التعويضية ثم المرضية (افصل بـTab أو فاصلة). أعمدة الإجازات اختيارية.'
                    : 'Paste rows: employee_no, annual, comp-off, sick (Tab/comma separated). Leave columns optional.'}
              </p>
              <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={6}
                placeholder={'10234\t30\t5\t15\n10235\t30'}
                className="w-full text-xs rounded-xl px-3 py-2 outline-none font-mono"
                style={{ background: T.fieldBg, border: `1px solid ${T.bdr}`, color: T.text }} />
              <div className="flex items-center gap-3 mt-2">
                <button onClick={submitBulk} disabled={bulkBusy || !bulkText.trim()}
                  className="text-xs font-semibold px-4 py-2 rounded-xl flex items-center gap-1.5 disabled:opacity-50"
                  style={{ background: '#22d3ee', color: '#0a0f1e' }}>
                  {bulkBusy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {ar ? `تطبيق (${parseBulkRows(bulkText).length} صف)` : `Apply (${parseBulkRows(bulkText).length} rows)`}
                </button>
                {bulkResult && (
                  <span className="text-xs" style={{ color: tsColor(dark) }}>
                    <Check size={12} className="inline" style={{ color: '#34d399' }} />{' '}
                    {ar ? `${bulkResult.applied} استحقاق لـ${bulkResult.employeesTouched} موظف`
                        : `${bulkResult.applied} entitlements · ${bulkResult.employeesTouched} employees`}
                    {bulkResult.unmatched.length > 0 && (
                      <span style={{ color: '#f87171' }}> · {ar ? 'غير مطابق' : 'unmatched'}: {bulkResult.unmatched.slice(0, 8).join(', ')}{bulkResult.unmatched.length > 8 ? '…' : ''}</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl overflow-x-auto" style={{ ...cardStyle(dark) }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.bdrSoft}` }}>
                  <th className="text-start font-semibold px-3 py-2.5" style={{ color: tsColor(dark) }}>{ar ? 'الموظف' : 'Employee'}</th>
                  {LEAVE_TYPES.map(t => (
                    <th key={t} className="text-center font-semibold px-3 py-2.5" style={{ color: '#22d3ee' }}>
                      {ar ? LEAVE_LABEL[t].ar : LEAVE_LABEL[t].en}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLeaves.map(r => (
                  <tr key={r.employeeId} style={{ borderBottom: `1px solid ${T.bdrRow}` }}>
                    <td className="px-3 py-2">
                      <div className="font-medium" style={{ color: tp(dark) }}>{r.name || '—'}</div>
                      <div className="text-[10px]" style={{ color: '#475569' }}>
                        {r.employeeNo ? `#${r.employeeNo}` : ''}{r.functionName ? ` · ${r.functionName}` : ''}
                      </div>
                    </td>
                    {LEAVE_TYPES.map(t => {
                      const b = r.balances.find(x => x.leaveType === t);
                      const k = `${r.employeeId}|${t}`;
                      const editVal = entEdits[k] ?? (b?.configured ? String(b.entitlement) : '');
                      const isEdited = entEdits[k] !== undefined && entEdits[k] !== (b?.configured ? String(b.entitlement) : '');
                      return (
                        <td key={t} className="px-3 py-2 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <input
                              value={editVal}
                              onChange={e => setEntEdits(d => ({ ...d, [k]: e.target.value }))}
                              placeholder="—" inputMode="decimal"
                              className="w-14 text-center text-xs rounded-lg px-1.5 py-1 outline-none"
                              style={{ background: T.fieldBg, border: `1px solid ${isEdited ? '#22d3ee' : T.bdr}`, color: T.text }} />
                            {isEdited && (
                              <button onClick={() => saveEntitlement(r.employeeId, t, editVal)} disabled={entSaving === k}
                                className="p-1 rounded-md hover:bg-white/5" style={{ color: '#34d399' }}>
                                {entSaving === k ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                              </button>
                            )}
                          </div>
                          {b?.configured && (
                            <div className="text-[9px] mt-0.5" style={{ color: '#475569' }}>
                              {ar ? 'متبقٍ' : 'left'} <b style={{ color: (b.remaining ?? 0) > 0 ? '#34d399' : '#f87171' }}>{b.remaining}</b>
                              {(b.taken + b.pending) > 0 && <span> · {ar ? 'مأخوذ' : 'used'} {b.taken}{b.pending > 0 ? `+${b.pending}` : ''}</span>}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {filteredLeaves.length === 0 && (
                  <tr><td colSpan={LEAVE_TYPES.length + 1} className="text-center py-8" style={{ color: '#475569' }}>
                    {ar ? 'لا يوجد موظفون' : 'No employees'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] mt-2" style={{ color: '#475569' }}>
            {ar ? 'أدخل أيام الاستحقاق ثم احفظ — يُحسب المتبقّي تلقائياً من الإجازات المعتمدة والمعلّقة.'
                : 'Enter entitlement days then save — remaining is computed live from approved + pending leave.'}
          </p>
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
