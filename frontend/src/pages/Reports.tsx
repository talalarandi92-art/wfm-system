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

type Report = 'home' | 'attendance' | 'late' | 'overtime';

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const downloadCSV = async (url: string, params: any, filename: string) => {
  const res = await apiClient.get(url, { params: { ...params, format: 'csv' }, responseType: 'blob' });
  const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
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
  const [total, setTotal] = useState(0);

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
      }
    } catch {}
    setLoading(false);
  }, [active, page, from, to]);

  useEffect(() => { if (active !== 'home') run(); }, [run]);

  const handleDownload = async () => {
    setDl(true);
    const params: any = {};
    if (from) params.from = from;
    if (to)   params.to   = to;
    const endpointMap: Record<string, string> = { attendance: '/reports/attendance', late: '/reports/late', overtime: '/reports/overtime' };
    const nameMap: Record<string, string> = { attendance: 'attendance_report.csv', late: 'late_report.csv', overtime: 'overtime_report.csv' };
    try { await downloadCSV(endpointMap[active], params, nameMap[active]); } catch {}
    setDl(false);
  };

  const rateColor = (r: number) => r >= 90 ? '#34d399' : r >= 75 ? '#fbbf24' : '#f87171';

  const REPORTS: { id: Report; labelAr: string; labelEn: string; icon: any; color: string; descAr: string; descEn: string }[] = [
    { id: 'attendance', labelAr: 'تقرير الحضور',    labelEn: 'Attendance Report',  icon: Users,     color: '#34d399', descAr: 'حضور وغياب وتأخر لكل موظف', descEn: 'Per-employee presence, absence & late' },
    { id: 'late',       labelAr: 'ترتيب التأخر',    labelEn: 'Late Ranking',        icon: Clock,     color: '#fb923c', descAr: 'أكثر الموظفين تأخراً', descEn: 'Most-frequent late arrivals' },
    { id: 'overtime',   labelAr: 'ترتيب الإضافي',   labelEn: 'Overtime Ranking',    icon: Zap,       color: '#22d3ee', descAr: 'إجمالي ساعات الإضافي', descEn: 'Total overtime hours per employee' },
  ];

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
            <button onClick={handleDownload} disabled={dlLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium disabled:opacity-60 transition-opacity hover:opacity-80"
              style={{ background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399' }}>
              {dlLoading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              CSV
            </button>
          </div>
        )}
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
