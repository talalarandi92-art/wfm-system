import { useState, useEffect, useCallback } from 'react';
import { useUiStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { apiClient } from '@/api/client';
import { card as cardStyle, tp, ts, useInjectDsStyles } from '@/components/ds';
import { fmtDuration } from '@/utils/format';
import BreakCard from '@/components/breaks/BreakCard';
import BreakCommandCenter from '@/components/breaks/CommandCenter';
import BreakReports from '@/components/breaks/BreakReports';
import BreakSimulation from '@/components/breaks/BreakSimulation';
import { fmtLocalDate } from '@/utils/format';
import {
  Coffee, Clock, AlertTriangle, CheckCircle, XCircle,
  Calendar, Users, BarChart3, RefreshCw, Plus, Loader2, TrendingDown, Zap,
  Radar, FileSpreadsheet, FlaskConical,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BreakSlot {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_no: string;
  function_name: string;
  gender: string;
  break_type: string;
  break_type_ar: string;
  color: string;
  icon: string;
  is_prayer: boolean;
  is_mandatory: boolean;
  duration_minutes: number;
  planned_start: string;
  planned_end: string;
  shift_start?: string | null;
  shift_end?: string | null;
  actual_start?: string;
  actual_end?: string;
  status: 'scheduled' | 'active' | 'completed' | 'missed' | 'swapped' | 'cancelled';
  late_minutes: number;
  is_missed: boolean;
}

interface CoverageInterval {
  interval_start: string;
  interval_end: string;
  required_hc: number;
  scheduled_hc: number;
  on_break: number;
  available: number;
  gap: number;
  risk_level: 'ok' | 'warn' | 'critical';
}

interface BreakRequest {
  id: string;
  employee_name: string;
  employee_no: string;
  function_name: string;
  break_type: string;
  break_type_ar: string;
  color: string;
  icon: string;
  is_prayer: boolean;
  schedule_date: string;
  requested_start: string;
  requested_end: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'auto_approved';
  min_coverage_gap: number;
  auto_approve_eligible: boolean;
  coverage_after_json?: { live?: {
    availableNow?: number; availableAfter?: number; totalWaiting?: number;
    atRiskQueues?: { name: string }[]; decision?: string; fresh?: boolean;
  } };
  reviewed_by?: string;
  reviewed_at?: string;
  review_comment?: string;
  created_at: string;
}

interface BreakType {
  id: string;
  name: string;
  name_ar: string;
  duration_minutes: number;
  color: string;
  icon: string;
  is_mandatory: boolean;
  is_prayer: boolean;
}

type Tab = 'command' | 'timeline' | 'coverage' | 'requests' | 'fairness' | 'mybreaks' | 'reports' | 'simulation';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Full 24h day — the centre runs 24/7 (midnight MD/MN shifts), so breaks happen
// at any hour (e.g. 00:41, 03:45). A 06:00 start clipped those to the left edge.
const SHIFT_START_H = 0;
const SHIFT_END_H   = 24;
const TOTAL_HOURS   = SHIFT_END_H - SHIFT_START_H;

function timeToPercent(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const minutes = (h - SHIFT_START_H) * 60 + m;
  return Math.max(0, Math.min(100, (minutes / (TOTAL_HOURS * 60)) * 100));
}

function durationToPercent(durationMin: number): number {
  return (durationMin / (TOTAL_HOURS * 60)) * 100;
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string; labelAr: string }> = {
  scheduled:    { bg: 'rgba(59,130,246,0.12)',  color: '#60a5fa', label: 'Scheduled',      labelAr: 'مجدول'           },
  active:       { bg: 'rgba(34,197,94,0.12)',   color: '#4ade80', label: 'On Break',       labelAr: 'في بريك'         },
  completed:    { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8', label: 'Completed',      labelAr: 'مكتمل'           },
  missed:       { bg: 'rgba(239,68,68,0.12)',   color: '#f87171', label: 'Missed',         labelAr: 'غائب'            },
  swapped:      { bg: 'rgba(168,85,247,0.12)',  color: '#c084fc', label: 'Swapped',        labelAr: 'مبادل'           },
  cancelled:    { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8', label: 'Cancelled',      labelAr: 'ملغى'            },
  pending:      { bg: 'rgba(245,158,11,0.12)',  color: '#fbbf24', label: 'Pending',        labelAr: 'معلق'            },
  approved:     { bg: 'rgba(34,197,94,0.12)',   color: '#4ade80', label: 'Approved',       labelAr: 'موافق'           },
  rejected:     { bg: 'rgba(239,68,68,0.12)',   color: '#f87171', label: 'Rejected',       labelAr: 'مرفوض'           },
  auto_approved:{ bg: 'rgba(20,184,166,0.12)',  color: '#2dd4bf', label: 'Auto-approved',  labelAr: 'موافق تلقائياً'  },
};

function StatusBadge({ status, ar }: { status: string; ar: boolean }) {
  const s = STATUS_STYLE[status] ?? { bg: 'rgba(100,116,139,0.1)', color: '#94a3b8', label: status, labelAr: status };
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: s.bg, color: s.color, border: `1px solid ${s.color}30` }}>
      {ar ? s.labelAr : s.label}
    </span>
  );
}

function riskColor(level: string) {
  if (level === 'critical') return '#ef4444';
  if (level === 'warn')     return '#f59e0b';
  return '#22c55e';
}

function today() { return fmtLocalDate(new Date()); }

// ── Main Component ────────────────────────────────────────────────────────────

export default function BreaksPage() {
  useInjectDsStyles();
  const { dark, lang } = useUiStore();
  const { user, hasPermission } = useAuthStore();
  const ar = lang === 'ar';

  const isAgent  = !!user && !hasPermission('schedule.view');
  const canManage = hasPermission('schedule.view');
  const canCommand = hasPermission('hc.view');   // §16 — supervisor/RTA command center

  // Supervisors land on the Command Center; agents keep My Breaks.
  const [tab, setTab]           = useState<Tab>(canCommand ? 'command' : isAgent ? 'mybreaks' : 'timeline');
  const [date, setDate]         = useState(today());
  const [functionId, setFunctionId] = useState('');

  const [slots, setSlots]           = useState<BreakSlot[]>([]);
  const [coverage, setCoverage]     = useState<CoverageInterval[]>([]);
  const [requests, setRequests]     = useState<BreakRequest[]>([]);
  const [myBreaks, setMyBreaks]     = useState<BreakSlot[]>([]);
  const [breakTypes, setBreakTypes] = useState<BreakType[]>([]);

  const [loading, setLoading]     = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError]         = useState('');

  const [showRequestModal, setShowRequestModal] = useState(false);
  const [reqSlot, setReqSlot]   = useState<BreakSlot | null>(null);
  const [reqStart, setReqStart] = useState('');
  const [reqEnd, setReqEnd]     = useState('');
  const [reqReason, setReqReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);

  // ── Derived styles ─────────────────────────────────────────────────────────
  const surface  = dark ? 'rgba(255,255,255,0.03)' : '#fff';
  const border   = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const divider  = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const inputBg  = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';
  const rowHover = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';

  const inputStyle: React.CSSProperties = {
    background: inputBg, border: `1px solid ${border}`,
    color: tp(dark), borderRadius: 10, padding: '7px 12px',
    fontSize: 12, outline: 'none',
  };

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (tab === 'command' || tab === 'reports' || tab === 'simulation') return;   // these tabs load themselves
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ date });
      if (functionId) params.set('functionId', functionId);

      if (tab === 'timeline') {
        const { data } = await apiClient.get(`/breaks/schedule?${params}`);
        setSlots(data);
      } else if (tab === 'coverage') {
        const { data } = await apiClient.get(`/breaks/coverage?${params}`);
        setCoverage(data);
      } else if (tab === 'requests') {
        const url = isAgent ? '/breaks/requests?mine=true' : '/breaks/requests';
        const { data } = await apiClient.get(url);
        setRequests(data.data ?? data);
      } else if (tab === 'mybreaks') {
        const { data } = await apiClient.get(`/breaks/my-breaks?date=${date}`);
        setMyBreaks(data);
      }
    } catch {
      setError(ar ? 'تعذّر تحميل البيانات' : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [tab, date, functionId, ar]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiClient.get('/breaks/types').then(({ data }) => setBreakTypes(data)).catch(() => {});
  }, []);

  // ── Generate ──────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      const { data } = await apiClient.post('/breaks/generate', { scheduleDate: date, functionId: functionId || undefined });
      await load();
      alert(`✅ ${data.message}${data.warnings?.length ? '\n\n' + (ar ? 'تحذيرات:' : 'Warnings:') + '\n' + data.warnings.join('\n') : ''}`);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? (ar ? 'فشل التوليد' : 'Generation failed'));
    } finally {
      setGenerating(false);
    }
  };

  // ── Submit request ────────────────────────────────────────────────────────

  const handleSubmitRequest = async () => {
    if (!reqStart || !reqEnd || !user?.employeeId) return;
    setSubmitting(true);
    try {
      const { data } = await apiClient.post('/breaks/requests', {
        scheduleDate: date,
        breakTypeId: breakTypes.find(bt => bt.name === reqSlot?.break_type)?.id ?? breakTypes[0]?.id,
        requestedStart: reqStart,
        requestedEnd: reqEnd,
        reason: reqReason,
        breakSlotId: reqSlot?.id,
      });
      setShowRequestModal(false);
      setReqReason('');
      // Show the live queue impact behind the decision
      const lv = data.liveImpact;
      let msg = data.autoApproved
        ? (ar ? '✅ تمت الموافقة التلقائية — وضع الطوابير يسمح' : '✅ Auto-approved — queue status allows it')
        : (ar ? '⏳ الطلب قيد مراجعة الـ RTA' : '⏳ Request pending RTA review');
      if (lv?.availableNow != null) {
        msg += ar
          ? `\n\nالتأثير المباشر:\n• المتاحين الآن: ${lv.availableNow} ← ${lv.availableAfter} بعد الموافقة`
            + `\n• عملاء بالانتظار: ${lv.totalWaiting}`
            + `\n• طوابير بخطر: ${lv.atRiskQueues?.length ?? 0}`
          : `\n\nLive impact:\n• Available now: ${lv.availableNow} ← ${lv.availableAfter} after approval`
            + `\n• Customers waiting: ${lv.totalWaiting}`
            + `\n• Queues at risk: ${lv.atRiskQueues?.length ?? 0}`;
        if (!data.autoApproved) {
          const REASONS: Record<string, string> = ar ? {
            pending_no_live_data:   'السبب: لا توجد بيانات حية من سبرينكلر',
            pending_queues_at_risk: 'السبب: يوجد طوابير تحت الخطر الآن',
            pending_low_coverage:   `السبب: التغطية ستنزل تحت الحد الأدنى (${lv.minAvailableThreshold} متاحين)`,
            pending_schedule_gap:   'السبب: فجوة في تغطية الجدول',
          } : {
            pending_no_live_data:   'Reason: no live data from Sprinklr',
            pending_queues_at_risk: 'Reason: queues are currently at risk',
            pending_low_coverage:   `Reason: coverage would drop below the minimum (${lv.minAvailableThreshold} available)`,
            pending_schedule_gap:   'Reason: schedule coverage gap',
          };
          msg += `\n${REASONS[lv.decision] ?? ''}`;
        }
      }
      alert(msg);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.message ?? (ar ? 'تعذّر إرسال الطلب' : 'Failed to submit request'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id: string) => {
    setActioningId(id);
    try { await apiClient.patch(`/breaks/requests/${id}/approve`, { comment: '' }); load(); }
    catch (e: any) { alert(e?.response?.data?.message ?? (ar ? 'تعذّرت الموافقة' : 'Failed to approve')); }
    finally { setActioningId(null); }
  };

  const handleReject = async (id: string) => {
    const reason = prompt(ar ? 'سبب الرفض:' : 'Rejection reason:');
    if (!reason) return;
    setActioningId(id);
    try { await apiClient.patch(`/breaks/requests/${id}/reject`, { reason }); load(); }
    catch { alert(ar ? 'تعذّر الرفض' : 'Failed to reject'); }
    finally { setActioningId(null); }
  };

  // ── Gantt groups ──────────────────────────────────────────────────────────

  const employeeMap = new Map<string, BreakSlot[]>();
  for (const s of slots) {
    if (!employeeMap.has(s.employee_id)) employeeMap.set(s.employee_id, []);
    employeeMap.get(s.employee_id)!.push(s);
  }
  const hours = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => SHIFT_START_H + i);

  const tabs: { key: Tab; label: string; labelAr: string; icon: React.ReactNode }[] = [
    ...(canCommand ? [
      { key: 'command' as Tab, label: 'Command Center', labelAr: 'مركز القيادة', icon: <Radar size={14} /> },
      { key: 'reports' as Tab, label: 'Reports', labelAr: 'التقارير', icon: <FileSpreadsheet size={14} /> },
      { key: 'simulation' as Tab, label: 'Simulation', labelAr: 'المحاكاة', icon: <FlaskConical size={14} /> },
    ] : []),
    ...(isAgent ? [{ key: 'mybreaks' as Tab, label: 'My Breaks',  labelAr: 'بريكاتي',        icon: <Coffee size={14} /> }] : []),
    ...(canManage ? [
      { key: 'timeline' as Tab, label: 'Timeline', labelAr: 'الجدول الزمني', icon: <Calendar size={14} /> },
      { key: 'coverage' as Tab, label: 'Coverage', labelAr: 'التغطية',       icon: <BarChart3 size={14} /> },
      { key: 'requests' as Tab, label: 'Requests', labelAr: 'الطلبات',       icon: <Clock size={14} /> },
    ] : [
      { key: 'requests' as Tab, label: 'My Requests', labelAr: 'طلباتي', icon: <Clock size={14} /> },
    ]),
  ];

  return (
    <div style={{ padding: 24, minHeight: '100%' }} dir={ar ? 'rtl' : 'ltr'}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', flexShrink: 0 }}>
            <Coffee size={18} style={{ color: '#f59e0b' }} />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: tp(dark) }}>
              {ar ? 'إدارة البريكات' : 'Break Management'}
            </h1>
            <p style={{ fontSize: 11, color: ts(dark), marginTop: 2 }}>
              {ar ? 'جدولة وطلبات ومتابعة البريكات مع تأثير التغطية' : 'Break scheduling, requests & coverage impact'}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />

          <button onClick={load} disabled={loading}
            style={{ padding: '7px 10px', borderRadius: 10, border: `1px solid ${border}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <RefreshCw size={13} style={{ color: ts(dark), animation: loading ? 'ds-spin 1s linear infinite' : 'none' }} />
          </button>

          {canManage && (
            <button onClick={handleGenerate} disabled={generating}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', opacity: generating ? 0.6 : 1 }}>
              {generating ? <Loader2 size={13} style={{ animation: 'ds-spin 1s linear infinite' }} /> : <Zap size={13} />}
              {ar ? 'توليد تلقائي' : 'Auto-Generate'}
            </button>
          )}

          {isAgent && (
            <button onClick={() => { setReqSlot(null); setShowRequestModal(true); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg,#f59e0b,#f97316)' }}>
              <Plus size={13} />
              {ar ? 'طلب بريك' : 'Request Break'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: 12, marginBottom: 14 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* ── Stats row ──────────────────────────────────────────────────────── */}
      {tab === 'timeline' && slots.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
          {[
            { label: ar ? 'إجمالي البريكات' : 'Total Breaks',     value: slots.length,                                       color: '#f59e0b', icon: <Coffee size={16} style={{ color: '#f59e0b' }} /> },
            { label: ar ? 'في بريك الآن' : 'On Break Now',        value: slots.filter(s => s.status === 'active').length,    color: '#4ade80', icon: <Clock size={16} style={{ color: '#4ade80' }} /> },
            { label: ar ? 'مكتملة' : 'Completed',                 value: slots.filter(s => s.status === 'completed').length, color: '#2dd4bf', icon: <CheckCircle size={16} style={{ color: '#2dd4bf' }} /> },
            { label: ar ? 'غائب عن البريك' : 'Missed',            value: slots.filter(s => s.is_missed).length,              color: '#f87171', icon: <AlertTriangle size={16} style={{ color: '#f87171' }} /> },
          ].map(stat => (
            <div key={stat.label} style={{ ...cardStyle(dark), padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${stat.color}15` }}>
                {stat.icon}
              </div>
              <div>
                <p style={{ fontSize: 10, color: ts(dark) }}>{stat.label}</p>
                <p style={{ fontSize: 20, fontWeight: 700, color: tp(dark) }}>{stat.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 500,
              border: 'none', cursor: 'pointer', transition: 'all 0.15s',
              background: tab === t.key ? 'linear-gradient(135deg,#4f46e5,#7c3aed)' : 'transparent',
              color: tab === t.key ? '#fff' : ts(dark),
            }}>
            {t.icon}
            {ar ? t.labelAr : t.label}
          </button>
        ))}
      </div>

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 64 }}>
          <Loader2 size={28} style={{ color: '#818cf8', animation: 'ds-spin 1s linear infinite' }} />
        </div>
      )}

      {!loading && (
        <>
          {/* ══ COMMAND CENTER TAB (§16) ════════════════════════════════════ */}
          {tab === 'command' && canCommand && <BreakCommandCenter date={date} />}

          {/* ══ REPORTS TAB (§25) ═══════════════════════════════════════════ */}
          {tab === 'reports' && canCommand && <BreakReports />}

          {/* ══ SIMULATION TAB (§28) ════════════════════════════════════════ */}
          {tab === 'simulation' && canCommand && <BreakSimulation date={date} />}

          {/* ══ TIMELINE TAB ════════════════════════════════════════════════ */}
          {tab === 'timeline' && (
            <div style={{ ...cardStyle(dark), overflow: 'hidden' }}>
              {slots.length === 0 ? (
                <BreakEmpty ar={ar} dark={dark} message={ar ? 'لا توجد بريكات لهذا اليوم. اضغط "توليد تلقائي" لجدولتها.' : 'No breaks scheduled. Click "Auto-Generate" to schedule.'} />
              ) : (
                <>
                  {/* Hour ruler */}
                  <div style={{ display: 'flex', borderBottom: `1px solid ${divider}`, position: 'sticky', top: 0, zIndex: 10, background: surface }}>
                    <div style={{ width: 200, flexShrink: 0, padding: '10px 16px', borderInlineEnd: `1px solid ${divider}` }}>
                      <span style={{ fontSize: 10, color: ts(dark), fontWeight: 600 }}>{ar ? 'الموظف' : 'Employee'}</span>
                    </div>
                    <div style={{ flex: 1, display: 'flex' }}>
                      {hours.map(h => (
                        <div key={h} style={{ flex: 1, textAlign: 'center', padding: '10px 0', borderInlineEnd: `1px solid ${divider}22` }}>
                          <span style={{ fontSize: 9, color: ts(dark) }}>{String(h).padStart(2, '0')}:00</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Rows */}
                  <div style={{ overflowY: 'auto', maxHeight: 520 }}>
                    {Array.from(employeeMap.entries()).map(([empId, empSlots]) => {
                      const emp = empSlots[0];
                      return (
                        <div key={empId} style={{ display: 'flex', alignItems: 'stretch', borderBottom: `1px solid ${divider}`, minHeight: 52 }}
                          onMouseEnter={e => (e.currentTarget.style.background = rowHover)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <div style={{ width: 290, flexShrink: 0, padding: '8px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, borderInlineEnd: `1px solid ${divider}` }}>
                            <p style={{ fontSize: 12, fontWeight: 600, color: tp(dark), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.employee_name}</p>
                            <p style={{ fontSize: 10, color: ts(dark), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {emp.function_name} · {emp.employee_no}
                              {emp.shift_start && <span style={{ color: '#818cf8' }}> · {ar ? 'شفت' : 'shift'} {emp.shift_start}–{emp.shift_end}</span>}
                            </p>
                            {/* Explicit break times — when-to-when, readable */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 1 }}>
                              {empSlots.map(s => (
                                <span key={s.id} title={`${s.break_type_ar} · ${s.duration_minutes}${ar ? 'د' : 'm'}`}
                                  style={{ fontSize: 9.5, fontWeight: 600, padding: '1px 5px', borderRadius: 5, background: s.color + '22', color: s.color, whiteSpace: 'nowrap' }}>
                                  {s.icon} {s.planned_start?.slice(0, 5)}–{s.planned_end?.slice(0, 5)}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div style={{ flex: 1, position: 'relative', padding: '8px 4px' }}>
                            {hours.map(h => (
                              <div key={h} style={{ position: 'absolute', top: 0, bottom: 0, left: `${((h - SHIFT_START_H) / TOTAL_HOURS) * 100}%`, width: 1, background: `${divider}` }} />
                            ))}
                            {/* Shift bar(s) behind the breaks — so you see breaks sit inside the shift.
                                Cross-midnight (end ≤ start) draws two segments. */}
                            {emp.shift_start && emp.shift_end && (() => {
                              const a = timeToPercent(emp.shift_start), b = timeToPercent(emp.shift_end);
                              const cross = emp.shift_end <= emp.shift_start;
                              const segs = cross ? [[a, 100], [0, b]] : [[a, b]];
                              return segs.map(([l, r], i) => (
                                <div key={'sh' + i} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', height: 30, left: `${l}%`, width: `${Math.max(r - l, 0.5)}%`, background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.22)', borderRadius: 6 }}
                                  title={`${ar ? 'الشفت' : 'Shift'} ${emp.shift_start}–${emp.shift_end}`} />
                              ));
                            })()}
                            {empSlots.map(slot => {
                              const left  = timeToPercent(slot.planned_start);
                              const width = durationToPercent(slot.duration_minutes);
                              return (
                                <div key={slot.id}
                                  style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', padding: '0 6px', gap: 4, overflow: 'hidden', cursor: 'pointer', left: `${left}%`, width: `${Math.max(width, 2)}%`, background: slot.color + (slot.status === 'missed' ? '35' : '25'), border: `1px solid ${slot.color}50` }}
                                  title={`${slot.break_type_ar} · ${slot.planned_start?.slice(0, 5)}–${slot.planned_end?.slice(0, 5)}`}>
                                  <span style={{ fontSize: 11, flexShrink: 0 }}>{slot.icon}</span>
                                  <span style={{ fontSize: 9, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: slot.color }}>{slot.planned_start?.slice(0, 5)}</span>
                                  {slot.status === 'missed' && <AlertTriangle size={9} style={{ color: '#f87171', flexShrink: 0 }} />}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Legend */}
                  <div style={{ padding: '10px 16px', display: 'flex', flexWrap: 'wrap', gap: 16, borderTop: `1px solid ${divider}` }}>
                    {breakTypes.slice(0, 5).map(bt => (
                      <div key={bt.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 3, background: bt.color + '50', border: `1px solid ${bt.color}` }} />
                        <span style={{ fontSize: 10, color: ts(dark) }}>{ar ? bt.name_ar : bt.name}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ══ COVERAGE TAB ════════════════════════════════════════════════ */}
          {tab === 'coverage' && (
            <div style={{ ...cardStyle(dark), overflow: 'hidden' }}>
              {coverage.length === 0 ? (
                <BreakEmpty ar={ar} dark={dark} message={ar ? 'لا توجد بيانات تغطية لهذا اليوم' : 'No coverage data for this date'} />
              ) : (
                <>
                  <div style={{ padding: 16, overflowX: 'auto' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, minWidth: coverage.length * 28, height: 160 }}>
                      {coverage.map((c, i) => {
                        const maxHc = Math.max(...coverage.map(x => x.scheduled_hc), 1);
                        const availH = Math.max(0, (c.available / maxHc) * 140);
                        const onBrkH = Math.max(0, (c.on_break / maxHc) * 140);
                        const reqH   = Math.max(0, (c.required_hc / maxHc) * 140);
                        return (
                          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, position: 'relative', width: 26, flexShrink: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 140 }}>
                              <div style={{ width: 11, borderRadius: '3px 3px 0 0', background: riskColor(c.risk_level) + 'cc', minHeight: 2, height: availH }} title={`Available: ${c.available}`} />
                              <div style={{ width: 11, borderRadius: '3px 3px 0 0', background: '#f59e0b80', minHeight: 2, height: onBrkH }} title={`On break: ${c.on_break}`} />
                            </div>
                            <div style={{ position: 'absolute', bottom: reqH + 2, left: 0, right: 0, height: 2, background: '#6366f1', borderRadius: 1 }} />
                            <span style={{ fontSize: 8, color: ts(dark), transform: 'rotate(-45deg)', marginTop: 4 }}>{c.interval_start.slice(0, 5)}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
                      {[{ color: '#22c55ecc', label: ar ? 'متاح' : 'Available' }, { color: '#f59e0b80', label: ar ? 'في بريك' : 'On Break' }, { color: '#6366f1', label: ar ? 'مطلوب' : 'Required' }].map(l => (
                        <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 10, height: 10, borderRadius: 2, background: l.color }} />
                          <span style={{ fontSize: 10, color: ts(dark) }}>{l.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ overflowX: 'auto', borderTop: `1px solid ${divider}` }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
                          {[ar ? 'الفترة' : 'Interval', ar ? 'مطلوب' : 'Required', ar ? 'مجدول' : 'Scheduled', ar ? 'في بريك' : 'On Break', ar ? 'متاح' : 'Available', ar ? 'الفجوة' : 'Gap', ar ? 'المخاطر' : 'Risk'].map(h => (
                            <th key={h} style={{ padding: '9px 14px', textAlign: 'start', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: ts(dark), borderBottom: `1px solid ${divider}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {coverage.map((c, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${divider}` }}
                            onMouseEnter={e => (e.currentTarget.style.background = rowHover)}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                            <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 11, color: tp(dark) }}>{c.interval_start.slice(0, 5)}–{c.interval_end.slice(0, 5)}</td>
                            <td style={{ padding: '10px 14px', fontSize: 12, color: ts(dark) }}>{c.required_hc}</td>
                            <td style={{ padding: '10px 14px', fontSize: 12, color: ts(dark) }}>{c.scheduled_hc}</td>
                            <td style={{ padding: '10px 14px', fontSize: 12, color: '#f59e0b' }}>{c.on_break}</td>
                            <td style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600, color: riskColor(c.risk_level) }}>{c.available}</td>
                            <td style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600, color: c.gap < 0 ? '#ef4444' : c.gap === 0 ? '#f59e0b' : '#22c55e' }}>{c.gap > 0 ? '+' : ''}{c.gap}</td>
                            <td style={{ padding: '10px 14px' }}>
                              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 600, background: c.risk_level === 'critical' ? 'rgba(239,68,68,0.12)' : c.risk_level === 'warn' ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)', color: riskColor(c.risk_level) }}>
                                {c.risk_level === 'critical' ? (ar ? 'حرج' : 'Critical') : c.risk_level === 'warn' ? (ar ? 'تحذير' : 'Warning') : (ar ? 'آمن' : 'Safe')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ══ REQUESTS TAB ════════════════════════════════════════════════ */}
          {tab === 'requests' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {isAgent && (
                <div style={{ ...cardStyle(dark), padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: tp(dark) }}>{ar ? 'طلب بريك جديد' : 'New Break Request'}</p>
                    <p style={{ fontSize: 11, color: ts(dark) }}>{ar ? 'اطلب تغيير وقت البريك أو بريك إضافي' : 'Request a time change or additional break'}</p>
                  </div>
                  <button onClick={() => { setReqSlot(null); setShowRequestModal(true); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg,#f59e0b,#f97316)', flexShrink: 0 }}>
                    <Plus size={13} />{ar ? 'طلب بريك' : 'Request Break'}
                  </button>
                </div>
              )}

              {requests.length === 0 ? (
                <div style={{ ...cardStyle(dark), padding: 48, textAlign: 'center' }}>
                  <Coffee size={36} style={{ color: ts(dark), display: 'block', margin: '0 auto 12px', opacity: 0.3 }} />
                  <p style={{ color: ts(dark), fontSize: 13 }}>{ar ? 'لا توجد طلبات' : 'No requests'}</p>
                </div>
              ) : requests.map(req => (
                <div key={req.id} style={{ ...cardStyle(dark), padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: req.color + '20', border: `1px solid ${req.color}40`, flexShrink: 0 }}>{req.icon}</div>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: tp(dark) }}>{req.employee_name}</p>
                        <p style={{ fontSize: 11, color: ts(dark) }}>{req.function_name} · {req.employee_no}</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <StatusBadge status={req.status} ar={ar} />
                      {req.min_coverage_gap < 0 && (
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <TrendingDown size={9} />{ar ? `فجوة ${req.min_coverage_gap}` : `Gap ${req.min_coverage_gap}`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${divider}` }}>
                    {[
                      { label: ar ? 'النوع' : 'Type', value: ar ? req.break_type_ar : req.break_type },
                      { label: ar ? 'التاريخ' : 'Date', value: req.schedule_date },
                      { label: ar ? 'الوقت المطلوب' : 'Requested Time', value: `${req.requested_start} – ${req.requested_end}` },
                      ...(req.reason ? [{ label: ar ? 'السبب' : 'Reason', value: req.reason }] : []),
                    ].map(item => (
                      <div key={item.label}>
                        <p style={{ fontSize: 10, color: ts(dark) }}>{item.label}</p>
                        <p style={{ fontSize: 12, fontWeight: 500, color: tp(dark), marginTop: 2 }}>{item.value}</p>
                      </div>
                    ))}
                  </div>

                  {canManage && (() => {
                    const gap = req.min_coverage_gap;
                    const safe = req.auto_approve_eligible;
                    const critical = gap < 0;
                    const warn = !safe && !critical;
                    const bgColor  = critical ? 'rgba(239,68,68,0.07)'   : warn ? 'rgba(245,158,11,0.07)'   : 'rgba(34,197,94,0.07)';
                    const bdColor  = critical ? 'rgba(239,68,68,0.25)'   : warn ? 'rgba(245,158,11,0.25)'   : 'rgba(34,197,94,0.25)';
                    const txtColor = critical ? '#f87171' : warn ? '#fbbf24' : '#4ade80';
                    const decision = critical ? (ar ? 'خطر — تغطية ناقصة' : 'Risk — Coverage shortage') : warn ? (ar ? 'تحذير — تغطية حدية' : 'Caution — Marginal coverage') : (ar ? 'آمن — يمكن الموافقة' : 'Safe to approve');
                    return (
                      <div style={{ marginTop: 10, borderRadius: 12, padding: 12, background: bgColor, border: `1px solid ${bdColor}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <BarChart3 size={11} style={{ color: txtColor }} />
                            <span style={{ fontSize: 11, fontWeight: 600, color: txtColor }}>{ar ? 'تأثير التغطية' : 'Coverage Impact'}</span>
                            <span style={{ fontSize: 10, color: ts(dark) }}>{req.requested_start}–{req.requested_end}</span>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: txtColor }}>{decision}</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                          {[
                            { label: ar ? 'الفجوة الحالية' : 'Current Gap', value: `${gap >= 0 ? '+' : ''}${gap}`, color: gap >= 0 ? '#4ade80' : '#f87171' },
                            { label: ar ? 'بعد الموافقة' : 'After Approval', value: `${(gap - 1) >= 0 ? '+' : ''}${gap - 1}`, color: (gap - 1) >= 0 ? '#4ade80' : '#f87171' },
                            { label: ar ? 'تلقائي' : 'Auto', value: safe ? (ar ? 'نعم' : 'Yes') : (ar ? 'لا' : 'No'), color: safe ? '#4ade80' : '#94a3b8' },
                          ].map(item => (
                            <div key={item.label} style={{ textAlign: 'center', padding: '6px 0', borderRadius: 8, background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}>
                              <p style={{ fontSize: 10, color: ts(dark) }}>{item.label}</p>
                              <p style={{ fontSize: 14, fontWeight: 700, color: item.color }}>{item.value}</p>
                            </div>
                          ))}
                        </div>

                        {/* Live queue impact at submission time (Sprinklr bridge) */}
                        {(() => {
                          const lv = req.coverage_after_json?.live;
                          if (!lv || lv.availableNow == null) return null;
                          const risky = (lv.atRiskQueues?.length ?? 0) > 0;
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${divider}` }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: '#22d3ee', display: 'flex', alignItems: 'center', gap: 4 }}>
                                📡 {ar ? 'وضع الكيوز وقت الطلب' : 'Live queues at request time'}
                              </span>
                              <span style={{ fontSize: 10, color: ts(dark) }}>
                                {ar ? 'متاحين' : 'Available'}: <b style={{ color: tp(dark) }}>{lv.availableNow}</b> ← <b style={{ color: (lv.availableAfter ?? 0) >= 3 ? '#4ade80' : '#f87171' }}>{lv.availableAfter}</b>
                              </span>
                              <span style={{ fontSize: 10, color: ts(dark) }}>
                                {ar ? 'بالانتظار' : 'Waiting'}: <b style={{ color: tp(dark) }}>{lv.totalWaiting}</b>
                              </span>
                              <span style={{ fontSize: 10, color: risky ? '#f87171' : '#4ade80', fontWeight: 700 }}>
                                {risky
                                  ? (ar ? `⚠ ${lv.atRiskQueues!.length} طابور بخطر` : `⚠ ${lv.atRiskQueues!.length} queue(s) at risk`)
                                  : (ar ? '✓ الطوابير سليمة' : '✓ Queues healthy')}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}

                  {req.status === 'pending' && canManage && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button onClick={() => handleApprove(req.id)} disabled={actioningId === req.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: '#16a34a', color: '#fff', opacity: actioningId === req.id ? 0.6 : 1 }}>
                        {actioningId === req.id ? <Loader2 size={11} style={{ animation: 'ds-spin 1s linear infinite' }} /> : <CheckCircle size={11} />}
                        {ar ? 'موافقة' : 'Approve'}
                      </button>
                      <button onClick={() => handleReject(req.id)} disabled={actioningId === req.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: '#dc2626', color: '#fff', opacity: actioningId === req.id ? 0.6 : 1 }}>
                        <XCircle size={11} />{ar ? 'رفض' : 'Reject'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ══ MY BREAKS TAB ═══════════════════════════════════════════════ */}
          {tab === 'mybreaks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* §14 live employee break card — engine status, entitlement, start/return */}
              <BreakCard onRequestException={() => { setReqSlot(null); setShowRequestModal(true); }} />

              <div style={{ ...cardStyle(dark), padding: 14 }}>
                <p style={{ fontSize: 11, color: ts(dark) }}>{ar ? 'التاريخ' : 'Date'}</p>
                <p style={{ fontSize: 14, fontWeight: 600, color: tp(dark), marginTop: 2 }}>{date}</p>
              </div>

              {myBreaks.length === 0 ? (
                <div style={{ ...cardStyle(dark), padding: 48, textAlign: 'center' }}>
                  <Coffee size={36} style={{ color: ts(dark), display: 'block', margin: '0 auto 12px', opacity: 0.3 }} />
                  <p style={{ color: ts(dark), fontSize: 13, marginBottom: 16 }}>{ar ? 'لا توجد بريكات مجدولة لك اليوم' : 'No breaks scheduled for you today'}</p>
                  <button onClick={() => { setReqSlot(null); setShowRequestModal(true); }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg,#f59e0b,#f97316)' }}>
                    <Plus size={13} />{ar ? 'طلب بريك' : 'Request a Break'}
                  </button>
                </div>
              ) : myBreaks.map(slot => (
                <div key={slot.id} style={{ ...cardStyle(dark), padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: slot.color + '20', border: `1px solid ${slot.color}40`, flexShrink: 0 }}>{slot.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: tp(dark) }}>{ar ? slot.break_type_ar : slot.break_type}</p>
                      <StatusBadge status={slot.status} ar={ar} />
                      {slot.is_prayer && <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, background: 'rgba(168,85,247,0.1)', color: '#c084fc' }}>🕌 {ar ? 'صلاة' : 'Prayer'}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 11, color: ts(dark) }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={11} />{slot.planned_start} – {slot.planned_end}</span>
                      <span>{fmtDuration(slot.duration_minutes, ar)}</span>
                      {slot.late_minutes > 0 && <span style={{ color: '#f87171', display: 'flex', alignItems: 'center', gap: 3 }}><AlertTriangle size={10} />{ar ? `تأخر ${slot.late_minutes}د` : `Late ${slot.late_minutes}m`}</span>}
                    </div>
                  </div>
                  <button onClick={() => { setReqSlot(slot); setReqStart(slot.planned_start); setReqEnd(slot.planned_end); setShowRequestModal(true); }}
                    style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${border}`, background: 'transparent', cursor: 'pointer', fontSize: 11, color: tp(dark) }}>
                    {ar ? 'تغيير الوقت' : 'Change Time'}
                  </button>
                </div>
              ))}

              {myBreaks.length > 0 && (
                <button onClick={() => { setReqSlot(null); setShowRequestModal(true); }}
                  style={{ width: '100%', padding: 14, borderRadius: 14, border: `2px dashed ${border}`, background: 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 500, color: ts(dark) }}>
                  + {ar ? 'طلب بريك إضافي' : 'Request Additional Break'}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ══ REQUEST MODAL ═══════════════════════════════════════════════════ */}
      {showRequestModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 420, borderRadius: 20, overflow: 'hidden', background: dark ? '#151c30' : '#fff', border: `1px solid ${border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${divider}` }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: tp(dark), display: 'flex', alignItems: 'center', gap: 8 }}>
                <Coffee size={16} style={{ color: '#f59e0b' }} />
                {ar ? 'طلب تغيير بريك' : 'Break Change Request'}
              </h3>
              <button onClick={() => setShowRequestModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: ts(dark) }}><XCircle size={18} /></button>
            </div>

            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {reqSlot && (
                <div style={{ fontSize: 11, padding: '8px 12px', borderRadius: 8, background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', color: ts(dark) }}>
                  {ar ? 'البريك الحالي:' : 'Current break:'} <span style={{ color: tp(dark), fontWeight: 600 }}>{reqSlot.break_type_ar} · {reqSlot.planned_start}–{reqSlot.planned_end}</span>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[{ label: ar ? 'وقت البداية' : 'Start Time', val: reqStart, set: setReqStart }, { label: ar ? 'وقت الانتهاء' : 'End Time', val: reqEnd, set: setReqEnd }].map(f => (
                  <div key={f.label}>
                    <label style={{ fontSize: 11, color: ts(dark), display: 'block', marginBottom: 4 }}>{f.label}</label>
                    <input type="time" value={f.val} onChange={e => f.set(e.target.value)} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                ))}
              </div>
              <div>
                <label style={{ fontSize: 11, color: ts(dark), display: 'block', marginBottom: 4 }}>{ar ? 'السبب' : 'Reason'}</label>
                <textarea rows={3} value={reqReason} onChange={e => setReqReason(e.target.value)}
                  placeholder={ar ? 'اذكر سبب التغيير...' : 'Reason for the change...'}
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', resize: 'none', fontFamily: 'inherit' }} />
              </div>
              <div style={{ fontSize: 11, padding: '8px 12px', borderRadius: 8, background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.15)', color: '#818cf8' }}>
                💡 {ar ? 'إذا كانت التغطية كافية سيتم القبول تلقائياً' : 'If coverage is sufficient, the request will be auto-approved.'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: `1px solid ${divider}` }}>
              <button onClick={() => setShowRequestModal(false)}
                style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: `1px solid ${border}`, background: 'transparent', cursor: 'pointer', fontSize: 12, color: tp(dark) }}>
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button onClick={handleSubmitRequest} disabled={submitting || !reqStart || !reqEnd}
                style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: submitting || !reqStart || !reqEnd ? 0.6 : 1 }}>
                {submitting && <Loader2 size={13} style={{ animation: 'ds-spin 1s linear infinite' }} />}
                {ar ? 'إرسال الطلب' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BreakEmpty({ ar, dark, message }: { ar: boolean; dark: boolean; message: string }) {
  return (
    <div style={{ padding: 56, textAlign: 'center' }}>
      <Coffee size={40} style={{ color: ts(dark), display: 'block', margin: '0 auto 16px', opacity: 0.25 }} />
      <p style={{ fontSize: 13, color: ts(dark) }}>{message}</p>
    </div>
  );
}
