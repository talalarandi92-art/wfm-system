import { useEffect, useState, useCallback, useRef } from 'react';
import { Users, Search, Download, Loader2, Home, Building2, AlertTriangle, UserX, Upload, BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

interface Row {
  employeeId: string; name: string; func: string; date: string;
  shiftStartMin: number | null; shiftEndMin: number | null;
  punchInMin: number | null; systemStartMin: number | null;
  systemLateMin: number; punchLateMin: number; effectiveLateMin: number;
  systemEarlyOutMin: number; punchEarlyOutMin: number; effectiveEarlyOutMin: number;
  otBeforeMin: number; otAfterMin: number; deductionApplies: boolean; compensationOwedMin: number;
  presence: 'office' | 'wfh' | 'anomaly' | 'absent'; flags: string[];
  otRoundedMin?: number; managerNote?: string;
  shiftCode?: string; shiftStart2Min?: number | null; shiftEnd2Min?: number | null; conformancePct?: number;
  punchOutMin?: number | null; systemEndMin?: number | null; systemStart2Min?: number | null; systemEnd2Min?: number | null; otPunchMin?: number; dayType?: string;
  permissionType?: string; permissionFrom?: string; permissionTo?: string; permissionStatus?: string;
  gender?: string; teamManager?: string; teamGroup?: string; attendanceCode?: string;
}
interface Resp { summary: any; total: number; rows: Row[]; unmapped: string[] }

const hhmm = (m: number | null | undefined) => { if (m == null) return '—'; const t = ((m % 1440) + 1440) % 1440; let h = Math.floor(t / 60); const mm = t % 60; const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return `${h}:${String(mm).padStart(2, '0')} ${ap}`; };
const mins = (m: number | null | undefined) => { if (!m || m <= 0) return '—'; const h = Math.floor(m / 60), mm = m % 60; return h ? `${h}h ${mm}m` : `${mm}m`; };

export default function RosterPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  const nav = useNavigate();
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [presence, setPresence] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('date_desc');
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Upload source files (Odoo/Ameyo/Sprinklr/schedule) → server saves them + re-ingests
  // the roster. Monthly files accumulate (e.g. add June Sprinklr without losing May).
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files?.length) return;
    const fd = new FormData(); Array.from(files).forEach(f => fd.append('files', f));
    setUploading(true);
    try {
      const r: any = await apiClient.post('/attendance-recon/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000 });
      alert((ar ? '✓ تم الرفع: ' : '✓ Uploaded: ') + (r.data.saved || []).map((s: any) => `${s.name} (${s.type})`).join('\n') + (ar ? `\nالروستر تحدّث: ${r.data.ingested} صف` : `\nRoster updated: ${r.data.ingested} rows`));
      load();
    } catch { alert(ar ? 'فشل الرفع' : 'Upload failed'); } finally { setUploading(false); if (e.target) e.target.value = ''; }
  };

  const card: React.CSSProperties = { background: dark ? '#0f1527' : '#fff', border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`, borderRadius: 16 };

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ limit: '800', sort });
    if (q) p.set('q', q); if (presence) p.set('presence', presence); if (from) p.set('from', from); if (to) p.set('to', to);
    // DB-backed endpoint: indexed query (sub-second), auto-ingests on first use. Scales to years.
    apiClient.get(`/attendance-recon/roster?${p}`).then((r: any) => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [q, presence, from, to, sort]);

  // Manager note: annotate why a day looked off (power cut, technical issue…). Persists in DB.
  const editNote = async (r: Row) => {
    const note = window.prompt(ar ? `ملاحظة المدير لـ ${r.name} (${r.date}):` : `Manager note for ${r.name} (${r.date}):`, r.managerNote || '');
    if (note === null) return;
    try {
      await apiClient.put('/attendance-recon/note', { employeeId: r.employeeId, date: r.date, note });
      setData(d => d ? { ...d, rows: d.rows.map(x => (x.employeeId === r.employeeId && x.date === r.date) ? { ...x, managerNote: note } : x) } : d);
    } catch { /* ignore */ }
  };
  useEffect(() => { const t = setTimeout(load, 350); return () => clearTimeout(t); }, [load]);

  const exportCSV = () => {
    if (!data) return;
    const h = ['Date', 'ID', 'Name', 'Function', 'Day Type', 'Shift Code', 'Shift Start', 'Shift End', 'Shift Start 2', 'Shift End 2', 'Punch In', 'Punch Out', 'System In', 'System Out', 'System Late', 'Punch Late', 'Effective Late', 'Early Out', 'OT System (min)', 'OT Punch (min)', 'OT Rounded (min)', 'Conformance %', 'Deduction', 'Comp Owed', 'Presence', 'Manager Note', 'Flags'];
    const rows = data.rows.map(r => [r.date, r.employeeId, r.name, r.func, r.dayType ?? '', r.shiftCode ?? '', hhmm(r.shiftStartMin), hhmm(r.shiftEndMin), hhmm(r.shiftStart2Min ?? null), hhmm(r.shiftEnd2Min ?? null), hhmm(r.punchInMin), hhmm(r.punchOutMin ?? null), hhmm(r.systemStartMin), hhmm(r.systemEndMin ?? null), r.systemLateMin, r.punchLateMin, r.effectiveLateMin, r.effectiveEarlyOutMin, r.otAfterMin, r.otPunchMin ?? 0, r.otRoundedMin ?? 0, r.conformancePct ?? '', r.deductionApplies ? 'Yes' : '', r.compensationOwedMin, r.presence, r.managerNote ?? '', r.flags.join(';')]);
    const csv = '﻿' + [h, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `roster_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };

  // HR attendance MATRIX (.xlsx): Update (past week actual) + Advance (next week planned)
  // sheets, employee rows × date columns. ref = end-date filter or today.
  const exportHR = async () => {
    const ref = to || from || new Date().toISOString().slice(0, 10);
    try {
      const r: any = await apiClient.get(`/attendance-recon/hr-matrix?ref=${ref}`, { responseType: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = `HR_attendance_${ref}.xlsx`; a.click();
    } catch { alert(ar ? 'فشل التصدير' : 'Export failed'); }
  };
  // Long-format HR weekly CSV (detailed, with system in/out, late/early, shift2, permission).
  const exportHRdetail = async () => {
    const f = from || new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
    const t = to || new Date().toISOString().slice(0, 10);
    try {
      const r: any = await apiClient.get(`/attendance-recon/hr-weekly?from=${f}&to=${t}`);
      const rows: any[] = r.data?.rows || []; if (!rows.length) { alert(ar ? 'لا بيانات للفترة' : 'No data'); return; }
      const h = Object.keys(rows[0]);
      const csv = '﻿' + [h, ...rows.map(x => h.map(k => x[k]))].map(rr => rr.map((c: any) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `HR_detail_${f}_${t}.csv`; a.click();
    } catch { alert(ar ? 'فشل التصدير' : 'Export failed'); }
  };

  const S = data?.summary;
  const Metric = ({ icon: Icon, label, value, color }: any) => (
    <div style={{ ...card, padding: '12px 14px' }} className="flex items-center gap-2.5">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: color + '1a' }}><Icon size={16} style={{ color }} /></div>
      <div><p className="text-[10px] text-slate-500">{label}</p><p className="text-lg font-bold" style={{ color: dark ? '#fff' : '#0f172a' }}>{value ?? '—'}</p></div>
    </div>
  );
  const presBadge = (p: string) => {
    const map: any = { office: ['#22c55e', ar ? 'مكتب' : 'Office'], wfh: ['#0ea5e9', 'WFH'], anomaly: ['#f59e0b', ar ? 'شاذ' : 'Anomaly'], absent: ['#ef4444', ar ? 'غياب' : 'Absent'], unconfirmed: ['#94a3b8', ar ? 'غير مؤكد' : 'Unconfirmed'] };
    const [c, t] = map[p] || ['#888', p];
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: c + '22', color: c }}>{t}</span>;
  };

  return (
    <div className="page-enter">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#6366f1,#a855f7)' }}><Users size={22} className="text-white" /></div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: dark ? '#fff' : '#0f172a' }}>{ar ? 'Roster — الورديات والتسوية' : 'Roster — Shifts & Reconciliation'}</h1>
            <p className="text-xs text-slate-500">{ar ? 'مدموج من Odoo (بصمة) + Ameyo + Sprinklr مقابل الجدول — تأخير/خروج/WFH/OT محسوبة آلياً' : 'Odoo punch + Ameyo + Sprinklr merged vs schedule — late/early/WFH/OT computed automatically'}</p>
          </div>
        </div>
        {<div className="flex items-center gap-2">
          <button onClick={() => nav('/roster-dashboard')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white" style={{ background: 'linear-gradient(135deg,#0ea5e9,#6366f1)' }} title={ar ? 'لوحة تحليل عميقة' : 'Deep analytics dashboard'}><BarChart3 size={14} /> {ar ? 'لوحة التحليل' : 'Dashboard'}</button>
          <input ref={fileRef} type="file" multiple accept=".xlsx,.xls,.csv" onChange={onUpload} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)' }} title={ar ? 'ارفع ملفات Odoo/Ameyo/Sprinklr/الجدول — يتعبّى الروستر تلقائياً' : 'Upload Odoo/Ameyo/Sprinklr/schedule — roster auto-updates'}>
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {uploading ? (ar ? 'جاري الرفع…' : 'Uploading…') : (ar ? 'رفع ملفات' : 'Upload files')}
          </button>
          <button onClick={exportHR} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white" style={{ background: 'linear-gradient(135deg,#6366f1,#a855f7)' }} title={ar ? 'ماتريكس: Update (ماضي) + Advance (جاي)' : 'Matrix: Update + Advance'}><Download size={14} /> {ar ? 'HR ماتريكس' : 'HR Matrix'}</button>
          <button onClick={exportHRdetail} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-200" style={card}><Download size={14} /> {ar ? 'HR تفصيلي' : 'HR Detail'}</button>
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-200" style={card}><Download size={14} /> {ar ? 'تصدير' : 'Export'}</button>
        </div>}
      </div>

      {S && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 mb-4">
          <Metric icon={Users} label={ar ? 'أيام' : 'Days'} value={S.totalDays?.toLocaleString()} color="#6366f1" />
          <Metric icon={Building2} label={ar ? 'مكتب' : 'Office'} value={S.office?.toLocaleString()} color="#22c55e" />
          <Metric icon={Home} label="WFH" value={S.wfh?.toLocaleString()} color="#0ea5e9" />
          <Metric icon={AlertTriangle} label={ar ? 'شاذ' : 'Anomaly'} value={S.anomaly} color="#f59e0b" />
          <Metric icon={UserX} label={ar ? 'غياب' : 'Absent'} value={S.absent} color="#ef4444" />
          <Metric icon={AlertTriangle} label={ar ? 'أيام تأخير' : 'Late days'} value={S.lateDays} color="#f97316" />
          <Metric icon={AlertTriangle} label={ar ? 'أيام خصم' : 'Deduction'} value={S.deductionDays} color="#ec4899" />
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg flex-1 min-w-[200px]" style={card}>
          <Search size={14} className="text-slate-500" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={ar ? 'بحث بالاسم أو الـID أو الإيميل…' : 'Search name / ID / email…'} className="bg-transparent text-sm outline-none flex-1" style={{ color: dark ? '#fff' : '#0f172a' }} />
        </div>
        <select value={presence} onChange={e => setPresence(e.target.value)} className="px-3 py-2 rounded-lg text-xs outline-none cursor-pointer" style={{ ...card, color: dark ? '#fff' : '#0f172a' }}>
          <option value="" style={{ background: '#0f1527' }}>{ar ? 'كل الحالات' : 'All presence'}</option>
          <option value="office" style={{ background: '#0f1527' }}>{ar ? 'مكتب' : 'Office'}</option>
          <option value="wfh" style={{ background: '#0f1527' }}>WFH</option>
          <option value="anomaly" style={{ background: '#0f1527' }}>{ar ? 'شاذ' : 'Anomaly'}</option>
          <option value="absent" style={{ background: '#0f1527' }}>{ar ? 'غياب' : 'Absent'}</option>
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2.5 py-2 rounded-lg text-xs outline-none" style={{ ...card, color: dark ? '#fff' : '#0f172a' }} />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2.5 py-2 rounded-lg text-xs outline-none" style={{ ...card, color: dark ? '#fff' : '#0f172a' }} />
        <select value={sort} onChange={e => setSort(e.target.value)} className="px-3 py-2 rounded-lg text-xs outline-none cursor-pointer" style={{ ...card, color: dark ? '#fff' : '#0f172a' }}>
          <option value="date_desc" style={{ background: '#0f1527' }}>{ar ? 'التاريخ: الأحدث أولاً' : 'Date: Newest first'}</option>
          <option value="date_asc" style={{ background: '#0f1527' }}>{ar ? 'التاريخ: الأقدم أولاً' : 'Date: Oldest first'}</option>
          <option value="name_asc" style={{ background: '#0f1527' }}>{ar ? 'الاسم: A → Z' : 'Name: A → Z'}</option>
          <option value="name_desc" style={{ background: '#0f1527' }}>{ar ? 'الاسم: Z → A' : 'Name: Z → A'}</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={26} className="animate-spin text-indigo-400" /></div>
      ) : !data ? (
        <div className="text-center py-16 text-slate-500 text-sm">{ar ? 'تعذّر التحميل' : 'Failed to load'}</div>
      ) : (
        <>
          <p className="text-[11px] text-slate-500 mb-2">{ar ? `عرض ${data.rows.length} من ${data.total.toLocaleString()} صف` : `Showing ${data.rows.length} of ${data.total.toLocaleString()}`}</p>
          <div className="rounded-2xl overflow-x-auto" style={card}>
            <table className="w-full text-xs" style={{ minWidth: 1000 }}>
              <thead>
                <tr className="text-slate-500 text-[10px] uppercase" style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
                  {[ar ? 'التاريخ' : 'Date', ar ? 'الموظف' : 'Agent', ar ? 'القسم' : 'Function', ar ? 'الجنس' : 'Gender', ar ? 'الفريق' : 'Team', ar ? 'المدير' : 'Team Mgr', ar ? 'نوع اليوم' : 'Day type', ar ? 'الشفت' : 'Shift', ar ? 'بصمة (د/خ)' : 'Punch (in/out)', ar ? 'سيستم (د/خ)' : 'System (in/out)', ar ? 'تأخير بصمة' : 'Punch late', ar ? 'تأخير سيستم' : 'Sys late', ar ? 'فعلي' : 'Effective', ar ? 'خروج سيستم' : 'Early sys', ar ? 'خروج بصمة' : 'Early punch', ar ? 'خروج فعلي' : 'Early eff', ar ? 'استئذان' : 'Permission', ar ? 'OT سيستم' : 'OT (sys)', ar ? 'OT بصمة' : 'OT (punch)', ar ? 'التوافق' : 'Conformance', ar ? 'الموقع' : 'Location', ar ? 'ملاحظة المدير' : 'Note'].map(h => <th key={h} className="px-2.5 py-2.5 text-center first:text-start">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} className="border-t hover:bg-white/[0.03]" style={{ borderColor: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}>
                    <td className="px-2.5 py-2 text-slate-400 whitespace-nowrap text-start">{r.date}</td>
                    <td className="px-2.5 py-2 text-start"><p className="font-semibold whitespace-nowrap" style={{ color: dark ? '#fff' : '#0f172a' }}>{r.name}</p><p className="text-[9px] text-slate-600">{r.employeeId}</p></td>
                    <td className="px-2.5 py-2 text-center text-slate-400 text-[10px] whitespace-nowrap">{r.func}</td>
                    <td className="px-2.5 py-2 text-center text-[10px]" style={{ color: r.gender === 'Female' ? '#f472b6' : '#60a5fa' }}>{r.gender ? (ar ? (r.gender === 'Female' ? 'أنثى' : 'ذكر') : r.gender) : '—'}</td>
                    <td className="px-2.5 py-2 text-center text-slate-400 text-[10px] whitespace-nowrap">{r.teamGroup || '—'}</td>
                    <td className="px-2.5 py-2 text-center text-slate-400 text-[10px] whitespace-nowrap">{r.teamManager || '—'}</td>
                    <td className="px-2.5 py-2 text-center text-[10px] whitespace-nowrap" style={{ color: r.dayType === 'Normal' ? '#64748b' : '#a78bfa' }}>{r.dayType || '—'}</td>
                    <td className="px-2.5 py-2 text-center text-slate-400 whitespace-nowrap">
                      {(r.attendanceCode || r.shiftCode) && <span className="font-bold text-indigo-300">{r.attendanceCode || r.shiftCode} </span>}{hhmm(r.shiftStartMin)}–{hhmm(r.shiftEndMin)}
                      {r.shiftStart2Min != null && <span className="block text-[9px] text-slate-500">+ {hhmm(r.shiftStart2Min)}–{hhmm(r.shiftEnd2Min)}</span>}
                    </td>
                    <td className="px-2.5 py-2 text-center text-slate-300 whitespace-nowrap text-[10px]">{hhmm(r.punchInMin)} <span className="text-slate-600">→</span> {hhmm(r.punchOutMin ?? null)}</td>
                    <td className="px-2.5 py-2 text-center text-slate-300 whitespace-nowrap text-[10px]">{r.flags?.includes('system_incomplete') ? <span className="text-slate-500" title={ar ? 'داتا سيستم ناقصة (Sprinklr غير مرفوع لهالشهر)' : 'incomplete system data (Sprinklr not uploaded for this month)'}>⚠ {ar ? 'ناقص' : 'incomplete'}</span> : <>{hhmm(r.systemStartMin)} <span className="text-slate-600">→</span> {hhmm(r.systemEndMin ?? null)}{r.systemStart2Min != null && <span className="block text-[9px] text-amber-400/70">2: {hhmm(r.systemStart2Min)}→{hhmm(r.systemEnd2Min ?? null)}</span>}</>}</td>
                    <td className="px-2.5 py-2 text-center" style={{ color: r.punchLateMin > 20 ? '#ef4444' : r.punchLateMin > 0 ? '#f59e0b' : '#475569' }}>{mins(r.punchLateMin)}</td>
                    <td className="px-2.5 py-2 text-center" style={{ color: r.systemLateMin > 20 ? '#ef4444' : r.systemLateMin > 0 ? '#f59e0b' : '#475569' }}>{mins(r.systemLateMin)}</td>
                    <td className="px-2.5 py-2 text-center font-bold" style={{ color: r.deductionApplies ? '#ef4444' : r.effectiveLateMin > 0 ? '#f59e0b' : '#475569' }}>{mins(r.effectiveLateMin)}{r.deductionApplies && <span className="text-[8px] text-red-400"> {ar ? 'خصم' : 'deduction'}</span>}</td>
                    <td className="px-2.5 py-2 text-center text-slate-400">{r.flags?.includes('system_incomplete') ? '—' : mins(r.systemEarlyOutMin)}</td>
                    <td className="px-2.5 py-2 text-center text-slate-400">{mins(r.punchEarlyOutMin)}</td>
                    <td className="px-2.5 py-2 text-center text-orange-300 font-semibold">{mins(r.effectiveEarlyOutMin)}</td>
                    <td className="px-2.5 py-2 text-center whitespace-nowrap text-[10px]">{r.permissionType ? <><span className="font-semibold text-emerald-300">{r.permissionType}</span>{r.permissionStatus && <span className="ms-1" style={{ color: r.permissionStatus === 'Approved' ? '#22c55e' : r.permissionStatus === 'Refused' ? '#ef4444' : '#f59e0b' }}>{r.permissionStatus === 'Approved' ? '✓' : r.permissionStatus === 'Refused' ? '✗' : '⏳'}</span>}{r.permissionFrom && <span className="block text-[9px] text-slate-500">{r.permissionFrom}–{r.permissionTo}</span>}</> : '—'}</td>
                    <td className="px-2.5 py-2 text-center text-cyan-300 whitespace-nowrap">{mins((r as any).otRoundedMin || r.otAfterMin)}</td>
                    <td className="px-2.5 py-2 text-center text-cyan-200/70 whitespace-nowrap">{mins(r.otPunchMin || 0)}</td>
                    <td className="px-2.5 py-2 text-center" style={{ color: r.flags?.includes('system_incomplete') ? '#475569' : r.conformancePct == null ? '#475569' : r.conformancePct >= 90 ? '#22c55e' : r.conformancePct >= 70 ? '#f59e0b' : '#ef4444' }}>{r.flags?.includes('system_incomplete') ? '—' : r.conformancePct == null ? '—' : r.conformancePct + '%'}</td>
                    <td className="px-2.5 py-2 text-center">{r.dayType === 'Sick Leave' ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: '#a855f733', color: '#c084fc' }}>{ar ? 'مرضي' : 'Sick'}</span> : presBadge(r.presence)}</td>
                    <td className="px-2.5 py-2 text-center max-w-[180px]">
                      <button onClick={() => editNote(r)} title={ar ? 'اكتب ملاحظة (عطل/قطع كهرباء/مشكلة فنية…)' : 'Add a note (outage / power cut / technical issue…)'}
                        className="text-[11px] truncate max-w-[170px] inline-block align-middle"
                        style={{ color: (r as any).managerNote ? '#f59e0b' : '#475569' }}>
                        {(r as any).managerNote ? `📝 ${(r as any).managerNote}` : (ar ? '+ ملاحظة' : '+ note')}
                      </button>
                    </td>
                  </tr>
                ))}
                {data.rows.length === 0 && <tr><td colSpan={22} className="text-center py-10 text-slate-600">{ar ? 'لا نتائج' : 'No results'}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
