import { useState, useEffect, useCallback } from 'react';
import {
  Users, RefreshCw, GitMerge, AlertTriangle, CheckCircle2,
  X, Loader2, Calendar, FileText, UserCheck, Crown,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface DupEmployee {
  id: string;
  employeeNo: string;
  fullName: string;
  gender: string;
  status: string;
  hireDate?: string;
  createdAt: string;
  functionName?: string;
  teamName?: string;
  attendanceCount: number;
  attendanceFrom?: string;
  attendanceTo?: string;
  scheduleCount: number;
  requestCount: number;
  hasUser: boolean;
}

interface DupGroup {
  normName: string;
  sameFunction: boolean;
  employees: DupEmployee[];
}

interface MergeResult {
  survivorId: string;
  mergedId: string;
  oldEmployeeNo: string;
  moved: Record<string, number>;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const fmtDate = (d?: string | null) => (d ? d.substring(0, 10) : '—');

const STATUS_COLOR: Record<string, string> = {
  active: '#10b981',
  inactive: '#64748b',
  resigned: '#f59e0b',
  terminated: '#ef4444',
  on_leave: '#8b5cf6',
};

/* ─── Page ──────────────────────────────────────────────────────────────── */
export default function EmployeeMergePage() {
  const { lang, dark } = useUiStore();
  useInjectDsStyles();
  const ar = lang === 'ar';

  const [loading, setLoading] = useState(true);
  const [groups, setGroups]   = useState<DupGroup[]>([]);
  const [error, setError]     = useState('');

  // selection per group: which employee survives / which gets merged
  const [confirm, setConfirm] = useState<{
    group: DupGroup; survivor: DupEmployee; merged: DupEmployee;
  } | null>(null);
  const [reason, setReason]   = useState('');
  const [merging, setMerging] = useState(false);
  const [lastResult, setLastResult] = useState<MergeResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await apiClient.get('/employees/duplicates');
      setGroups(data.groups ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? (ar ? 'فشل تحميل البيانات' : 'Failed to load duplicates'));
    } finally {
      setLoading(false);
    }
  }, [ar]);

  useEffect(() => { load(); }, [load]);

  const doMerge = async () => {
    if (!confirm) return;
    setMerging(true);
    setError('');
    try {
      const { data } = await apiClient.post('/employees/merge', {
        survivorId: confirm.survivor.id,
        mergedId:   confirm.merged.id,
        reason:     reason || undefined,
      });
      setLastResult(data);
      setConfirm(null);
      setReason('');
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? (ar ? 'فشل الدمج' : 'Merge failed'));
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
               style={{ background: 'rgba(99,102,241,.15)' }}>
            <GitMerge size={20} className="text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>
              {ar ? 'دمج الموظفين المكررين' : 'Duplicate Employee Merge'}
            </h1>
            <p className="text-sm text-slate-400">
              {ar
                ? 'سجلات يشتبه بتكرارها بسبب تغيّر الرقم الوظيفي بين الاستيرادات الشهرية'
                : 'Records suspected to be the same person under a different employee number'}
            </p>
          </div>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-slate-700 hover:border-indigo-500/60 transition-colors"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          {ar ? 'تحديث' : 'Refresh'}
        </button>
      </div>

      {/* Important rule banner */}
      <div className="flex items-start gap-3 p-3 rounded-lg text-sm"
           style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)' }}>
        <AlertTriangle size={17} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-amber-200/90">
          {ar
            ? 'التطابق بالاسم اقتراح فقط — كل عملية دمج تتطلب تأكيداً يدوياً ولا يتم أي دمج تلقائي. يتم تسجيل كل دمج في سجل التدقيق.'
            : 'Name matching is a suggestion only — every merge requires manual confirmation; nothing is merged automatically. Every merge is written to the audit log.'}
        </p>
      </div>

      {/* Last merge result */}
      {lastResult && (
        <div className="flex items-start gap-3 p-3 rounded-lg text-sm"
             style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.25)' }}>
          <CheckCircle2 size={17} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-emerald-200/90">
            <p className="font-semibold">
              {ar ? 'تم الدمج بنجاح' : 'Merge completed'} — {ar ? 'الرقم القديم' : 'old employee no'}{' '}
              {lastResult.oldEmployeeNo} {ar ? 'أصبح اسماً مستعاراً' : 'saved as alias'}
            </p>
            <p className="mt-1 text-xs opacity-90">
              {ar ? 'سجلات الحضور المنقولة' : 'Attendance moved'}: {lastResult.moved.attendanceRecords}
              {' · '}{ar ? 'تعارضات محذوفة' : 'date conflicts dropped'}: {lastResult.moved.attendanceConflictsDropped}
              {' · '}{ar ? 'جداول' : 'schedule entries'}: {lastResult.moved.scheduleEntries}
              {' · '}{ar ? 'طلبات' : 'requests'}: {lastResult.moved.requests}
            </p>
          </div>
          <button onClick={() => setLastResult(null)} className="ms-auto text-emerald-300/60 hover:text-emerald-200">
            <X size={15} />
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg text-sm text-red-300"
             style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)' }}>
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 size={22} className="animate-spin me-2" />
          {ar ? 'جارٍ التحميل...' : 'Loading...'}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-slate-400">
          <CheckCircle2 size={36} className="text-emerald-500 mb-3" />
          {ar ? 'لا توجد سجلات مكررة مشتبه بها' : 'No suspected duplicate employees'}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            {ar ? `${groups.length} مجموعة مشتبه بتكرارها` : `${groups.length} suspected duplicate group(s)`}
          </p>
          {groups.map((g) => (
            <GroupCard key={g.normName} group={g} ar={ar}
                       onMerge={(survivor, merged) => setConfirm({ group: g, survivor, merged })} />
          ))}
        </div>
      )}

      {/* Confirmation modal */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,.6)' }}>
          <div className="w-full max-w-lg rounded-2xl p-6 space-y-4 text-slate-100"
               style={{ background: '#11162a', border: '1px solid rgba(255,255,255,.08)' }}>
            <div className="flex items-center gap-2">
              <GitMerge size={18} className="text-indigo-400" />
              <h2 className="font-bold">{ar ? 'تأكيد الدمج' : 'Confirm Merge'}</h2>
              <button onClick={() => setConfirm(null)} className="ms-auto text-slate-500 hover:text-slate-300">
                <X size={17} />
              </button>
            </div>

            <div className="text-sm space-y-2">
              <div className="p-3 rounded-lg" style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.25)' }}>
                <p className="text-xs text-emerald-400 font-semibold mb-1 flex items-center gap-1">
                  <Crown size={12} /> {ar ? 'السجل الباقي' : 'SURVIVOR (kept)'}
                </p>
                <p>{confirm.survivor.fullName} — #{confirm.survivor.employeeNo}</p>
                <p className="text-xs text-slate-400">
                  {confirm.survivor.functionName ?? '—'} · {confirm.survivor.attendanceCount}{' '}
                  {ar ? 'سجل حضور' : 'attendance records'} ({fmtDate(confirm.survivor.attendanceFrom)} → {fmtDate(confirm.survivor.attendanceTo)})
                </p>
              </div>
              <div className="p-3 rounded-lg" style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)' }}>
                <p className="text-xs text-red-400 font-semibold mb-1">
                  {ar ? 'السجل المدموج (سيُعطَّل)' : 'MERGED (deactivated, kept as alias)'}
                </p>
                <p>{confirm.merged.fullName} — #{confirm.merged.employeeNo}</p>
                <p className="text-xs text-slate-400">
                  {confirm.merged.functionName ?? '—'} · {confirm.merged.attendanceCount}{' '}
                  {ar ? 'سجل حضور' : 'attendance records'} ({fmtDate(confirm.merged.attendanceFrom)} → {fmtDate(confirm.merged.attendanceTo)})
                </p>
              </div>
              <p className="text-xs text-slate-400">
                {ar
                  ? `جميع سجلات الحضور والجداول والطلبات ستُنقل إلى الرقم ${confirm.survivor.employeeNo}، وسيُحفظ الرقم ${confirm.merged.employeeNo} كاسم مستعار. هذه العملية لا يمكن التراجع عنها.`
                  : `All attendance, schedule and request records will be re-pointed to #${confirm.survivor.employeeNo}. Old number #${confirm.merged.employeeNo} is saved as an alias. This cannot be undone.`}
              </p>
            </div>

            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={ar ? 'سبب الدمج (اختياري)' : 'Merge reason (optional)'}
              className="w-full px-3 py-2 rounded-lg text-sm bg-transparent border border-slate-700 focus:border-indigo-500 outline-none"
              maxLength={500}
            />

            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirm(null)}
                      className="px-4 py-2 rounded-lg text-sm text-slate-300 border border-slate-700 hover:border-slate-500">
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button onClick={doMerge} disabled={merging}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                      style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                {merging ? <Loader2 size={15} className="animate-spin" /> : <GitMerge size={15} />}
                {ar ? 'تأكيد الدمج' : 'Confirm Merge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Group Card ─────────────────────────────────────────────────────────── */
function GroupCard({ group, ar, onMerge }: {
  group: DupGroup;
  ar: boolean;
  onMerge: (survivor: DupEmployee, merged: DupEmployee) => void;
}) {
  // Default survivor = record with the most recent attendance activity
  const defaultSurvivor = [...group.employees].sort((a, b) =>
    (b.attendanceTo ?? '').localeCompare(a.attendanceTo ?? ''))[0]?.id;
  const [survivorId, setSurvivorId] = useState<string>(defaultSurvivor);

  const survivor = group.employees.find((e) => e.id === survivorId)!;

  return (
    <div className="rounded-xl p-4"
         style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)' }}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Users size={16} className="text-indigo-400" />
        <span className="font-semibold capitalize">{group.employees[0]?.fullName}</span>
        <span className="text-xs px-2 py-0.5 rounded-full"
              style={group.sameFunction
                ? { background: 'rgba(16,185,129,.12)', color: '#10b981' }
                : { background: 'rgba(245,158,11,.12)', color: '#f59e0b' }}>
          {group.sameFunction
            ? (ar ? 'نفس الوظيفة' : 'Same function')
            : (ar ? 'وظائف مختلفة — تحقق جيداً' : 'Different functions — verify carefully')}
        </span>
        <span className="text-xs text-slate-500">
          {group.employees.length} {ar ? 'سجلات' : 'records'}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 text-start">
              <th className="text-start py-1.5 pe-3">{ar ? 'الباقي' : 'Survivor'}</th>
              <th className="text-start py-1.5 pe-3">{ar ? 'الرقم الوظيفي' : 'Emp No'}</th>
              <th className="text-start py-1.5 pe-3">{ar ? 'الوظيفة' : 'Function'}</th>
              <th className="text-start py-1.5 pe-3">{ar ? 'الحالة' : 'Status'}</th>
              <th className="text-start py-1.5 pe-3">
                <span className="inline-flex items-center gap-1"><Calendar size={11} />{ar ? 'الحضور' : 'Attendance'}</span>
              </th>
              <th className="text-start py-1.5 pe-3">
                <span className="inline-flex items-center gap-1"><FileText size={11} />{ar ? 'طلبات' : 'Requests'}</span>
              </th>
              <th className="text-start py-1.5 pe-3">
                <span className="inline-flex items-center gap-1"><UserCheck size={11} />{ar ? 'مستخدم' : 'User'}</span>
              </th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {group.employees.map((e) => {
              const isSurvivor = e.id === survivorId;
              return (
                <tr key={e.id} className="border-t border-slate-800/60">
                  <td className="py-2 pe-3">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name={`survivor-${group.normName}`}
                             checked={isSurvivor}
                             onChange={() => setSurvivorId(e.id)}
                             className="accent-indigo-500" />
                      {isSurvivor && <Crown size={13} className="text-emerald-400" />}
                    </label>
                  </td>
                  <td className="py-2 pe-3 font-mono">{e.employeeNo}</td>
                  <td className="py-2 pe-3 text-slate-300">{e.functionName ?? '—'}</td>
                  <td className="py-2 pe-3">
                    <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{ color: STATUS_COLOR[e.status] ?? '#94a3b8', background: 'rgba(255,255,255,.05)' }}>
                      {e.status}
                    </span>
                  </td>
                  <td className="py-2 pe-3 text-slate-300">
                    {e.attendanceCount}
                    <span className="text-xs text-slate-500 ms-1">
                      ({fmtDate(e.attendanceFrom)} → {fmtDate(e.attendanceTo)})
                    </span>
                  </td>
                  <td className="py-2 pe-3 text-slate-300">{e.requestCount}</td>
                  <td className="py-2 pe-3">{e.hasUser ? '✓' : '—'}</td>
                  <td className="py-2 text-end">
                    {!isSurvivor && (
                      <button
                        onClick={() => onMerge(survivor, e)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10 transition-colors"
                      >
                        <GitMerge size={13} />
                        {ar ? `دمج في #${survivor.employeeNo}` : `Merge into #${survivor.employeeNo}`}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
