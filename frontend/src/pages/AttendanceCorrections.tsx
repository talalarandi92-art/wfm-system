import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardCheck, Plus, Loader2, X, Check, XCircle, Search, Clock,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { card as cardStyle, tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface Correction {
  id: string; status: string; submittedAt: string;
  employeeNo: string; employeeName: string; function: string | null;
  attendanceDate: string; correctionType: string; field: string | null;
  requestedValue: string | null; currentValue: string | null;
  reason: string; applied: boolean; rejectionReason: string | null;
}
interface Emp { id: string; employeeNo: string; name: string; functionName?: string }

const CORR_TYPES: { code: string; ar: string; en: string; field: string }[] = [
  { code: 'missing_punch_in',  ar: 'بصمة دخول ناقصة', en: 'Missing punch-in',   field: 'punch_in' },
  { code: 'missing_punch_out', ar: 'بصمة خروج ناقصة', en: 'Missing punch-out',  field: 'punch_out' },
  { code: 'missing_login',     ar: 'تسجيل دخول ناقص', en: 'Missing system login',  field: 'system_login' },
  { code: 'missing_logout',    ar: 'تسجيل خروج ناقص', en: 'Missing system logout', field: 'system_logout' },
  { code: 'wrong_time',        ar: 'وقت خاطئ',         en: 'Wrong time',          field: 'punch_in' },
  { code: 'other',             ar: 'أخرى',             en: 'Other',               field: '' },
];
const FIELDS: { code: string; ar: string; en: string }[] = [
  { code: 'punch_in',      ar: 'بصمة دخول',   en: 'Punch in' },
  { code: 'punch_out',     ar: 'بصمة خروج',   en: 'Punch out' },
  { code: 'system_login',  ar: 'دخول النظام',  en: 'System login' },
  { code: 'system_logout', ar: 'خروج النظام',  en: 'System logout' },
];
const STATUS_META: Record<string, { ar: string; en: string; color: string }> = {
  pending:  { ar: 'قيد المراجعة', en: 'Pending',  color: '#fbbf24' },
  approved: { ar: 'مطبّق',        en: 'Approved', color: '#22c55e' },
  rejected: { ar: 'مرفوض',        en: 'Rejected', color: '#ef4444' },
};

const emptyForm = () => ({
  employeeId: '', employeeName: '',
  attendanceDate: '', correctionType: 'missing_punch_in',
  field: 'punch_in', requestedValue: '', currentValue: '', reason: '',
});

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function AttendanceCorrectionsPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [list, setList]   = useState<Correction[]>([]);
  const [loading, setL]   = useState(true);
  const [show, setShow]   = useState(false);
  const [saving, setSav]  = useState(false);
  const [form, setForm]   = useState(emptyForm());
  const [empSearch, setES]= useState('');
  const [emps, setEmps]   = useState<Emp[]>([]);

  const load = useCallback(async () => {
    setL(true);
    try { const { data } = await apiClient.get<Correction[]>('/attendance-corrections'); setList(Array.isArray(data) ? data : []); }
    catch { setList([]); }
    setL(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // employee search (reuses the requests employee endpoint)
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => {
      apiClient.get('/requests/employees', { params: { search: empSearch || undefined } })
        .then(r => setEmps(Array.isArray(r.data) ? r.data : (r.data?.data ?? [])))
        .catch(() => setEmps([]));
    }, 250);
    return () => clearTimeout(t);
  }, [empSearch, show]);

  const pickCorrType = (code: string) => {
    const ct = CORR_TYPES.find(c => c.code === code);
    setForm(f => ({ ...f, correctionType: code, field: ct?.field || f.field }));
  };

  const save = async () => {
    if (!form.employeeId || !form.attendanceDate || !form.reason.trim()) return;
    setSav(true);
    try {
      await apiClient.post('/attendance-corrections', {
        employeeId: form.employeeId, attendanceDate: form.attendanceDate,
        correctionType: form.correctionType, field: form.field || null,
        requestedValue: form.requestedValue || null, currentValue: form.currentValue || null,
        reason: form.reason,
      });
      setShow(false); setForm(emptyForm()); await load();
    } catch {}
    setSav(false);
  };

  const approve = async (id: string) => { try { await apiClient.post(`/attendance-corrections/${id}/approve`); await load(); } catch {} };
  const reject  = async (id: string) => {
    const reason = window.prompt(ar ? 'سبب الرفض؟' : 'Rejection reason?') ?? '';
    try { await apiClient.post(`/attendance-corrections/${id}/reject`, { reason }); await load(); } catch {}
  };

  /* theme-aware neutral tokens — dark keeps the original explicit values; light mirrors them.
     Semantic (sky/status) + mid-gray muted text (#475569/#64748b/#94a3b8) stay as-is. */
  const T = {
    cardBg:  dark ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.02)',
    fieldBg: dark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)',
    panelBg: dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
    bdr:     dark ? 'rgba(255,255,255,0.1)'  : 'rgba(15,23,42,0.12)',
    bdrSoft: dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)',
    bdrRow:  dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.06)',
    headBg:  dark ? 'rgba(0,0,0,0.25)'       : 'rgba(15,23,42,0.05)',
    optBg:   dark ? '#0f172a'                : '#ffffff',
    text:    tp(dark),
    text2:   dark ? '#cbd5e1' : '#334155',
  };
  const input = {
    background: T.fieldBg, border: `1px solid ${T.bdr}`,
    borderRadius: 10, color: T.text, padding: '8px 10px', fontSize: 13, outline: 'none', width: '100%',
  } as const;
  const ctMeta = (c: string) => CORR_TYPES.find(x => x.code === c);

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.22)' }}>
            <ClipboardCheck size={18} style={{ color: '#38bdf8' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'تصحيح الحضور' : 'Attendance Corrections'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>
              {ar ? 'تصحيح بصمة / تسجيل دخول ناقص — يُطبّق على الحضور بعد الموافقة' : 'Fix missing punch / login — applied to attendance on approval'}
            </p>
          </div>
        </div>
        <button onClick={() => { setForm(emptyForm()); setShow(true); }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold hover:opacity-80"
          style={{ background: 'rgba(56,189,248,0.15)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8' }}>
          <Plus size={14} /> {ar ? 'طلب تصحيح' : 'New correction'}
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : list.length === 0 ? (
        <div className="text-center py-20" style={{ color: '#475569' }}>
          <ClipboardCheck size={32} className="mx-auto mb-3" style={{ color: '#334155' }} />
          <p className="text-sm">{ar ? 'لا توجد طلبات تصحيح' : 'No correction requests yet'}</p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-x-auto" style={{ background: T.cardBg, border: `1px solid ${T.bdrSoft}` }}>
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: T.headBg, borderBottom: `1px solid ${T.bdrSoft}` }}>
                {[ar ? 'الموظف' : 'Employee', ar ? 'التاريخ' : 'Date', ar ? 'النوع' : 'Type', ar ? 'الحقل' : 'Field', ar ? 'الوقت' : 'Time', ar ? 'الحالة' : 'Status', ''].map((h, i) => (
                  <th key={i} className="text-[10px] font-semibold uppercase tracking-wider text-start px-3 py-2.5" style={{ color: '#475569', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map(c => {
                const sm = STATUS_META[c.status] ?? { ar: c.status, en: c.status, color: '#64748b' };
                const ct = ctMeta(c.correctionType);
                return (
                  <tr key={c.id} style={{ borderBottom: `1px solid ${T.bdrRow}` }}>
                    <td className="px-3 py-2.5">
                      <div className="text-xs font-medium" style={{ color: T.text }}>{c.employeeName}</div>
                      <div className="text-[10px]" style={{ color: '#475569' }}>#{c.employeeNo}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums" style={{ color: '#94a3b8' }}>{c.attendanceDate}</td>
                    <td className="px-3 py-2.5 text-[11px]" style={{ color: T.text2 }}>{ar ? ct?.ar ?? c.correctionType : ct?.en ?? c.correctionType}</td>
                    <td className="px-3 py-2.5 text-[11px]" style={{ color: '#64748b' }}>{c.field ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs tabular-nums" style={{ color: '#38bdf8' }}>{c.requestedValue ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ background: `${sm.color}22`, color: sm.color }}>
                        {ar ? sm.ar : sm.en}{c.applied ? ' ✓' : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {c.status === 'pending' && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => approve(c.id)} className="flex items-center gap-1 text-[11px] hover:opacity-80" style={{ color: '#22c55e' }}><Check size={12} /> {ar ? 'موافقة' : 'Approve'}</button>
                          <button onClick={() => reject(c.id)} className="flex items-center gap-1 text-[11px] hover:opacity-80" style={{ color: '#f87171' }}><XCircle size={12} /> {ar ? 'رفض' : 'Reject'}</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Form modal */}
      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShow(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
            style={{ background: dark ? '#0f172a' : '#fff', border: `1px solid ${T.bdr}` }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? 'طلب تصحيح حضور' : 'New attendance correction'}</h2>
              <button onClick={() => setShow(false)}><X size={16} style={{ color: '#64748b' }} /></button>
            </div>

            {/* Employee */}
            <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'الموظف' : 'Employee'}</label>
            {form.employeeId ? (
              <div className="flex items-center justify-between rounded-xl px-3 py-2 mb-3" style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)' }}>
                <span className="text-xs" style={{ color: T.text }}>{form.employeeName}</span>
                <button onClick={() => setForm(f => ({ ...f, employeeId: '', employeeName: '' }))}><X size={13} style={{ color: '#64748b' }} /></button>
              </div>
            ) : (
              <div className="mb-3">
                <div className="flex items-center gap-2 rounded-xl px-2.5 mb-1" style={{ background: T.fieldBg, border: `1px solid ${T.bdr}` }}>
                  <Search size={13} style={{ color: '#475569' }} />
                  <input value={empSearch} onChange={e => setES(e.target.value)} placeholder={ar ? 'بحث عن موظف...' : 'Search employee...'}
                    style={{ background: 'transparent', border: 'none', outline: 'none', color: T.text, fontSize: 13, padding: '8px 0', width: '100%' }} />
                </div>
                {emps.length > 0 && (
                  <div className="rounded-xl max-h-40 overflow-y-auto" style={{ background: T.panelBg, border: `1px solid ${T.bdrSoft}` }}>
                    {emps.slice(0, 20).map(e => (
                      <button key={e.id} onClick={() => { setForm(f => ({ ...f, employeeId: e.id, employeeName: e.name })); setES(''); setEmps([]); }}
                        className="w-full text-start px-3 py-2 hover:bg-white/[0.04] text-xs" style={{ color: T.text2 }}>
                        {e.name} <span style={{ color: '#475569' }}>#{e.employeeNo}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'تاريخ الحضور' : 'Attendance date'}</label>
            <input type="date" value={form.attendanceDate} onChange={e => setForm(f => ({ ...f, attendanceDate: e.target.value }))} style={input} className="mb-3" />

            <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'نوع التصحيح' : 'Correction type'}</label>
            <select value={form.correctionType} onChange={e => pickCorrType(e.target.value)} style={input} className="mb-3">
              {CORR_TYPES.map(c => <option key={c.code} value={c.code} style={{ background: T.optBg }}>{ar ? c.ar : c.en}</option>)}
            </select>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'الحقل' : 'Field'}</label>
                <select value={form.field} onChange={e => setForm(f => ({ ...f, field: e.target.value }))} style={input}>
                  <option value="" style={{ background: T.optBg }}>{ar ? '—' : '—'}</option>
                  {FIELDS.map(f => <option key={f.code} value={f.code} style={{ background: T.optBg }}>{ar ? f.ar : f.en}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'الوقت الصحيح' : 'Correct time'}</label>
                <input type="time" value={form.requestedValue} onChange={e => setForm(f => ({ ...f, requestedValue: e.target.value }))} style={input} />
              </div>
            </div>

            <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'السبب' : 'Reason'}</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} style={{ ...input, minHeight: 56 }} className="mb-4"
              placeholder={ar ? 'سبب التصحيح...' : 'Why this correction...'} />

            <button onClick={save} disabled={saving || !form.employeeId || !form.attendanceDate || !form.reason.trim()}
              className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: 'rgba(56,189,248,0.15)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8' }}>
              {saving ? <Loader2 size={14} className="animate-spin inline" /> : (ar ? 'إرسال' : 'Submit')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
