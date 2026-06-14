import { useState, useEffect, useCallback } from 'react';
import {
  FileText, Download, Calendar, Users, Clock, Zap,
  Loader2, ChevronRight, BarChart2, ArrowUpDown,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { card as cardStyle, tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface Meta {
  employeeCount: number; attendanceRecords: number;
  dateFrom: string; dateTo: string;
}
interface AttRow {
  date: string; employeeNo: string; employeeName: string; function: string; gender: string;
  marker: string; isWfh: boolean;
  scheduledStart: string | null; scheduledEnd: string | null;
  punchIn: string | null; punchOut: string | null;
  lateMinutes: number | null; missingPunch: boolean; otMinutes: number | null;
}
interface LateRow {
  rank: number; employeeNo: string; employeeName: string; fullName?: string; functionName: string;
  lateCount: number; totalLateMin: number; totalLateMinutes?: number; avgLateMin: number; avgLateMinutes?: number;
}
interface OtRow {
  rank: number; employeeNo: string; employeeName: string; fullName?: string; functionName: string;
  otCount?: number; otDays?: number; totalOtMin: number; totalOtMinutes?: number; totalOtHours?: number;
}

type Report = 'home' | 'attendance' | 'late' | 'overtime' | 'requests' | 'crossSkill'
  | 'requestsDetailed' | 'permissions' | 'breaks' | 'audit' | 'overtimeDetailed';

// Detailed reports rendered with a generic, schema-agnostic table.
// endpoint + optional `view` query + which response field holds the rows.
const GENERIC: Record<string, { endpoint: string; view?: string; field: string; sheet: string }> = {
  requestsDetailed: { endpoint: '/reports/requests-detailed', field: 'data',     sheet: 'Requests' },
  permissions:      { endpoint: '/reports/permissions',       field: 'detail',   sheet: 'Permissions' },
  breaks:           { endpoint: '/reports/breaks',            field: 'detail',   sheet: 'Breaks' },
  audit:            { endpoint: '/reports/audit',             field: 'detail',   sheet: 'Audit' },
  overtimeDetailed: { endpoint: '/reports/overtime-detailed', view: 'ranking', field: 'ranking', sheet: 'Overtime' },
};

interface ReqRow {
  submittedAt: string; employeeNo: string; employeeName: string; function: string;
  type: string; typeCode: string; status: string; urgent: boolean; slaDue: string; reason: string;
}
interface CrossSkillRow {
  startAt: string; endAt: string; employeeNo: string; employeeName: string;
  fromFunction: string; toFunction: string; status: string; requestedBy: string; approvedBy: string; reason: string;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
// Download any report endpoint as a file (csv or xlsx) honouring the blob type.
const downloadFile = async (url: string, params: any, filename: string, format: 'csv' | 'xlsx') => {
  const res = await apiClient.get(url, { params: { ...params, format }, responseType: 'blob' });
  const type = format === 'xlsx'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv;charset=utf-8;';
  const blob = new Blob([res.data], { type });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = href; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(href);
};

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function ReportsPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [active, setActive]   = useState<Report>('home');
  const [meta, setMeta]       = useState<Meta | null>(null);
  const [from, setFrom]       = useState('');
  const [to, setTo]           = useState('');
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [dlLoading, setDl]    = useState(false);

  const [attData, setAtt] = useState<AttRow[]>([]);
  const [lateData, setLate] = useState<LateRow[]>([]);
  const [otData, setOt]   = useState<OtRow[]>([]);
  const [reqData, setReq] = useState<ReqRow[]>([]);
  const [reqBreakdown, setReqBreakdown] = useState<Record<string, number>>({});
  const [csData, setCs] = useState<CrossSkillRow[]>([]);
  const [genRows, setGenRows] = useState<any[]>([]);   // generic detailed-report rows
  const [total, setTotal] = useState(0);
  const [wbLoading, setWb] = useState(false);

  const limit = 30;

  useEffect(() => {
    apiClient.get('/reports/meta').then(r => setMeta(r.data));
  }, []);

  const run = useCallback(async () => {
    if (active === 'home') return;
    setLoading(true);
    const params: any = { page, limit };
    if (from) params.from = from;
    if (to)   params.to   = to;
    try {
      if (active === 'attendance') {
        const { data } = await apiClient.get('/reports/attendance', { params });
        const rows = data.data ?? data.items ?? data;
        setAtt(Array.isArray(rows) ? rows : []); setTotal(data.total ?? (Array.isArray(rows) ? rows.length : 0));
      } else if (active === 'late') {
        const { data } = await apiClient.get('/reports/late', { params });
        const rows = data.data ?? data.items ?? data;
        setLate(Array.isArray(rows) ? rows : []); setTotal(Array.isArray(rows) ? rows.length : 0);
      } else if (active === 'overtime') {
        const { data } = await apiClient.get('/reports/overtime', { params });
        const rows = data.data ?? data.items ?? data;
        setOt(Array.isArray(rows) ? rows : []); setTotal(Array.isArray(rows) ? rows.length : 0);
      } else if (active === 'requests') {
        const { data } = await apiClient.get('/reports/requests', { params });
        setReq(Array.isArray(data.data) ? data.data : []);
        setReqBreakdown(data.statusBreakdown ?? {});
        setTotal(data.total ?? 0);
      } else if (active === 'crossSkill') {
        const { data } = await apiClient.get('/reports/cross-skill', { params });
        setCs(Array.isArray(data.data) ? data.data : []);
        setTotal(data.total ?? 0);
      } else if (GENERIC[active]) {
        const g = GENERIC[active];
        const { data } = await apiClient.get(g.endpoint, { params: { ...params, ...(g.view ? { view: g.view } : {}) } });
        const rows = data[g.field] ?? data.data ?? [];
        setGenRows(Array.isArray(rows) ? rows : []);
        setTotal(Array.isArray(rows) ? rows.length : 0);
      }
    } catch {}
    setLoading(false);
  }, [active, page, from, to]);

  useEffect(() => { if (active !== 'home') run(); }, [run]);

  const handleDownload = async (format: 'csv' | 'xlsx' = 'xlsx') => {
    setDl(true);
    const params: any = {};
    if (from) params.from = from;
    if (to)   params.to   = to;
    const endpointMap: Record<string, string> = {
      attendance: '/reports/attendance', late: '/reports/late', overtime: '/reports/overtime',
      requests: '/reports/requests', crossSkill: '/reports/cross-skill',
    };
    let endpoint = endpointMap[active];
    let extra: any = {};
    if (GENERIC[active]) { endpoint = GENERIC[active].endpoint; if (GENERIC[active].view) extra.view = GENERIC[active].view; }
    const filename = `${active}_report.${format}`;
    try { await downloadFile(endpoint, { ...params, ...extra }, filename, format); } catch {}
    setDl(false);
  };

  // Bundle EVERY report into one multi-sheet Excel workbook.
  const handleWorkbook = async () => {
    setWb(true);
    const params: any = {};
    if (from) params.from = from;
    if (to)   params.to   = to;
    try { await downloadFile('/reports/workbook', params, 'WFM_full_report.xlsx', 'xlsx'); } catch {}
    setWb(false);
  };

  const rateColor = (r: number) => r >= 90 ? '#34d399' : r >= 75 ? '#fbbf24' : '#f87171';

  const REPORTS: { id: Report; labelAr: string; labelEn: string; icon: any; color: string; descAr: string; descEn: string }[] = [
    { id: 'attendance', labelAr: 'تقرير الحضور',    labelEn: 'Attendance Report',  icon: Users,     color: '#34d399', descAr: 'حضور وغياب وتأخر لكل موظف', descEn: 'Per-employee presence, absence & late' },
    { id: 'late',       labelAr: 'ترتيب التأخر',    labelEn: 'Late Ranking',        icon: Clock,     color: '#fb923c', descAr: 'أكثر الموظفين تأخراً', descEn: 'Most-frequent late arrivals' },
    { id: 'overtime',   labelAr: 'ترتيب الإضافي',   labelEn: 'Overtime Ranking',    icon: Zap,       color: '#22d3ee', descAr: 'إجمالي ساعات الإضافي', descEn: 'Total overtime hours per employee' },
    { id: 'requests',   labelAr: 'تقرير الطلبات',   labelEn: 'Requests Report',     icon: FileText,  color: '#a78bfa', descAr: 'الطلبات والموافقات حسب النوع والحالة', descEn: 'Requests & approvals by type and status' },
    { id: 'requestsDetailed', labelAr: 'الطلبات — تفصيلي', labelEn: 'Requests — Detailed', icon: FileText, color: '#c084fc', descAr: 'سلسلة الموافقة الكاملة: مين وافق/رفض ومتى + SLA + السبب', descEn: 'Full approval chain: who approved/rejected, when, SLA & reason' },
    { id: 'permissions', labelAr: 'تقرير الاستئذان', labelEn: 'Permissions Report', icon: Clock, color: '#38bdf8', descAr: 'الساعات والأنواع (تأخير/خروج مبكر) والانترفلز', descEn: 'Hours, types (late-in/early-out) & interval breakdown' },
    { id: 'breaks',     labelAr: 'تقرير البريكات',  labelEn: 'Breaks Report',       icon: Clock,     color: '#2dd4bf', descAr: 'كم مرة والمدة والشفت ومين وافق', descEn: 'Count, duration, shift window & approver' },
    { id: 'overtimeDetailed', labelAr: 'الإضافي — تفصيلي', labelEn: 'Overtime — Detailed', icon: Zap, color: '#22d3ee', descAr: 'قبل/بعد الشفت + النسبة من ساعات الدوام', descEn: 'Before/after shift + % of working hours' },
    { id: 'audit',      labelAr: 'سجل التدقيق',     labelEn: 'Audit Trail',         icon: BarChart2, color: '#f472b6', descAr: 'مين عدّل، متى، وليش — لكل عملية', descEn: 'Who changed what, when & why' },
    { id: 'crossSkill', labelAr: 'تقرير Cross-Skill', labelEn: 'Cross-Skill Report', icon: Zap,       color: '#fb923c', descAr: 'تغطية الفجوات: من غطّى أي قناة ومتى', descEn: 'Coverage dispatch: who covered which channel & when' },
  ];

  const REQ_STATUS_META: Record<string, { ar: string; en: string; color: string }> = {
    pending:      { ar: 'قيد الموافقة', en: 'Pending',  color: '#fbbf24' },
    peer_pending: { ar: 'بانتظار الزميل', en: 'Peer',    color: '#a78bfa' },
    approved:     { ar: 'موافق', en: 'Approved',         color: '#34d399' },
    rejected:     { ar: 'مرفوض', en: 'Rejected',         color: '#f87171' },
    cancelled:    { ar: 'ملغي', en: 'Cancelled',         color: '#64748b' },
  };

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.22)' }}>
            <FileText size={18} style={{ color: '#34d399' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>
              {ar ? 'التقارير والتصدير' : 'Reports & Export'}
            </h1>
            {meta && (
              <p className="text-xs" style={{ color: tsColor(dark) }}>
                {meta.employeeCount ?? 0} {ar ? 'موظف' : 'emp'} · {(meta.attendanceRecords ?? 0).toLocaleString()} {ar ? 'سجل' : 'records'}
                {meta.dateFrom && ` · ${new Date(meta.dateFrom).toLocaleDateString()} → ${new Date(meta.dateTo).toLocaleDateString()}`}
              </p>
            )}
          </div>
        </div>
        {active !== 'home' && (
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }}
              className="text-xs rounded-xl px-3 py-1.5 outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0' }} />
            <span className="text-xs" style={{ color: '#475569' }}>→</span>
            <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }}
              className="text-xs rounded-xl px-3 py-1.5 outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0' }} />
            <button onClick={() => handleDownload('xlsx')} disabled={dlLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-60 transition-opacity hover:opacity-80"
              style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.35)', color: '#22c55e' }}>
              {dlLoading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              Excel
            </button>
            <button onClick={() => handleDownload('csv')} disabled={dlLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium disabled:opacity-60 transition-opacity hover:opacity-80"
              style={{ background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.25)', color: '#94a3b8' }}>
              CSV
            </button>
          </div>
        )}
      </div>

      {/* Full workbook download — always visible */}
      <div className="mb-5">
        <button onClick={handleWorkbook} disabled={wbLoading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold disabled:opacity-60 transition-all hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.18), rgba(6,182,212,0.12))', border: '1px solid rgba(34,197,94,0.35)', color: '#22c55e' }}>
          {wbLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {ar ? 'تحميل تقرير Excel شامل (كل التقارير في ملف واحد)' : 'Download Full Excel Workbook (all reports in one file)'}
        </button>
      </div>

      {/* Breadcrumb */}
      {active !== 'home' && (
        <div className="flex items-center gap-1.5 mb-5 text-xs">
          <button onClick={() => setActive('home')} style={{ color: '#818cf8' }}>{ar ? 'التقارير' : 'Reports'}</button>
          <ChevronRight size={11} style={{ color: '#334155' }} />
          <span style={{ color: '#e2e8f0' }}>
            {REPORTS.find(r => r.id === active)?.[ar ? 'labelAr' : 'labelEn']}
          </span>
        </div>
      )}

      {/* Home: report cards */}
      {active === 'home' && (
        <div className="grid gap-4 sm:grid-cols-3">
          {REPORTS.map(r => (
            <button key={r.id} onClick={() => { setActive(r.id); setPage(1); }}
              className="text-start group transition-all hover:scale-[1.01]"
              style={{ ...cardStyle(dark), padding: 20, border: `1px solid ${r.color}25` }}>
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"
                style={{ background: `${r.color}15` }}>
                <r.icon size={18} style={{ color: r.color }} />
              </div>
              <div className="text-sm font-bold mb-1" style={{ color: tp(dark) }}>
                {ar ? r.labelAr : r.labelEn}
              </div>
              <div className="text-xs" style={{ color: tsColor(dark) }}>
                {ar ? r.descAr : r.descEn}
              </div>
              <div className="mt-4 flex items-center gap-1 text-xs" style={{ color: r.color }}>
                <span>{ar ? 'عرض التقرير' : 'View report'}</span>
                <ChevronRight size={11} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {active !== 'home' && loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} />
        </div>
      )}

      {/* ── Attendance table ──────────────────────────────────────────── */}
      {active === 'attendance' && !loading && (
        <TableShell
          head={[
            ar ? 'التاريخ' : 'Date', ar ? 'الموظف' : 'Employee',
            ar ? 'الوظيفة' : 'Function', ar ? 'الحالة' : 'Status',
            ar ? 'الدخول' : 'In', ar ? 'الخروج' : 'Out',
            ar ? 'تأخر(د)' : 'Late(m)', ar ? 'بصمة ناقصة' : 'No Punch',
            ar ? 'إضافي(د)' : 'OT(m)',
          ]}>
          {attData.map((e, i) => {
            const markerColor: Record<string, string> = {
              present: '#34d399', absent: '#f87171', off: '#475569',
              leave: '#a78bfa', holiday: '#22d3ee', sick: '#fbbf24',
            };
            const mc = markerColor[e.marker] ?? '#64748b';
            return (
              <tr key={i} className="hover:bg-white/[0.015]"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <Td><span className="font-mono text-[10px]">{typeof e.date === 'string' ? e.date.slice(0,10) : new Date(e.date).toISOString().slice(0,10)}</span></Td>
                <Td>
                  <div className="text-xs font-medium" style={{ color: '#e2e8f0' }}>{e.employeeName}</div>
                  <div className="text-[10px]" style={{ color: '#475569' }}>#{e.employeeNo}</div>
                </Td>
                <Td><span className="text-[11px]" style={{ color: '#64748b' }}>{e.function}</span></Td>
                <Td>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${mc}18`, color: mc }}>
                    {e.isWfh ? 'WFH' : e.marker}
                  </span>
                </Td>
                <Td>{e.punchIn ?? '—'}</Td>
                <Td>{e.punchOut ?? '—'}</Td>
                <Td color={e.lateMinutes ? '#fb923c' : undefined}>{e.lateMinutes ?? '—'}</Td>
                <Td color={e.missingPunch ? '#fbbf24' : undefined}>{e.missingPunch ? '!' : '—'}</Td>
                <Td color={e.otMinutes ? '#22d3ee' : undefined}>{e.otMinutes ?? '—'}</Td>
              </tr>
            );
          })}
        </TableShell>
      )}

      {/* ── Late table ──────────────────────────────────────────────── */}
      {active === 'late' && !loading && (
        <TableShell head={[ar ? '#' : '#', ar ? 'الموظف' : 'Employee', ar ? 'الوظيفة' : 'Function', ar ? 'مرات التأخر' : 'Late count', ar ? 'إجمالي الدقائق' : 'Total min', ar ? 'متوسط الدقائق' : 'Avg min']}>
          {lateData.map((e, i) => (
            <tr key={i} className="hover:bg-white/[0.015]" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <Td><span style={{ color: e.rank <= 3 ? '#fbbf24' : '#475569' }} className="font-bold">{e.rank}</span></Td>
              <Td>
                <div className="text-xs font-medium" style={{ color: '#e2e8f0' }}>{e.employeeName ?? e.fullName}</div>
                <div className="text-[10px]" style={{ color: '#475569' }}>#{e.employeeNo}</div>
              </Td>
              <Td><span className="text-[11px]" style={{ color: '#64748b' }}>{e.functionName}</span></Td>
              <Td color="#fb923c"><span className="font-bold">{e.lateCount}</span></Td>
              <Td color="#fb923c">{e.totalLateMin ?? e.totalLateMinutes}</Td>
              <Td color="#fbbf24">{e.avgLateMin ?? e.avgLateMinutes}</Td>
            </tr>
          ))}
        </TableShell>
      )}

      {/* ── OT table ────────────────────────────────────────────────── */}
      {active === 'overtime' && !loading && (
        <TableShell head={[ar ? '#' : '#', ar ? 'الموظف' : 'Employee', ar ? 'الوظيفة' : 'Function', ar ? 'مرات الإضافي' : 'OT count', ar ? 'إجمالي الدقائق' : 'Total min', ar ? 'إجمالي الساعات' : 'Total hours']}>
          {otData.map((e, i) => (
            <tr key={i} className="hover:bg-white/[0.015]" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <Td><span style={{ color: e.rank <= 3 ? '#fbbf24' : '#475569' }} className="font-bold">{e.rank}</span></Td>
              <Td>
                <div className="text-xs font-medium" style={{ color: '#e2e8f0' }}>{e.employeeName ?? e.fullName}</div>
                <div className="text-[10px]" style={{ color: '#475569' }}>#{e.employeeNo}</div>
              </Td>
              <Td><span className="text-[11px]" style={{ color: '#64748b' }}>{e.functionName}</span></Td>
              <Td color="#22d3ee">{e.otCount ?? e.otDays}</Td>
              <Td color="#22d3ee">{e.totalOtMin ?? e.totalOtMinutes}</Td>
              <Td><span className="font-bold" style={{ color: '#22d3ee' }}>{e.totalOtHours ?? Math.round((e.totalOtMin ?? e.totalOtMinutes ?? 0) / 60)}h</span></Td>
            </tr>
          ))}
        </TableShell>
      )}

      {/* ── Requests table ──────────────────────────────────────────── */}
      {active === 'requests' && !loading && (
        <div>
          {/* status breakdown chips */}
          {Object.keys(reqBreakdown).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {Object.entries(reqBreakdown).map(([st, cnt]) => {
                const m = REQ_STATUS_META[st] ?? { ar: st, en: st, color: '#64748b' };
                return (
                  <span key={st} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold"
                    style={{ background: `${m.color}22`, color: m.color }}>
                    {ar ? m.ar : m.en}: {cnt}
                  </span>
                );
              })}
            </div>
          )}
          <TableShell head={[ar ? 'التاريخ' : 'Submitted', ar ? 'الموظف' : 'Employee', ar ? 'الوظيفة' : 'Function', ar ? 'النوع' : 'Type', ar ? 'الحالة' : 'Status']}>
            {reqData.map((e, i) => {
              const m = REQ_STATUS_META[e.status] ?? { ar: e.status, en: e.status, color: '#64748b' };
              return (
                <tr key={i} className="hover:bg-white/[0.015]" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <Td><span className="text-[11px]" style={{ color: '#94a3b8' }}>{e.submittedAt ? new Date(e.submittedAt).toLocaleDateString(ar ? 'ar-KW' : 'en-GB', { day: '2-digit', month: 'short' }) : '—'}</span>{e.urgent && <span className="ms-1 text-[9px] text-red-400">●</span>}</Td>
                  <Td>
                    <div className="text-xs font-medium" style={{ color: '#e2e8f0' }}>{e.employeeName || '—'}</div>
                    {e.employeeNo && <div className="text-[10px]" style={{ color: '#475569' }}>#{e.employeeNo}</div>}
                  </Td>
                  <Td><span className="text-[11px]" style={{ color: '#64748b' }}>{e.function || '—'}</span></Td>
                  <Td><span className="text-[11px]" style={{ color: '#cbd5e1' }}>{e.type}</span></Td>
                  <Td><span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ background: `${m.color}22`, color: m.color }}>{ar ? m.ar : m.en}</span></Td>
                </tr>
              );
            })}
          </TableShell>
        </div>
      )}

      {/* ── Cross-skill table ───────────────────────────────────────── */}
      {active === 'crossSkill' && !loading && (
        <TableShell head={[ar ? 'الوقت' : 'When', ar ? 'الموظف' : 'Employee', ar ? 'من' : 'From', ar ? 'إلى' : 'To', ar ? 'الحالة' : 'Status', ar ? 'طلب من' : 'Requested by']}>
          {csData.map((e, i) => (
            <tr key={i} className="hover:bg-white/[0.015]" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <Td><span className="text-[11px]" style={{ color: '#94a3b8' }}>{e.startAt ? new Date(e.startAt).toLocaleString(ar ? 'ar-KW' : 'en-GB', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'}</span></Td>
              <Td><div className="text-xs font-medium" style={{ color: '#e2e8f0' }}>{e.employeeName || '—'}</div>{e.employeeNo && <div className="text-[10px]" style={{ color: '#475569' }}>#{e.employeeNo}</div>}</Td>
              <Td><span className="text-[11px]" style={{ color: '#64748b' }}>{e.fromFunction || '—'}</span></Td>
              <Td><span className="text-[11px] font-semibold" style={{ color: '#fb923c' }}>{e.toFunction || '—'}</span></Td>
              <Td><span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ background: e.status === 'approved' ? 'rgba(52,211,153,0.15)' : 'rgba(148,163,184,0.15)', color: e.status === 'approved' ? '#34d399' : '#94a3b8' }}>{e.status}</span></Td>
              <Td><span className="text-[11px]" style={{ color: '#64748b' }}>{e.requestedBy || '—'}</span></Td>
            </tr>
          ))}
          {csData.length === 0 && <tr><td colSpan={6} className="text-center py-10" style={{ color: '#475569' }}>{ar ? 'لا توجد تغطيات cross-skill بعد' : 'No cross-skill coverage yet'}</td></tr>}
        </TableShell>
      )}

      {/* ── Generic detailed-report table (requests/permissions/breaks/audit/OT) ── */}
      {GENERIC[active] && !loading && (
        genRows.length === 0 ? (
          <div className="text-center py-16 rounded-2xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', color: '#475569' }}>
            {ar ? 'لا توجد بيانات في هذه الفترة' : 'No data in this period'}
          </div>
        ) : (
          <div className="rounded-2xl overflow-x-auto" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.25)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {Object.keys(genRows[0]).map(h => (
                    <th key={h} className="text-[10px] font-semibold uppercase tracking-wider text-start px-3 py-2.5"
                      style={{ color: '#475569', whiteSpace: 'nowrap' }}>
                      {h.replace(/([A-Z])/g, ' $1').trim()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {genRows.slice((page - 1) * limit, page * limit).map((row, i) => (
                  <tr key={i} className="hover:bg-white/[0.015]" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    {Object.keys(genRows[0]).map(h => {
                      const v = row[h];
                      const isStatus = h === 'status' || h === 'slaStatus';
                      const col = isStatus
                        ? (String(v).toLowerCase().includes('approv') || v === 'Met' ? '#34d399'
                          : String(v).toLowerCase().includes('reject') || String(v).includes('Breach') ? '#f87171'
                          : '#94a3b8')
                        : '#94a3b8';
                      return (
                        <td key={h} className="px-3 py-2 text-[11px] tabular-nums align-middle"
                          style={{ color: col, whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={v == null ? '' : String(v)}>
                          {v == null || v === '' ? '—' : String(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Pagination */}
      {active !== 'home' && !loading && total > limit && (
        <div className="flex items-center justify-center gap-2 mt-4">
          {Array.from({ length: Math.ceil(total / limit) }, (_, i) => i + 1)
            .slice(Math.max(0, page - 3), Math.min(Math.ceil(total / limit), page + 2))
            .map(p => (
              <button key={p} onClick={() => setPage(p)}
                className="w-8 h-8 rounded-lg text-xs font-medium"
                style={{ background: p === page ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.04)', color: p === page ? '#34d399' : '#64748b', border: p === page ? '1px solid rgba(52,211,153,0.35)' : '1px solid rgba(255,255,255,0.06)' }}>
                {p}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function rateColor(r: number) { return r >= 90 ? '#34d399' : r >= 75 ? '#fbbf24' : '#f87171'; }

function TableShell({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl overflow-x-auto"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <table className="w-full border-collapse">
        <thead>
          <tr style={{ background: 'rgba(0,0,0,0.25)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {head.map((h, i) => (
              <th key={i} className="text-[10px] font-semibold uppercase tracking-wider text-start px-4 py-2.5"
                style={{ color: '#475569', whiteSpace: 'nowrap' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <td className="px-4 py-2.5 text-xs tabular-nums align-middle whitespace-nowrap"
      style={color ? { color } : { color: '#94a3b8' }}>
      {children}
    </td>
  );
}
