import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Loader2, FileText, Clock, AlertTriangle, Zap, GraduationCap,
  Megaphone, Users, TrendingUp, CheckCircle2, XCircle, ArrowRight,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

interface Bundle {
  period: { from: string; to: string; attendanceDate: string };
  requests: { total: number; approved: number; rejected: number; pending: number; escalated: number; overdue: number; urgent: number; avgDecisionHours: number | null };
  attendance: { present: number; absent: number; late: number; earlyOut: number; missingPunch: number };
  coaching: { high: number; medium: number; low: number };
  campaignsActive: number;
  otHours: number;
  byType: { name: string; count: number }[];
  byFunction: { name: string; late: number; absent: number; present: number }[];
}
type Role = 'exec' | 'wfm' | 'tl' | 'agent';

const ROLES: { id: Role; ar: string; en: string }[] = [
  { id: 'exec', ar: 'تنفيذي', en: 'Executive' },
  { id: 'wfm',  ar: 'WFM / RTA', en: 'WFM / RTA' },
  { id: 'tl',   ar: 'قائد فريق', en: 'Team Leader' },
  { id: 'agent', ar: 'موظف', en: 'Agent' },
];

export default function ControlDashboardsPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();
  const navigate = useNavigate();

  const [role, setRole] = useState<Role>('exec');
  const [data, setData] = useState<Bundle | null>(null);
  const [loading, setL] = useState(true);

  const load = useCallback(async () => {
    setL(true);
    try { const { data } = await apiClient.get<Bundle>('/control-dashboard'); setData(data); }
    catch { setData(null); }
    setL(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const Kpi = ({ label, value, color, icon: Icon, sub }: { label: string; value: any; color: string; icon: any; sub?: string }) => (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${color}22`, borderRadius: 16, padding: 16 }}>
      <div className="flex items-center justify-between mb-2">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${color}15` }}><Icon size={15} style={{ color }} /></div>
      </div>
      <div className="text-2xl font-black tabular-nums" style={{ color: tp(dark) }}>{value}</div>
      <div className="text-[11px] mt-0.5" style={{ color: tsColor(dark) }}>{label}</div>
      {sub && <div className="text-[10px] mt-1" style={{ color }}>{sub}</div>}
    </div>
  );

  const FnTable = () => (
    <div className="rounded-2xl overflow-x-auto mt-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <table className="w-full border-collapse">
        <thead>
          <tr style={{ background: 'rgba(0,0,0,0.25)' }}>
            {[ar ? 'القسم' : 'Function', ar ? 'حاضر' : 'Present', ar ? 'متأخر' : 'Late', ar ? 'غائب' : 'Absent'].map((h, i) => (
              <th key={i} className="text-[10px] font-semibold uppercase tracking-wider text-start px-4 py-2.5" style={{ color: '#475569' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(data?.byFunction ?? []).map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <td className="px-4 py-2 text-xs" style={{ color: '#cbd5e1' }}>{r.name}</td>
              <td className="px-4 py-2 text-xs tabular-nums" style={{ color: '#22c55e' }}>{r.present}</td>
              <td className="px-4 py-2 text-xs tabular-nums" style={{ color: r.late > 0 ? '#fb923c' : '#475569' }}>{r.late}</td>
              <td className="px-4 py-2 text-xs tabular-nums" style={{ color: r.absent > 0 ? '#f87171' : '#475569' }}>{r.absent}</td>
            </tr>
          ))}
          {(!data?.byFunction || data.byFunction.length === 0) && (
            <tr><td colSpan={4} className="text-center py-8 text-xs" style={{ color: '#475569' }}>{ar ? 'لا توجد بيانات حضور' : 'No attendance data'}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const d = data;

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.22)' }}>
            <LayoutDashboard size={18} style={{ color: '#818cf8' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'لوحات التحكّم' : 'Control Dashboards'}</h1>
            {d && <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'حضور' : 'Attendance'}: {d.period.attendanceDate} · {ar ? 'الطلبات' : 'Requests'}: {d.period.from} → {d.period.to}</p>}
          </div>
        </div>
        <div className="flex rounded-xl overflow-hidden flex-wrap" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
          {ROLES.map(r => (
            <button key={r.id} onClick={() => setRole(r.id)} className="px-3 py-1.5 text-xs font-medium"
              style={{ background: role === r.id ? 'rgba(99,102,241,0.2)' : 'transparent', color: role === r.id ? '#818cf8' : '#64748b' }}>
              {ar ? r.ar : r.en}
            </button>
          ))}
        </div>
      </div>

      {loading || !d ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : (
        <>
          {/* EXECUTIVE */}
          {role === 'exec' && (
            <>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <Kpi label={ar ? 'إجمالي الطلبات' : 'Total requests'} value={d.requests.total} color="#818cf8" icon={FileText} />
                <Kpi label={ar ? 'موافق عليها' : 'Approved'} value={d.requests.approved} color="#22c55e" icon={CheckCircle2} />
                <Kpi label={ar ? 'مرفوضة' : 'Rejected'} value={d.requests.rejected} color="#f87171" icon={XCircle} />
                <Kpi label={ar ? 'متوسط زمن القرار' : 'Avg decision'} value={d.requests.avgDecisionHours != null ? `${d.requests.avgDecisionHours}h` : '—'} color="#38bdf8" icon={Clock} />
                <Kpi label={ar ? 'متأخرة عن SLA' : 'SLA overdue'} value={d.requests.overdue} color="#fb923c" icon={AlertTriangle} sub={d.requests.escalated ? `${d.requests.escalated} ${ar ? 'مُصعّد' : 'escalated'}` : undefined} />
                <Kpi label={ar ? 'إضافي (ساعات)' : 'Overtime (h)'} value={d.otHours} color="#22d3ee" icon={Zap} />
                <Kpi label={ar ? 'حملات نشطة' : 'Active campaigns'} value={d.campaignsActive} color="#f59e0b" icon={Megaphone} />
                <Kpi label={ar ? 'كوتشينج (عالية)' : 'Coaching (high)'} value={d.coaching.high} color="#a855f7" icon={GraduationCap} sub={`${d.coaching.medium + d.coaching.low} ${ar ? 'أخرى' : 'others'}`} />
              </div>
              {d.byType.length > 0 && (
                <div className="mt-4 rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="text-xs font-bold mb-3" style={{ color: tp(dark) }}>{ar ? 'الطلبات حسب النوع' : 'Requests by type'}</div>
                  {d.byType.map(t => {
                    const max = Math.max(...d.byType.map(x => x.count), 1);
                    return (
                      <div key={t.name} className="flex items-center gap-2 mb-1.5">
                        <span className="text-[11px] w-32 truncate" style={{ color: '#94a3b8' }}>{t.name}</span>
                        <div className="flex-1 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
                          <div className="h-full rounded-full" style={{ width: `${(t.count / max) * 100}%`, background: '#818cf8' }} />
                        </div>
                        <span className="text-[11px] tabular-nums w-8 text-end" style={{ color: '#cbd5e1' }}>{t.count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* WFM / RTA */}
          {role === 'wfm' && (
            <>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <Kpi label={ar ? 'قيد الموافقة' : 'Pending'} value={d.requests.pending} color="#fbbf24" icon={Clock} />
                <Kpi label={ar ? 'متأخرة عن SLA' : 'SLA overdue'} value={d.requests.overdue} color="#f87171" icon={AlertTriangle} />
                <Kpi label={ar ? 'مُصعّدة' : 'Escalated'} value={d.requests.escalated} color="#fb923c" icon={TrendingUp} />
                <Kpi label={ar ? 'عاجلة' : 'Urgent'} value={d.requests.urgent} color="#ef4444" icon={Zap} />
                <Kpi label={ar ? 'متأخرون اليوم' : 'Late today'} value={d.attendance.late} color="#fb923c" icon={Clock} />
                <Kpi label={ar ? 'خروج مبكر' : 'Early out'} value={d.attendance.earlyOut} color="#f59e0b" icon={AlertTriangle} />
                <Kpi label={ar ? 'بصمات ناقصة' : 'Missing punch'} value={d.attendance.missingPunch} color="#a855f7" icon={AlertTriangle} />
                <Kpi label={ar ? 'إضافي (ساعات)' : 'OT (h)'} value={d.otHours} color="#22d3ee" icon={Zap} />
              </div>
              <FnTable />
            </>
          )}

          {/* TEAM LEADER */}
          {role === 'tl' && (
            <>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <Kpi label={ar ? 'حاضرون' : 'Present'} value={d.attendance.present} color="#22c55e" icon={Users} />
                <Kpi label={ar ? 'متأخرون' : 'Late'} value={d.attendance.late} color="#fb923c" icon={Clock} />
                <Kpi label={ar ? 'غائبون' : 'Absent'} value={d.attendance.absent} color="#f87171" icon={XCircle} />
                <Kpi label={ar ? 'كوتشينج مفتوح' : 'Open coaching'} value={d.coaching.high + d.coaching.medium + d.coaching.low} color="#a855f7" icon={GraduationCap} sub={`${d.coaching.high} ${ar ? 'عالية' : 'high'}`} />
              </div>
              <FnTable />
            </>
          )}

          {/* AGENT */}
          {role === 'agent' && (
            <div className="rounded-2xl p-8 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Users size={32} className="mx-auto mb-3" style={{ color: '#475569' }} />
              <p className="text-sm mb-1" style={{ color: tp(dark) }}>{ar ? 'العرض الشخصي للموظف' : 'Agent personal view'}</p>
              <p className="text-xs mb-4" style={{ color: tsColor(dark) }}>{ar ? 'جدولك وطلباتك وحضورك في صفحتك الشخصية' : 'Your schedule, requests & attendance are in your workspace'}</p>
              <button onClick={() => navigate('/my')} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold"
                style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8' }}>
                {ar ? 'صفحتي' : 'My Workspace'} <ArrowRight size={13} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
