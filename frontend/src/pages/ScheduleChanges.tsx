import { useState, useEffect, useCallback } from 'react';
import {
  CalendarCog, Plus, Loader2, X, Check, XCircle, Search, ArrowRight,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

interface SChange {
  id: string; status: string; submittedAt: string;
  employeeNo: string; employeeName: string; function: string | null;
  changeDate: string; currentShiftCode: string | null; requestedShiftCode: string;
  reason: string; applied: boolean; rejectionReason: string | null;
}
interface Emp { id: string; employeeNo: string; name: string }

const STATUS_META: Record<string, { ar: string; en: string; color: string }> = {
  pending:  { ar: 'قيد المراجعة', en: 'Pending',  color: '#fbbf24' },
  approved: { ar: 'مطبّق',        en: 'Approved', color: '#22c55e' },
  rejected: { ar: 'مرفوض',        en: 'Rejected', color: '#ef4444' },
};
const COMMON_CODES = ['M', 'B', 'C', 'N', 'E', 'EE20', 'MD', 'MN', 'OFF', 'WFH'];
const emptyForm = () => ({ employeeId: '', employeeName: '', changeDate: '', currentShiftCode: '', requestedShiftCode: '', reason: '' });

export default function ScheduleChangesPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [list, setList] = useState<SChange[]>([]);
  const [loading, setL] = useState(true);
  const [show, setShow] = useState(false);
  const [saving, setSav] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [empSearch, setES] = useState('');
  const [emps, setEmps] = useState<Emp[]>([]);

  const load = useCallback(async () => {
    setL(true);
    try { const { data } = await apiClient.get<SChange[]>('/schedule-changes'); setList(Array.isArray(data) ? data : []); }
    catch { setList([]); }
    setL(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => {
      apiClient.get('/requests/employees', { params: { search: empSearch || undefined } })
        .then(r => setEmps(Array.isArray(r.data) ? r.data : (r.data?.data ?? [])))
        .catch(() => setEmps([]));
    }, 250);
    return () => clearTimeout(t);
  }, [empSearch, show]);

  const save = async () => {
    if (!form.employeeId || !form.changeDate || !form.requestedShiftCode.trim() || !form.reason.trim()) return;
    setSav(true);
    try {
      await apiClient.post('/schedule-changes', {
        employeeId: form.employeeId, changeDate: form.changeDate,
        currentShiftCode: form.currentShiftCode || null,
        requestedShiftCode: form.requestedShiftCode.trim().toUpperCase(), reason: form.reason,
      });
      setShow(false); setForm(emptyForm()); await load();
    } catch {}
    setSav(false);
  };
  const approve = async (id: string) => { try { await apiClient.post(`/schedule-changes/${id}/approve`); await load(); } catch {} };
  const reject  = async (id: string) => {
    const reason = window.prompt(ar ? 'سبب الرفض؟' : 'Rejection reason?') ?? '';
    try { await apiClient.post(`/schedule-changes/${id}/reject`, { reason }); await load(); } catch {}
  };

  /* theme-aware neutral tokens — dark keeps the original explicit values; light mirrors them.
     Semantic (amber/status) + mid-gray muted text (#475569/#64748b/#94a3b8) stay as-is. */
  const T = {
    cardBg:  dark ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.02)',
    fieldBg: dark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)',
    panelBg: dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
    bdr:     dark ? 'rgba(255,255,255,0.1)'  : 'rgba(15,23,42,0.12)',
    bdrSoft: dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)',
    bdrRow:  dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.06)',
    headBg:  dark ? 'rgba(0,0,0,0.25)'       : 'rgba(15,23,42,0.05)',
    text:    tp(dark),
    text2:   dark ? '#cbd5e1' : '#334155',
  };
  const input = {
    background: T.fieldBg, border: `1px solid ${T.bdr}`,
    borderRadius: 10, color: T.text, padding: '8px 10px', fontSize: 13, outline: 'none', width: '100%',
  } as const;

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(251,146,60,0.12)', border: '1px solid rgba(251,146,60,0.22)' }}>
            <CalendarCog size={18} style={{ color: '#fb923c' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'تغيير الجدول' : 'Schedule Changes'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>
              {ar ? 'طلب تغيير وردية بتاريخ — يُطبّق على الجدول بعد الموافقة' : 'Request a shift change on a date — applied to the schedule on approval'}
            </p>
          </div>
        </div>
        <button onClick={() => { setForm(emptyForm()); setShow(true); }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold hover:opacity-80"
          style={{ background: 'rgba(251,146,60,0.15)', border: '1px solid rgba(251,146,60,0.3)', color: '#fb923c' }}>
          <Plus size={14} /> {ar ? 'طلب تغيير' : 'New change'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : list.length === 0 ? (
        <div className="text-center py-20" style={{ color: '#475569' }}>
          <CalendarCog size={32} className="mx-auto mb-3" style={{ color: '#334155' }} />
          <p className="text-sm">{ar ? 'لا توجد طلبات تغيير جدول' : 'No schedule change requests yet'}</p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-x-auto" style={{ background: T.cardBg, border: `1px solid ${T.bdrSoft}` }}>
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: T.headBg, borderBottom: `1px solid ${T.bdrSoft}` }}>
                {[ar ? 'الموظف' : 'Employee', ar ? 'التاريخ' : 'Date', ar ? 'التغيير' : 'Change', ar ? 'السبب' : 'Reason', ar ? 'الحالة' : 'Status', ''].map((h, i) => (
                  <th key={i} className="text-[10px] font-semibold uppercase tracking-wider text-start px-3 py-2.5" style={{ color: '#475569', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map(c => {
                const sm = STATUS_META[c.status] ?? { ar: c.status, en: c.status, color: '#64748b' };
                return (
                  <tr key={c.id} style={{ borderBottom: `1px solid ${T.bdrRow}` }}>
                    <td className="px-3 py-2.5">
                      <div className="text-xs font-medium" style={{ color: T.text }}>{c.employeeName}</div>
                      <div className="text-[10px]" style={{ color: '#475569' }}>#{c.employeeNo}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums" style={{ color: '#94a3b8' }}>{c.changeDate}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-[11px]">
                        <span style={{ color: '#64748b' }}>{c.currentShiftCode ?? '—'}</span>
                        <ArrowRight size={11} style={{ color: '#475569' }} />
                        <span className="font-bold" style={{ color: '#fb923c' }}>{c.requestedShiftCode}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] max-w-[200px] truncate" style={{ color: '#94a3b8' }}>{c.reason}</td>
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

      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShow(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
            style={{ background: dark ? '#0f172a' : '#fff', border: `1px solid ${T.bdr}` }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? 'طلب تغيير جدول' : 'New schedule change'}</h2>
              <button onClick={() => setShow(false)}><X size={16} style={{ color: '#64748b' }} /></button>
            </div>

            <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'الموظف' : 'Employee'}</label>
            {form.employeeId ? (
              <div className="flex items-center justify-between rounded-xl px-3 py-2 mb-3" style={{ background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.2)' }}>
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

            <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'تاريخ التغيير' : 'Change date'}</label>
            <input type="date" value={form.changeDate} onChange={e => setForm(f => ({ ...f, changeDate: e.target.value }))} style={input} className="mb-3" />

            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'الوردية الحالية' : 'Current shift'}</label>
                <input value={form.currentShiftCode} onChange={e => setForm(f => ({ ...f, currentShiftCode: e.target.value }))} style={input} placeholder={ar ? '(اختياري)' : '(optional)'} />
              </div>
              <div>
                <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'الوردية المطلوبة' : 'Requested shift'}</label>
                <input value={form.requestedShiftCode} onChange={e => setForm(f => ({ ...f, requestedShiftCode: e.target.value.toUpperCase() }))} style={input} list="shiftcodes" placeholder="M, C, OFF..." />
                <datalist id="shiftcodes">{COMMON_CODES.map(c => <option key={c} value={c} />)}</datalist>
              </div>
            </div>

            <label className="text-[11px] font-semibold block mb-1" style={{ color: tsColor(dark) }}>{ar ? 'السبب' : 'Reason'}</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} style={{ ...input, minHeight: 56 }} className="mb-4" />

            <button onClick={save} disabled={saving || !form.employeeId || !form.changeDate || !form.requestedShiftCode.trim() || !form.reason.trim()}
              className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: 'rgba(251,146,60,0.15)', border: '1px solid rgba(251,146,60,0.3)', color: '#fb923c' }}>
              {saving ? <Loader2 size={14} className="animate-spin inline" /> : (ar ? 'إرسال' : 'Submit')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
