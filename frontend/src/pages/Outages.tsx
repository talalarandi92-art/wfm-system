import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Zap, Plus, X, AlertTriangle, CheckCircle2,
  Clock, Loader2, RefreshCw, Filter, WifiOff, MessageSquare,
  Paperclip, Trash2, Upload, Shield, User, BarChart2,
  TrendingUp, Activity, AlarmClock, Eye, Send, FileText,
  ChevronRight, Image, Video, Download, Share2, Mail, Printer,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { card as cardStyle, tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';
import { fmtDateTime, fmtDuration } from '@/utils/format';

// ─── Types ────────────────────────────────────────────────────────────────────
interface OutageType { id: string; name: string; name_ar: string; code: string }

interface Outage {
  id: string; title: string; description: string | null;
  status: 'reported' | 'validated' | 'in_progress' | 'resolved' | 'closed';
  severity: 'low' | 'medium' | 'high' | 'critical';
  typeName: string | null; typeNameAr: string | null;
  impactedFunctions: string[];
  startedAt: string; endedAt: string | null;
  durationMinutes: number | null;
  reportedByName: string | null; resolvedByName: string | null;
  handlerName: string | null; validatedByName: string | null;
  validatedAt: string | null;
  rootCause: string | null; resolution: string | null;
  slaTargetMinutes: number | null; slaDueAt: string | null;
  slaBreached: boolean; slaRemainingMin: number | null;
  notesCount: number; attachmentsCount: number;
  impactDescription: string | null; hcImpact: any;
  createdAt: string;
}

interface OutageDetail extends Outage {
  notes: Note[];
  attachments: Attachment[];
}

interface Note {
  id: string; authorName: string; content: string;
  isInternal: boolean; createdAt: string;
}

interface Attachment {
  id: string; uploaderName: string; originalName: string;
  storedName: string; mimeType: string; fileSize: number;
  url: string; isImage: boolean; isVideo: boolean; createdAt: string;
}

interface DashboardData {
  summary: {
    total: number; active: number; criticalActive: number; resolvedTotal: number;
    avgDurationMin: number | null; slaBreached: number; slaTracked: number;
    slaBreachRate: number; last7d: number; last30d: number;
  };
  bySeverity: { severity: string; total: number; active: number }[];
  byStatus:   { status: string; total: number }[];
  byType:     { name: string; nameAr: string; total: number; active: number; avgDurationMin: number | null }[];
  trend:      { day: string; total: number; critical: number }[];
  topHandlers: { name: string; handled: number; avgDurationMin: number | null }[];
  activeOutages: {
    id: string; title: string; severity: string; status: string;
    startedAt: string; slaDueAt: string | null;
    typeName: string | null; typeNameAr: string | null;
    elapsedMinutes: number; handlerName: string | null; slaBreached: boolean;
  }[];
}

interface FuncOption { id: string; name: string }

// ─── Metadata ────────────────────────────────────────────────────────────────
const SEV: Record<string, { ar: string; en: string; color: string; bg: string }> = {
  low:      { ar: 'منخفض', en: 'Low',      color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  medium:   { ar: 'متوسط', en: 'Medium',   color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  high:     { ar: 'عالي',  en: 'High',     color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  critical: { ar: 'حرج',   en: 'Critical', color: '#f87171', bg: 'rgba(239,68,68,0.12)'  },
};
const ST: Record<string, { ar: string; en: string; color: string; bg: string }> = {
  reported:    { ar: 'مُبلَّغ',       en: 'Reported',     color: '#f87171', bg: 'rgba(239,68,68,0.12)'   },
  validated:   { ar: 'مُتحقق',       en: 'Validated',    color: '#fb923c', bg: 'rgba(251,146,60,0.12)'  },
  in_progress: { ar: 'جاري العلاج', en: 'In Progress',  color: '#fbbf24', bg: 'rgba(251,191,36,0.12)'  },
  resolved:    { ar: 'محلول',        en: 'Resolved',     color: '#34d399', bg: 'rgba(52,211,153,0.12)'  },
  closed:      { ar: 'مغلق',         en: 'Closed',       color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
};
// Theme-aware neutral tokens (recipe of dd234d7) — semantic status colors stay fixed
const tok = (dark: boolean) => ({
  panel:   dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
  bdr:     dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.10)',
  overlay: dark ? 'rgba(0,0,0,0.75)'       : 'rgba(15,23,42,0.45)',
  faint:   dark ? '#475569'                : '#94a3b8',
});
// fmtDt and fmtDur now use shared utilities — ar is passed from the component
const fmtDt  = (dt: string, ar?: boolean) => fmtDateTime(dt, ar);
const fmtDur = (min: number | null, ar?: boolean) => fmtDuration(min, ar);
const fmtSize = (b: number) => b > 1048576 ? `${(b/1048576).toFixed(1)} MB` : `${Math.round(b/1024)} KB`;

// ─── SLA Countdown ───────────────────────────────────────────────────────────
function SlaTag({ slaDueAt, slaBreached, slaRemainingMin, ar }: {
  slaDueAt: string | null; slaBreached: boolean; slaRemainingMin: number | null; ar: boolean;
}) {
  if (!slaDueAt) return null;
  if (slaBreached) return (
    <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: 'rgba(239,68,68,0.18)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
      <AlarmClock size={9} /> {ar ? 'SLA تجاوز' : 'SLA Breached'}
    </span>
  );
  if (slaRemainingMin !== null && slaRemainingMin <= 15) return (
    <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full animate-pulse"
      style={{ background: 'rgba(251,146,60,0.18)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.3)' }}>
      <AlarmClock size={9} /> {slaRemainingMin}m
    </span>
  );
  if (slaRemainingMin !== null) return (
    <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
      style={{ background: 'rgba(52,211,153,0.1)', color: '#34d399', border: '1px solid rgba(52,211,153,0.2)' }}>
      <AlarmClock size={9} /> {fmtDur(slaRemainingMin)}
    </span>
  );
  return null;
}

// ─── Metric Card ─────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, color, icon: Icon, pulse }: {
  label: string; value: string | number; sub?: string;
  color: string; icon: any; pulse?: boolean;
}) {
  const { dark } = useUiStore();
  const T = tok(dark);
  return (
    <div className="rounded-2xl p-4 flex items-start gap-3"
      style={{ background: T.panel, border: `1px solid ${color}25` }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}18`, border: `1px solid ${color}30` }}>
        <Icon size={16} style={{ color }} className={pulse ? 'animate-pulse' : ''} />
      </div>
      <div>
        <p className="text-xs" style={{ color: T.faint }}>{label}</p>
        <p className="text-xl font-bold mt-0.5" style={{ color: tp(dark) }}>{value}</p>
        {sub && <p className="text-[10px] mt-0.5" style={{ color: tsColor(dark) }}>{sub}</p>}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function OutagesPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();
  const T = tok(dark);

  const [tab, setTab]                   = useState<'dashboard'|'active'|'all'|'report'>('dashboard');
  const [outages, setOutages]           = useState<Outage[]>([]);
  const [types, setTypes]               = useState<OutageType[]>([]);
  const [funcs, setFuncs]               = useState<FuncOption[]>([]);
  const [total, setTotal]               = useState(0);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(false);
  const [statusFilter, setStatus]       = useState('');
  const [sevFilter, setSev]             = useState('');
  const [page, setPage]                 = useState(1);
  const [detail, setDetail]             = useState<OutageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showForm, setShowForm]         = useState(false);
  const [dashboard, setDashboard]       = useState<DashboardData | null>(null);
  const [dashLoading, setDashLoading]   = useState(false);

  // ── form state ─────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    title: '', description: '', outageTypeId: '', severity: 'high',
    impactedFunctionIds: [] as string[], startedAt: '', impactDescription: '',
    slaTargetMinutes: '',
  });
  const [saving, setSaving] = useState(false);

  // ── note state ─────────────────────────────────────────────────────────────
  const [noteText, setNoteText]         = useState('');
  const [noteInternal, setNoteInt]      = useState(true);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [resolveText, setResolveText]   = useState('');

  // ── attachment state ────────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox]   = useState<Attachment | null>(null);

  // ── share modal ─────────────────────────────────────────────────────────────
  const [shareOutage, setShareOutage] = useState<OutageDetail | null>(null);

  // ── status update ───────────────────────────────────────────────────────────
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // ── Load dashboard ─────────────────────────────────────────────────────────
  const loadDashboard = useCallback(() => {
    setDashLoading(true);
    apiClient.get('/outages/dashboard')
      .then(r => setDashboard(r.data))
      .catch(() => {})
      .finally(() => setDashLoading(false));
  }, []);

  useEffect(() => { if (tab === 'dashboard') loadDashboard(); }, [tab, loadDashboard]);

  // ── Load list ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { limit: 20, offset: (page - 1) * 20 };
      if (tab === 'active') params.status = 'reported,validated,in_progress';
      else if (statusFilter) params.status = statusFilter;
      if (sevFilter) params.severity = sevFilter;
      const { data } = await apiClient.get('/outages', { params });
      setOutages(data.data ?? []); setTotal(data.total ?? 0); setError(false);
    } catch { setError(true); }
    setLoading(false);
  }, [page, statusFilter, sevFilter, tab]);

  useEffect(() => {
    if (tab !== 'dashboard') load();
  }, [load, tab]);

  useEffect(() => {
    apiClient.get('/outages/types').then(r => setTypes(r.data)).catch(() => {});
    apiClient.get('/settings/functions').then(r => setFuncs(r.data)).catch(() => {});
  }, []);

  // ── Load detail ────────────────────────────────────────────────────────────
  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const { data } = await apiClient.get(`/outages/${id}`);
      setDetail(data); setNoteText('');
    } catch {}
    setDetailLoading(false);
  };

  const refreshDetail = async () => {
    if (!detail) return;
    const { data } = await apiClient.get(`/outages/${detail.id}`);
    setDetail(data);
    load();
  };

  // ── Submit note ────────────────────────────────────────────────────────────
  const submitNote = async () => {
    if (!detail || !noteText.trim()) return;
    setNoteSubmitting(true);
    try {
      await apiClient.post(`/outages/${detail.id}/notes`, { content: noteText.trim(), isInternal: noteInternal });
      setNoteText(''); await refreshDetail();
    } catch {}
    setNoteSubmitting(false);
  };

  // ── Upload attachment ──────────────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !detail) return;
    setUploading(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      await apiClient.post(`/outages/${detail.id}/attachments`, fd);
      await refreshDetail();
    } catch (err: any) {
      alert(err?.response?.data?.message ?? (ar ? 'فشل الرفع' : 'Upload failed'));
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  // ── Delete attachment ──────────────────────────────────────────────────────
  const deleteAttachment = async (attachmentId: string) => {
    if (!detail) return;
    await apiClient.delete(`/outages/${detail.id}/attachments/${attachmentId}`);
    await refreshDetail();
  };

  // ── Update status ──────────────────────────────────────────────────────────
  const updateStatus = async (id: string, status: string, extra?: any) => {
    setUpdatingId(id);
    try {
      await apiClient.patch(`/outages/${id}`, { status, ...extra });
      if (detail?.id === id) await refreshDetail();
      load(); loadDashboard();
    } catch {}
    setUpdatingId(null);
  };

  // ── Create ─────────────────────────────────────────────────────────────────
  const [formError, setFormError] = useState('');
  const submit = async () => {
    if (!form.title || !form.outageTypeId || !form.startedAt) return;
    setSaving(true); setFormError('');
    try {
      const payload: any = { ...form };
      // Convert datetime-local string → ISO 8601 for backend
      payload.startedAt = new Date(form.startedAt).toISOString();
      if (form.slaTargetMinutes) payload.slaTargetMinutes = parseInt(form.slaTargetMinutes);
      else delete payload.slaTargetMinutes;
      if (!payload.description)      delete payload.description;
      if (!payload.impactDescription) delete payload.impactDescription;
      await apiClient.post('/outages', payload);
      setShowForm(false);
      setForm({ title:'', description:'', outageTypeId:'', severity:'high', impactedFunctionIds:[], startedAt:'', impactDescription:'', slaTargetMinutes:'' });
      load(); loadDashboard();
    } catch (err: any) {
      setFormError(err?.response?.data?.message ?? (ar ? 'فشل الإرسال — تأكد من الحقول المطلوبة' : 'Submit failed — check the required fields'));
    }
    setSaving(false);
  };

  const toggleFunc = (id: string) =>
    setForm(f => ({
      ...f, impactedFunctionIds: f.impactedFunctionIds.includes(id)
        ? f.impactedFunctionIds.filter(x => x !== id)
        : [...f.impactedFunctionIds, id],
    }));

  // ── Tabs ───────────────────────────────────────────────────────────────────
  const TABS = [
    { key: 'dashboard', ar: 'لوحة التحكم', en: 'Dashboard',      icon: BarChart2 },
    { key: 'active',    ar: 'النشطة',       en: 'Active',         icon: Activity  },
    { key: 'all',       ar: 'الكل',         en: 'All Outages',    icon: FileText  },
    { key: 'report',    ar: 'التقارير',     en: 'Reports',        icon: TrendingUp },
  ] as const;

  const activeBadge = dashboard?.summary.active ?? 0;

  return (
    <div className="max-w-[1400px] mx-auto space-y-4" dir={ar ? 'rtl' : 'ltr'}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.25)' }}>
            <Zap size={18} style={{ color: '#fbbf24' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>
              {ar ? 'إدارة الأعطال' : 'Outage Management'}
            </h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>
              {ar ? 'تتبع الأعطال — SLA — التقارير — RTA' : 'Track outages · SLA · Reports · RTA handling'}
            </p>
          </div>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
          style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
          <Plus size={14} /> {ar ? 'إبلاغ عطل' : 'Report Outage'}
        </button>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-2xl p-1 w-fit"
        style={{ ...cardStyle(dark) }}>
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => { setTab(t.key); setPage(1); }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all relative"
              style={{
                background: active ? 'rgba(99,102,241,0.2)' : 'transparent',
                color: active ? '#818cf8' : tsColor(dark),
                border: active ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
              }}>
              <Icon size={13} />
              {ar ? t.ar : t.en}
              {t.key === 'active' && activeBadge > 0 && (
                <span className="absolute -top-1 -end-1 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center"
                  style={{ background: '#ef4444', color: 'white' }}>{activeBadge}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ══════════════ DASHBOARD TAB ════════════════════════════════════ */}
      {tab === 'dashboard' && (
        <div className="space-y-4">
          {dashLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin" style={{ color: T.faint }} />
            </div>
          ) : dashboard ? (
            <>
              {/* Metric cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard label={ar ? 'إجمالي الأعطال' : 'Total Outages'}
                  value={dashboard.summary.total} color="#818cf8" icon={Zap} />
                <MetricCard label={ar ? 'نشطة الآن' : 'Active Now'}
                  value={dashboard.summary.active} color="#f87171" icon={Activity}
                  pulse={dashboard.summary.active > 0}
                  sub={dashboard.summary.criticalActive > 0 ? `${dashboard.summary.criticalActive} ${ar ? 'حرج' : 'critical'}` : undefined} />
                <MetricCard label={ar ? 'متوسط المدة' : 'Avg Duration'}
                  value={fmtDur(dashboard.summary.avgDurationMin)} color="#fbbf24" icon={Clock} />
                <MetricCard label={ar ? 'تجاوز SLA' : 'SLA Breached'}
                  value={`${dashboard.summary.slaBreachRate}%`} color="#f87171" icon={AlarmClock}
                  sub={`${dashboard.summary.slaBreached}/${dashboard.summary.slaTracked}`} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard label={ar ? 'آخر 7 أيام' : 'Last 7 Days'}
                  value={dashboard.summary.last7d} color="#34d399" icon={TrendingUp} />
                <MetricCard label={ar ? 'آخر 30 يوم' : 'Last 30 Days'}
                  value={dashboard.summary.last30d} color="#60a5fa" icon={BarChart2} />
                <MetricCard label={ar ? 'محلولة' : 'Resolved'}
                  value={dashboard.summary.resolvedTotal} color="#34d399" icon={CheckCircle2} />
                <MetricCard label={ar ? 'تحت المتابعة' : 'SLA Tracked'}
                  value={dashboard.summary.slaTracked} color="#a78bfa" icon={Shield} />
              </div>

              {/* Active outages live board */}
              {dashboard.activeOutages.length > 0 && (
                <div className="rounded-2xl overflow-hidden"
                  style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)' }}>
                  <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'rgba(239,68,68,0.15)' }}>
                    <Activity size={14} style={{ color: '#f87171' }} className="animate-pulse" />
                    <span className="text-sm font-semibold" style={{ color: '#fca5a5' }}>
                      {ar ? `${dashboard.activeOutages.length} عطل نشط` : `${dashboard.activeOutages.length} Active Outages`}
                    </span>
                  </div>
                  <div className="divide-y" style={{ borderColor: T.bdr }}>
                    {dashboard.activeOutages.map(o => {
                      const sv = SEV[o.severity] ?? SEV.medium;
                      const st = ST[o.status] ?? ST.reported;
                      return (
                        <div key={o.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] cursor-pointer"
                          onClick={() => { setTab('all'); openDetail(o.id); }}>
                          <div className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: sv.color, boxShadow: `0 0 6px ${sv.color}80` }} />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium truncate block" style={{ color: tp(dark) }}>{o.title}</span>
                            <div className="flex items-center gap-2 text-[11px] mt-0.5" style={{ color: T.faint }}>
                              <span>{ar ? (o.typeNameAr ?? o.typeName) : (o.typeName ?? o.typeNameAr)}</span>
                              {o.handlerName && <><span>·</span><span className="flex items-center gap-1"><User size={9} />{o.handlerName}</span></>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.color }}>{ar ? st.ar : st.en}</span>
                            <span className="text-[10px] font-mono" style={{ color: tsColor(dark) }}>{fmtDur(o.elapsedMinutes)}</span>
                            {o.slaBreached
                              ? <span className="text-[10px] font-semibold" style={{ color: '#f87171' }}>SLA!</span>
                              : o.slaDueAt && <span className="text-[10px]" style={{ color: new Date(o.slaDueAt).getTime() - Date.now() < 900000 ? '#fb923c' : tsColor(dark) }}>
                                  <AlarmClock size={9} className="inline me-0.5" />
                                  {fmtDur(Math.round((new Date(o.slaDueAt).getTime() - Date.now()) / 60000))}
                                </span>
                            }
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* By type + By severity + Top handlers */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* By Type */}
                <div className="rounded-2xl p-4 space-y-2"
                  style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
                  <p className="text-xs font-semibold mb-3" style={{ color: tsColor(dark) }}>{ar ? 'بحسب النوع' : 'By Type'}</p>
                  {dashboard.byType.map(t => (
                    <div key={t.name} className="flex items-center justify-between">
                      <span className="text-xs truncate" style={{ color: tp(dark) }}>{ar ? (t.nameAr ?? t.name) : t.name}</span>
                      <div className="flex items-center gap-2">
                        {t.active > 0 && <span className="text-[10px] px-1.5 rounded-full" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>{t.active}</span>}
                        <span className="text-xs font-semibold" style={{ color: tp(dark) }}>{t.total}</span>
                      </div>
                    </div>
                  ))}
                  {dashboard.byType.length === 0 && <p className="text-xs" style={{ color: T.faint }}>—</p>}
                </div>

                {/* By Severity */}
                <div className="rounded-2xl p-4"
                  style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
                  <p className="text-xs font-semibold mb-3" style={{ color: tsColor(dark) }}>{ar ? 'بحسب الخطورة' : 'By Severity'}</p>
                  <div className="space-y-3">
                    {['critical','high','medium','low'].map(sv => {
                      const s = dashboard.bySeverity.find(x => x.severity === sv);
                      const meta = SEV[sv];
                      const pct = dashboard.summary.total > 0 ? Math.round((s?.total ?? 0) / dashboard.summary.total * 100) : 0;
                      return (
                        <div key={sv}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-medium" style={{ color: meta.color }}>{ar ? meta.ar : meta.en}</span>
                            <span className="text-[11px]" style={{ color: tsColor(dark) }}>{s?.total ?? 0} ({pct}%)</span>
                          </div>
                          <div className="h-1.5 rounded-full" style={{ background: T.panel }}>
                            <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: meta.color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Top RTA Handlers */}
                <div className="rounded-2xl p-4"
                  style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
                  <p className="text-xs font-semibold mb-3" style={{ color: tsColor(dark) }}>{ar ? 'أعلى مستجيبين RTA' : 'Top RTA Handlers'}</p>
                  {dashboard.topHandlers.length === 0
                    ? <p className="text-xs" style={{ color: T.faint }}>—</p>
                    : dashboard.topHandlers.map((h, i) => (
                      <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-0"
                        style={{ borderColor: T.bdr }}>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] w-4 text-center font-bold" style={{ color: T.faint }}>#{i+1}</span>
                          <span className="text-xs" style={{ color: tp(dark) }}>{h.name}</span>
                        </div>
                        <div className="text-[11px] text-end">
                          <span className="font-semibold" style={{ color: '#818cf8' }}>{h.handled}</span>
                          {h.avgDurationMin && <span className="ms-1.5" style={{ color: T.faint }}>avg {fmtDur(h.avgDurationMin)}</span>}
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-sm" style={{ color: T.faint }}>
              {ar ? 'لا توجد بيانات' : 'No data available'}
            </div>
          )}
        </div>
      )}

      {/* ══════════════ LIST TABS (active / all) ════════════════════════ */}
      {(tab === 'active' || tab === 'all') && (
        <div className="space-y-3">
          {/* Filters */}
          {tab === 'all' && (
            <div className="flex items-center gap-2 flex-wrap">
              <Filter size={12} style={{ color: T.faint }} />
              {['','reported','validated','in_progress','resolved','closed'].map(s => (
                <button key={s} onClick={() => { setStatus(s); setPage(1); }}
                  className="px-3 py-1 rounded-lg text-xs transition-all"
                  style={{
                    background: statusFilter === s ? 'rgba(99,102,241,0.2)' : T.panel,
                    border: statusFilter === s ? '1px solid rgba(99,102,241,0.35)' : `1px solid ${T.bdr}`,
                    color: statusFilter === s ? '#818cf8' : tsColor(dark),
                  }}>
                  {!s ? (ar ? 'الكل' : 'All') : (ar ? (ST[s]?.ar ?? s) : (ST[s]?.en ?? s))}
                </button>
              ))}
              <div style={{ width:1, height:14, background:T.bdr }} />
              {['','critical','high','medium','low'].map(sv => (
                <button key={sv} onClick={() => { setSev(sv); setPage(1); }}
                  className="px-3 py-1 rounded-lg text-xs transition-all"
                  style={{
                    background: sevFilter === sv ? `${SEV[sv]?.color ?? '#818cf8'}22` : T.panel,
                    border: sevFilter === sv ? `1px solid ${SEV[sv]?.color ?? '#818cf8'}45` : `1px solid ${T.bdr}`,
                    color: sevFilter === sv ? (SEV[sv]?.color ?? '#818cf8') : tsColor(dark),
                  }}>
                  {!sv ? (ar ? 'الكل' : 'All') : (ar ? SEV[sv].ar : SEV[sv].en)}
                </button>
              ))}
              <button onClick={load} className="ms-auto" style={{ color: T.faint }}>
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          )}

          {/* List */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin" style={{ color: T.faint }} />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-sm" style={{ color: '#f87171' }}>
              <WifiOff size={22} className="mx-auto mb-2" />
              {ar ? 'تعذر التحميل' : 'Failed to load'}
            </div>
          ) : outages.length === 0 ? (
            <div className="text-center py-16">
              <CheckCircle2 size={30} className="mx-auto mb-2" style={{ color: '#34d399' }} />
              <p className="text-sm" style={{ color: '#34d399' }}>
                {ar ? 'لا توجد أعطال' : 'No outages found'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {outages.map(o => {
                const sv = SEV[o.severity] ?? SEV.medium;
                const st = ST[o.status]   ?? ST.reported;
                const isActive = !['resolved','closed'].includes(o.status);
                return (
                  <div key={o.id} className="rounded-2xl overflow-hidden cursor-pointer transition-all hover:scale-[1.002]"
                    style={{ background:T.panel, border:`1px solid ${isActive ? sv.color+'30' : T.bdr}` }}
                    onClick={() => openDetail(o.id)}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: sv.color, boxShadow: isActive ? `0 0 7px ${sv.color}80` : 'none' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold" style={{ color: tp(dark) }}>{o.title}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: st.bg, color: st.color }}>{ar ? st.ar : st.en}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: sv.bg, color: sv.color }}>{ar ? sv.ar : sv.en}</span>
                          <SlaTag slaDueAt={o.slaDueAt} slaBreached={o.slaBreached} slaRemainingMin={o.slaRemainingMin} ar={ar} />
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap" style={{ fontSize: 11, color: T.faint }}>
                          {(o.typeName || o.typeNameAr) && <span>{ar ? (o.typeNameAr ?? o.typeName) : (o.typeName ?? o.typeNameAr)}</span>}
                          {o.handlerName && <span className="flex items-center gap-1"><User size={9} />{o.handlerName}</span>}
                          <span>{fmtDt(o.startedAt)}</span>
                          {o.durationMinutes && <span><Clock size={9} className="inline me-0.5" />{fmtDur(o.durationMinutes)}</span>}
                          {o.notesCount > 0 && <span className="flex items-center gap-1"><MessageSquare size={9} />{o.notesCount}</span>}
                          {o.attachmentsCount > 0 && <span className="flex items-center gap-1"><Paperclip size={9} />{o.attachmentsCount}</span>}
                        </div>
                      </div>
                      <ChevronRight size={14} style={{ color: T.faint, flexShrink: 0 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {total > 20 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              {Array.from({ length: Math.min(Math.ceil(total / 20), 10) }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => setPage(p)}
                  className="w-8 h-8 rounded-lg text-xs font-medium"
                  style={{ background: p === page ? 'rgba(99,102,241,0.25)' : T.panel, color: p === page ? '#818cf8' : tsColor(dark), border: p === page ? '1px solid rgba(99,102,241,0.35)' : `1px solid ${T.bdr}` }}>
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════ REPORT TAB ═══════════════════════════════════════ */}
      {tab === 'report' && (
        <ReportTab ar={ar} types={types} />
      )}

      {/* ══════════════ DETAIL PANEL ══════════════════════════════════════ */}
      {(detailLoading || detail) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: T.overlay, backdropFilter: 'blur(10px)' }}
          onClick={() => !detailLoading && setDetail(null)}>
          <div className="w-full flex flex-col overflow-hidden"
            style={{ maxWidth: 1100, maxHeight: '92vh', background: 'var(--surface)', borderRadius: 24, border: `1px solid ${T.bdr}`, boxShadow: '0 40px 100px rgba(0,0,0,0.7)' }}
            onClick={e => e.stopPropagation()}>

            {detailLoading ? (
              <div className="flex items-center justify-center flex-1">
                <Loader2 size={28} className="animate-spin" style={{ color: T.faint }} />
              </div>
            ) : detail && (() => {
              const sv = SEV[detail.severity] ?? SEV.high;
              const st = ST[detail.status]   ?? ST.reported;
              const isActive = !['resolved','closed'].includes(detail.status);
              return (
                <>
                  {/* ── Colored severity top strip ── */}
                  <div className="h-1 flex-shrink-0" style={{ background: `linear-gradient(90deg,${sv.color},${sv.color}44,transparent)` }} />

                  {/* ── Header ── */}
                  <div className="flex-shrink-0 px-6 pt-5 pb-4"
                    style={{ background:`linear-gradient(180deg,${sv.color}10 0%,transparent 100%)`, borderBottom:`1px solid ${T.bdr}` }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Badges row */}
                        <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                          <span className="inline-flex items-center gap-1 text-[10px] px-2.5 py-0.5 rounded-full font-semibold"
                            style={{ background:st.bg, color:st.color, border:`1px solid ${st.color}33` }}>
                            {isActive && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background:st.color }} />}
                            {ar ? st.ar : st.en}
                          </span>
                          <span className="text-[10px] px-2.5 py-0.5 rounded-full font-semibold"
                            style={{ background:sv.bg, color:sv.color, border:`1px solid ${sv.color}33` }}>
                            {ar ? sv.ar : sv.en}
                          </span>
                          {(detail.typeName || detail.typeNameAr) && (
                            <span className="text-[10px] px-2.5 py-0.5 rounded-full"
                              style={{ background:T.panel, color:tsColor(dark), border:`1px solid ${T.bdr}` }}>
                              {ar ? (detail.typeNameAr ?? detail.typeName) : (detail.typeName ?? detail.typeNameAr)}
                            </span>
                          )}
                          <SlaTag slaDueAt={detail.slaDueAt} slaBreached={detail.slaBreached} slaRemainingMin={detail.slaRemainingMin} ar={ar} />
                        </div>
                        <h2 className="text-lg font-bold leading-tight" style={{ color: tp(dark) }}>{detail.title}</h2>
                      </div>
                      <button onClick={() => setDetail(null)}
                        className="p-2 rounded-xl transition-colors flex-shrink-0 mt-0.5"
                        style={{ background:T.panel, border:`1px solid ${T.bdr}` }}>
                        <X size={15} style={{ color: T.faint }} />
                      </button>
                    </div>

                    {/* Quick stat strip */}
                    <div className="flex items-center gap-4 mt-3 pt-3" style={{ borderTop:`1px solid ${T.bdr}` }}>
                      {[
                        { label:ar?'بدأ':'Started', val:fmtDt(detail.startedAt), c:tsColor(dark) },
                        { label:ar?'المدة':'Duration', val:fmtDur(detail.durationMinutes), c:detail.durationMinutes && detail.durationMinutes>60?'#fb923c':tsColor(dark) },
                        { label:ar?'SLA':'SLA', val:detail.slaTargetMinutes?`${detail.slaTargetMinutes}m`:'—', c:tsColor(dark) },
                        { label:ar?'المعالج':'Handler', val:detail.handlerName ?? (ar?'غير محدد':'—'), c:'#818cf8' },
                      ].map(s => (
                        <div key={s.label} className="flex flex-col gap-0.5">
                          <span className="text-[9px] uppercase tracking-wider" style={{ color:tsColor(dark) }}>{s.label}</span>
                          <span className="text-xs font-semibold" style={{ color:s.c }}>{s.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Two-column body ── */}
                  <div className="flex flex-1 overflow-hidden">

                    {/* ════ LEFT COLUMN — content ════ */}
                    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4" style={{ scrollbarWidth:'thin', borderRight:`1px solid ${T.bdr}`, minWidth:0 }}>

                      {/* Info blocks */}
                      {detail.description && (
                        <div className="rounded-2xl overflow-hidden" style={{ border:`1px solid ${T.bdr}` }}>
                          <div className="px-4 py-2.5 flex items-center gap-2" style={{ background:T.panel, borderBottom:`1px solid ${T.bdr}` }}>
                            <FileText size={11} style={{ color:'#60a5fa' }} />
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'#60a5fa' }}>{ar?'الوصف':'Description'}</span>
                          </div>
                          <div className="px-4 py-3">
                            <p className="text-sm leading-relaxed" style={{ color:tsColor(dark) }}>{detail.description}</p>
                          </div>
                        </div>
                      )}

                      {detail.impactDescription && (
                        <div className="rounded-2xl overflow-hidden" style={{ border:'1px solid rgba(251,146,60,0.2)' }}>
                          <div className="px-4 py-2.5 flex items-center gap-2" style={{ background:'rgba(251,146,60,0.06)', borderBottom:'1px solid rgba(251,146,60,0.12)' }}>
                            <AlertTriangle size={11} style={{ color:'#fb923c' }} />
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'#fb923c' }}>{ar?'أثر العطل':'Impact'}</span>
                          </div>
                          <div className="px-4 py-3">
                            <p className="text-sm leading-relaxed" style={{ color:tp(dark) }}>{detail.impactDescription}</p>
                          </div>
                        </div>
                      )}

                      {detail.rootCause && (
                        <div className="rounded-2xl overflow-hidden" style={{ border:'1px solid rgba(251,191,36,0.2)' }}>
                          <div className="px-4 py-2.5 flex items-center gap-2" style={{ background:'rgba(251,191,36,0.06)', borderBottom:'1px solid rgba(251,191,36,0.12)' }}>
                            <Eye size={11} style={{ color:'#fbbf24' }} />
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'#fbbf24' }}>{ar?'السبب الجذري':'Root Cause'}</span>
                          </div>
                          <div className="px-4 py-3">
                            <p className="text-sm leading-relaxed" style={{ color:tp(dark) }}>{detail.rootCause}</p>
                          </div>
                        </div>
                      )}

                      {detail.resolution && (
                        <div className="rounded-2xl overflow-hidden" style={{ border:'1px solid rgba(52,211,153,0.25)' }}>
                          <div className="px-4 py-2.5 flex items-center gap-2" style={{ background:'rgba(52,211,153,0.07)', borderBottom:'1px solid rgba(52,211,153,0.15)' }}>
                            <CheckCircle2 size={11} style={{ color:'#34d399' }} />
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'#34d399' }}>{ar?'الحل':'Resolution'}</span>
                          </div>
                          <div className="px-4 py-3">
                            <p className="text-sm leading-relaxed" style={{ color:'#86efac' }}>{detail.resolution}</p>
                          </div>
                        </div>
                      )}

                      {/* Notes */}
                      <div className="rounded-2xl overflow-hidden" style={{ border:`1px solid ${T.bdr}` }}>
                        <div className="px-4 py-2.5 flex items-center justify-between" style={{ background:T.panel, borderBottom:`1px solid ${T.bdr}` }}>
                          <div className="flex items-center gap-2">
                            <MessageSquare size={11} style={{ color:'#818cf8' }} />
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'#818cf8' }}>
                              {ar ? `ملاحظات (${detail.notes.length})` : `Notes (${detail.notes.length})`}
                            </span>
                          </div>
                        </div>
                        <div className="divide-y" style={{ borderColor:T.bdr }}>
                          {detail.notes.length === 0 && (
                            <p className="text-xs py-4 text-center" style={{ color:T.faint }}>
                              {ar?'لا توجد ملاحظات بعد':'No notes yet'}
                            </p>
                          )}
                          {detail.notes.map(n => (
                            <div key={n.id}>
                              <div className="flex items-center justify-between px-4 py-2"
                                style={{ background: n.isInternal ? 'rgba(99,102,241,0.05)' : 'rgba(34,197,94,0.05)' }}>
                                <span className="text-[10px] font-semibold" style={{ color: n.isInternal ? '#818cf8' : '#4ade80' }}>
                                  {n.authorName}
                                  <span className="ms-1.5 font-normal opacity-60">
                                    · {n.isInternal ? (ar?'داخلي':'Internal') : (ar?'عام':'Public')}
                                  </span>
                                </span>
                                <span className="text-[10px]" style={{ color:T.faint }}>{fmtDt(n.createdAt)}</span>
                              </div>
                              <div className="px-4 py-2.5">
                                <p className="text-xs leading-relaxed" style={{ color:tsColor(dark) }}>{n.content}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                        {/* Add note inline */}
                        <div style={{ borderTop:`1px solid ${T.bdr}` }}>
                          <textarea
                            value={noteText}
                            onChange={e => setNoteText(e.target.value)}
                            rows={2} placeholder={ar?'اكتب ملاحظة...':'Write a note...'}
                            className="w-full text-xs px-4 py-3 outline-none resize-none bg-transparent"
                            style={{ color:tp(dark) }} />
                          <div className="flex items-center justify-between px-4 py-2"
                            style={{ borderTop:`1px solid ${T.bdr}`, background:T.panel }}>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input type="checkbox" checked={noteInternal} onChange={e => setNoteInt(e.target.checked)} className="w-3 h-3 accent-indigo-500" />
                              <span className="text-[10px]" style={{ color:T.faint }}>{ar?'داخلي':'Internal'}</span>
                            </label>
                            <button onClick={submitNote} disabled={noteSubmitting || !noteText.trim()}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-30"
                              style={{ background:'rgba(99,102,241,0.15)', border:'1px solid rgba(99,102,241,0.28)', color:'#818cf8' }}>
                              {noteSubmitting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                              {ar?'إرسال':'Send'}
                            </button>
                          </div>
                        </div>
                      </div>

                    </div>

                    {/* ════ RIGHT COLUMN — meta + actions ════ */}
                    <div className="w-[320px] flex-shrink-0 overflow-y-auto px-5 py-5 space-y-4" style={{ scrollbarWidth:'thin' }}>

                      {/* Share button — closes detail first so modals don't stack */}
                      <button onClick={() => { setShareOutage(detail); setDetail(null); }}
                        className="w-full flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-bold justify-center transition-all hover:scale-[1.02]"
                        style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.2),rgba(99,102,241,0.08))', border:'1px solid rgba(99,102,241,0.35)', color:'#818cf8', boxShadow:'0 4px 20px rgba(99,102,241,0.15)' }}>
                        <Share2 size={15} /> {ar?'مشاركة / تصدير':'Share / Export'}
                      </button>

                      {/* Details card */}
                      <div className="rounded-2xl overflow-hidden" style={{ border:`1px solid ${T.bdr}` }}>
                        <div className="px-4 py-2.5" style={{ background:T.panel, borderBottom:`1px solid ${T.bdr}` }}>
                          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color:T.faint }}>{ar?'التفاصيل':'Details'}</span>
                        </div>
                        <div className="divide-y" style={{ borderColor:T.bdr }}>
                          {[
                            { l:ar?'النوع':'Type',             v:ar?(detail.typeNameAr??detail.typeName):(detail.typeName??detail.typeNameAr) ?? '—', c:tsColor(dark) },
                            { l:ar?'الخطورة':'Severity',        v:ar?(SEV[detail.severity]?.ar):(SEV[detail.severity]?.en), c:sv.color },
                            { l:ar?'الحالة':'Status',           v:ar?st.ar:st.en, c:st.color },
                            { l:ar?'بدأ':'Started',             v:fmtDt(detail.startedAt), c:tsColor(dark) },
                            { l:ar?'انتهى':'Ended',              v:detail.endedAt ? fmtDt(detail.endedAt) : '—', c:tsColor(dark) },
                            { l:ar?'المدة':'Duration',           v:fmtDur(detail.durationMinutes), c:detail.durationMinutes && detail.durationMinutes > 60 ? '#fb923c' : tsColor(dark) },
                            { l:ar?'هدف SLA':'SLA Target',      v:detail.slaTargetMinutes ? `${detail.slaTargetMinutes}m` : '—', c:tsColor(dark) },
                            { l:ar?'مُبلَّغ بواسطة':'Reported By', v:detail.reportedByName ?? '—', c:tsColor(dark) },
                            { l:ar?'المعالج':'Handler (RTA)',    v:detail.handlerName ?? (ar?'غير محدد':'—'), c:'#818cf8' },
                          ].map(d => (
                            <div key={d.l} className="flex items-center justify-between px-4 py-2.5">
                              <span className="text-[11px]" style={{ color:T.faint }}>{d.l}</span>
                              <span className="text-[11px] font-semibold" style={{ color:d.c }}>{d.v}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Status actions */}
                      {!['resolved','closed'].includes(detail.status) && (
                        <div className="rounded-2xl overflow-hidden" style={{ border:`1px solid ${T.bdr}` }}>
                          <div className="px-4 py-2.5" style={{ background:T.panel, borderBottom:`1px solid ${T.bdr}` }}>
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color:T.faint }}>{ar?'تحديث الحالة':'Update Status'}</span>
                          </div>
                          <div className="p-3 space-y-2">
                            {detail.status === 'reported' && (
                              <button onClick={() => updateStatus(detail.id, 'validated')} disabled={updatingId === detail.id}
                                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold disabled:opacity-40 justify-center"
                                style={{ background:'rgba(251,146,60,0.1)', border:'1px solid rgba(251,146,60,0.25)', color:'#fb923c' }}>
                                {updatingId === detail.id ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
                                {ar?'تحقق من العطل':'Validate Outage'}
                              </button>
                            )}
                            {['reported','validated'].includes(detail.status) && (
                              <button onClick={() => updateStatus(detail.id, 'in_progress')} disabled={updatingId === detail.id}
                                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold disabled:opacity-40 justify-center"
                                style={{ background:'rgba(251,191,36,0.1)', border:'1px solid rgba(251,191,36,0.25)', color:'#fbbf24' }}>
                                {updatingId === detail.id ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
                                {ar?'جاري المعالجة':'Mark In Progress'}
                              </button>
                            )}
                            <div className="rounded-xl overflow-hidden" style={{ border:'1px solid rgba(52,211,153,0.2)' }}>
                              <input
                                value={resolveText}
                                onChange={e => setResolveText(e.target.value)}
                                placeholder={ar?'وصف الحل...':'Resolution note...'}
                                className="w-full text-xs px-3 py-2.5 bg-transparent outline-none"
                                style={{ color:tp(dark), borderBottom:'1px solid rgba(52,211,153,0.12)' }} />
                              <button
                                disabled={updatingId === detail.id || !resolveText.trim()}
                                onClick={() => {
                                  updateStatus(detail.id, 'resolved', { resolution: resolveText, endedAt: new Date().toISOString() });
                                  setResolveText('');
                                }}
                                className="w-full flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold disabled:opacity-30 justify-center"
                                style={{ background:'rgba(52,211,153,0.07)', color:'#34d399' }}>
                                {updatingId === detail.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                                {ar?'إغلاق وحل العطل':'Resolve & Close'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Attachments */}
                      <div className="rounded-2xl overflow-hidden" style={{ border:`1px solid ${T.bdr}` }}>
                        <div className="px-4 py-2.5 flex items-center justify-between" style={{ background:T.panel, borderBottom:`1px solid ${T.bdr}` }}>
                          <div className="flex items-center gap-2">
                            <Paperclip size={11} style={{ color:'#fbbf24' }} />
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'#fbbf24' }}>
                              {ar ? `مرفقات (${detail.attachments.length})` : `Files (${detail.attachments.length})`}
                            </span>
                          </div>
                          <button onClick={() => fileRef.current?.click()} disabled={uploading}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold disabled:opacity-40"
                            style={{ background:'rgba(251,191,36,0.1)', border:'1px solid rgba(251,191,36,0.2)', color:'#fbbf24' }}>
                            {uploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
                            {ar?'رفع':'Upload'}
                          </button>
                          <input ref={fileRef} type="file" className="hidden" accept="image/*,video/*,.pdf" onChange={handleFileChange} />
                        </div>
                        {detail.attachments.length === 0 ? (
                          <p className="text-xs py-5 text-center" style={{ color:T.faint }}>
                            {ar?'لا توجد مرفقات':'No attachments yet'}
                          </p>
                        ) : (
                          <div className="grid grid-cols-3 gap-2 p-3">
                            {detail.attachments.map(a => (
                              <div key={a.id} className="relative rounded-xl overflow-hidden group"
                                style={{ background:T.panel, border:`1px solid ${T.bdr}`, aspectRatio:'1' }}>
                                {a.isImage ? (
                                  <img src={a.url} alt={a.originalName} className="w-full h-full object-cover cursor-pointer" onClick={() => setLightbox(a)} />
                                ) : a.isVideo ? (
                                  <video src={a.url} className="w-full h-full object-cover cursor-pointer" onClick={() => setLightbox(a)} />
                                ) : (
                                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2">
                                    <FileText size={18} style={{ color:tsColor(dark) }} />
                                    <span className="text-[9px] text-center leading-tight truncate w-full" style={{ color:T.faint }}>{a.originalName}</span>
                                  </div>
                                )}
                                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-1.5"
                                  style={{ background:'linear-gradient(to top,rgba(0,0,0,0.7),transparent)' }}>
                                  <span className="text-[9px]" style={{ color:tp(dark) }}>{fmtSize(a.fileSize)}</span>
                                  <div className="flex gap-1">
                                    <a href={a.url} download={a.originalName} className="p-1 rounded-lg" style={{ background:'rgba(255,255,255,0.15)' }} onClick={e => e.stopPropagation()}>
                                      <Download size={9} style={{ color:'#fff' }} />
                                    </a>
                                    <button className="p-1 rounded-lg" style={{ background:'rgba(239,68,68,0.3)' }} onClick={e => { e.stopPropagation(); deleteAttachment(a.id); }}>
                                      <Trash2 size={9} style={{ color:'#fca5a5' }} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Share / Export Modal ────────────────────────────────────────── */}
      {shareOutage && (
        <ShareModal outage={shareOutage} ar={ar} onClose={() => setShareOutage(null)} />
      )}

      {/* ── Lightbox ────────────────────────────────────────────────────── */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.92)' }}
          onClick={() => setLightbox(null)}>
          {lightbox.isImage && <img src={lightbox.url} alt={lightbox.originalName} className="max-w-full max-h-full rounded-xl object-contain" onClick={e => e.stopPropagation()} />}
          {lightbox.isVideo && <video src={lightbox.url} controls autoPlay className="max-w-full max-h-full rounded-xl" onClick={e => e.stopPropagation()} />}
          <button className="absolute top-4 end-4 p-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <X size={18} style={{ color: '#fff' }} />
          </button>
        </div>
      )}

      {/* ── Create Form Modal ────────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: T.overlay, backdropFilter: 'blur(8px)' }}
          onClick={() => { setShowForm(false); setFormError(''); }}>
          <div className="w-full max-w-lg rounded-3xl p-6 overflow-y-auto max-h-[90vh]"
            style={{ background: 'var(--surface)', border: `1px solid ${T.bdr}`, boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold" style={{ color: tp(dark) }}>
                {ar ? 'إبلاغ عن عطل جديد' : 'Report New Outage'}
              </h2>
              <button
                onClick={() => { setShowForm(false); setFormError(''); }}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-white/10"
                style={{ border: `1px solid ${T.bdr}` }}>
                <X size={15} style={{ color: tsColor(dark) }} />
              </button>
            </div>
            <div className="space-y-3">
              <Fld label={ar?'العنوان *':'Title *'}>
                <input value={form.title} onChange={e => setForm(f=>({...f,title:e.target.value}))}
                  placeholder={ar?'وصف مختصر للعطل...':'Brief description...'} className="inp" />
              </Fld>
              <div className="grid grid-cols-2 gap-3">
                <Fld label={ar?'النوع *':'Type *'}>
                  <select value={form.outageTypeId} onChange={e => setForm(f=>({...f,outageTypeId:e.target.value}))} className="inp">
                    <option value="">{ar?'-- اختر --':'-- Select --'}</option>
                    {types.map(t => <option key={t.id} value={t.id}>{ar?(t.name_ar||t.name):t.name}</option>)}
                  </select>
                </Fld>
                <Fld label={ar?'الخطورة *':'Severity *'}>
                  <select value={form.severity} onChange={e => setForm(f=>({...f,severity:e.target.value}))} className="inp">
                    {['critical','high','medium','low'].map(s => (
                      <option key={s} value={s}>{ar?SEV[s].ar:SEV[s].en}</option>
                    ))}
                  </select>
                </Fld>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Fld label={ar?'وقت البداية *':'Started At *'}>
                  <input type="datetime-local" value={form.startedAt}
                    onChange={e => setForm(f=>({...f,startedAt:e.target.value}))} className="inp" />
                </Fld>
                <Fld label={ar?'SLA (دقيقة) — اختياري':'SLA Target (min) — optional'}>
                  <input type="number" min={1} max={1440} value={form.slaTargetMinutes}
                    onChange={e => setForm(f=>({...f,slaTargetMinutes:e.target.value}))}
                    placeholder={ar?'مثال: 60':'e.g. 60'} className="inp" />
                </Fld>
              </div>
              <Fld label={ar?'الوصف':'Description'}>
                <textarea value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))}
                  rows={2} className="inp" />
              </Fld>
              <Fld label={ar?'أثر العطل':'Impact Description'}>
                <textarea value={form.impactDescription} onChange={e => setForm(f=>({...f,impactDescription:e.target.value}))}
                  rows={2} className="inp" />
              </Fld>
              <Fld label={ar?'الوظائف المتضررة':'Impacted Functions'}>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {funcs.map(fn => (
                    <button key={fn.id} type="button" onClick={() => toggleFunc(fn.id)}
                      className="px-2.5 py-1 rounded-lg text-xs transition-all"
                      style={{
                        background: form.impactedFunctionIds.includes(fn.id) ? 'rgba(251,191,36,0.2)' : T.panel,
                        border: form.impactedFunctionIds.includes(fn.id) ? '1px solid rgba(251,191,36,0.4)' : `1px solid ${T.bdr}`,
                        color: form.impactedFunctionIds.includes(fn.id) ? '#fbbf24' : tsColor(dark),
                      }}>
                      {fn.name}
                    </button>
                  ))}
                </div>
              </Fld>
              {formError && (
                <div className="rounded-xl px-3 py-2 text-xs" style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.25)', color:'#fca5a5' }}>
                  {formError}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => { setShowForm(false); setFormError(''); }} className="px-4 py-2 rounded-xl text-sm" style={{ color: tsColor(dark) }}>
                  {ar?'إلغاء':'Cancel'}
                </button>
                <button onClick={submit} disabled={saving || !form.title || !form.outageTypeId || !form.startedAt}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                  style={{ background:'rgba(239,68,68,0.2)', border:'1px solid rgba(239,68,68,0.35)', color:'#f87171' }}>
                  {saving && <Loader2 size={12} className="animate-spin" />}
                  {ar?'إبلاغ':'Submit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function InfoBlock({ label, text, color }: { label: string; text: string; color?: string }) {
  const { dark } = useUiStore();
  const T = tok(dark);
  return (
    <div className="rounded-xl p-3" style={{ background:T.panel, border:`1px solid ${T.bdr}` }}>
      <p className="text-[10px] mb-1" style={{ color: T.faint }}>{label}</p>
      <p className="text-xs leading-relaxed" style={{ color: color ?? tsColor(dark) }}>{text}</p>
    </div>
  );
}

function ActionBtn({ label, color, onClick, loading }: { label: string; color: string; onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium disabled:opacity-40"
      style={{ background: `${color}18`, border: `1px solid ${color}35`, color }}>
      {loading ? <Loader2 size={11} className="animate-spin" /> : <Shield size={11} />}
      {label}
    </button>
  );
}

function ResolveInlinePanel({ outageId: _, ar, loading, onResolve }: {
  outageId: string; ar: boolean; loading: boolean; onResolve: (res: string) => void;
}) {
  const [res, setRes] = useState('');
  return (
    <div className="flex items-center gap-2 w-full mt-1">
      <input value={res} onChange={e => setRes(e.target.value)}
        placeholder={ar?'وصف الحل...':'Resolution note...'} className="inp flex-1 text-xs" />
      <button onClick={() => onResolve(res)} disabled={loading || !res.trim()}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium disabled:opacity-40 flex-shrink-0"
        style={{ background:'rgba(52,211,153,0.15)', border:'1px solid rgba(52,211,153,0.3)', color:'#34d399' }}>
        {loading ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
        {ar?'حلّ':'Resolve'}
      </button>
    </div>
  );
}

// ─── Report Tab ───────────────────────────────────────────────────────────────
function ReportTab({ ar, types }: { ar: boolean; types: OutageType[] }) {
  const { dark } = useUiStore();
  const T = tok(dark);
  const [from, setFrom]         = useState('');
  const [to, setTo]             = useState('');
  const [status, setStatus]     = useState('');
  const [severity, setSev]      = useState('');
  const [rows, setRows]         = useState<Outage[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { limit: 200 };
      if (from)     params.from = new Date(from).toISOString();
      if (to)       params.to   = new Date(to).toISOString();
      if (status)   params.status   = status;
      if (severity) params.severity = severity;
      const { data } = await apiClient.get('/outages/report', { params });
      setRows(data.data ?? []); setTotal(data.total ?? 0);
    } catch {}
    setLoading(false);
  }, [from, to, status, severity]);

  useEffect(() => { run(); }, [run]);

  const slaBreachedCount = rows.filter(r => r.slaBreached).length;
  const avgDuration = rows.filter(r => r.durationMinutes).reduce((s, r) => s + (r.durationMinutes ?? 0), 0) / (rows.filter(r => r.durationMinutes).length || 1);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-2xl p-4 flex flex-wrap items-end gap-3"
        style={{ background:T.panel, border:`1px solid ${T.bdr}` }}>
        <div>
          <p className="text-[10px] mb-1" style={{ color:T.faint }}>{ar?'من':'From'}</p>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="inp text-xs" />
        </div>
        <div>
          <p className="text-[10px] mb-1" style={{ color:T.faint }}>{ar?'إلى':'To'}</p>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="inp text-xs" />
        </div>
        <div>
          <p className="text-[10px] mb-1" style={{ color:T.faint }}>{ar?'الحالة':'Status'}</p>
          <select value={status} onChange={e => setStatus(e.target.value)} className="inp text-xs">
            <option value="">{ar?'الكل':'All'}</option>
            {['reported','validated','in_progress','resolved','closed'].map(s => (
              <option key={s} value={s}>{ar?(ST[s]?.ar??s):(ST[s]?.en??s)}</option>
            ))}
          </select>
        </div>
        <div>
          <p className="text-[10px] mb-1" style={{ color:T.faint }}>{ar?'الخطورة':'Severity'}</p>
          <select value={severity} onChange={e => setSev(e.target.value)} className="inp text-xs">
            <option value="">{ar?'الكل':'All'}</option>
            {['critical','high','medium','low'].map(s => (
              <option key={s} value={s}>{ar?SEV[s].ar:SEV[s].en}</option>
            ))}
          </select>
        </div>
        <button onClick={run} disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium"
          style={{ background:'rgba(99,102,241,0.15)', border:'1px solid rgba(99,102,241,0.3)', color:'#818cf8' }}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
          {ar?'عرض':'Run Report'}
        </button>
      </div>

      {/* Summary row */}
      {rows.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap text-xs px-1">
          <span style={{ color:tsColor(dark) }}>{ar?`${total} سجل`:`${total} records`}</span>
          <span style={{ color:'#f87171' }}>{ar?`${slaBreachedCount} تجاوز SLA`:`${slaBreachedCount} SLA breached`}</span>
          <span style={{ color:'#fbbf24' }}>{ar?`متوسط المدة: ${fmtDur(Math.round(avgDuration))}`:`Avg duration: ${fmtDur(Math.round(avgDuration))}`}</span>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin" style={{ color:T.faint }} />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-sm" style={{ color:T.faint }}>
          {ar?'لا توجد نتائج':'No results'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl" style={{ border:`1px solid ${T.bdr}` }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background:T.panel, borderBottom:`1px solid ${T.bdr}` }}>
                {[ar?'العنوان':'Title', ar?'النوع':'Type', ar?'الخطورة':'Sev', ar?'الحالة':'Status',
                  ar?'المعالج':'Handler', ar?'البداية':'Started', ar?'المدة':'Duration', 'SLA'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-start font-medium" style={{ color:T.faint, whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const sv = SEV[r.severity] ?? SEV.medium;
                const st = ST[r.status]   ?? ST.reported;
                return (
                  <tr key={r.id} className="border-b hover:bg-white/[0.02]"
                    style={{ borderColor:T.bdr }}>
                    <td className="px-3 py-2.5 max-w-[200px] truncate" style={{ color:tp(dark) }}>{r.title}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color:tsColor(dark) }}>{ar?(r.typeNameAr??r.typeName):(r.typeName??r.typeNameAr) ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background:sv.bg, color:sv.color }}>{ar?sv.ar:sv.en}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background:st.bg, color:st.color }}>{ar?st.ar:st.en}</span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color:tsColor(dark) }}>{r.handlerName ?? '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color:tsColor(dark) }}>{fmtDt(r.startedAt)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono" style={{ color:tsColor(dark) }}>{fmtDur(r.durationMinutes)}</td>
                    <td className="px-3 py-2.5">
                      {r.slaBreached
                        ? <span className="text-[10px] font-semibold" style={{ color:'#f87171' }}>{ar?'تجاوز':'Breached'}</span>
                        : r.slaDueAt
                          ? <span className="text-[10px]" style={{ color:'#34d399' }}>{ar?'ضمن الهدف':'On Time'}</span>
                          : <span style={{ color:T.faint }}>—</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  const { dark } = useUiStore();
  return (
    <div>
      <label className="block text-[11px] mb-1.5 font-medium" style={{ color: tsColor(dark) }}>{label}</label>
      {children}
    </div>
  );
}

// ─── Share Modal ─────────────────────────────────────────────────────────────
function ShareModal({ outage, ar, onClose }: { outage: OutageDetail; ar: boolean; onClose: () => void }) {
  const { dark } = useUiStore();
  const T = tok(dark);
  const [copied, setCopied] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);

  const SEV_AR: Record<string,string> = { low:'منخفض', medium:'متوسط', high:'عالي', critical:'حرج' };
  const ST_AR:  Record<string,string> = { reported:'مُبلَّغ', validated:'تم التحقق', in_progress:'جاري المعالجة', resolved:'محلول', closed:'مغلق' };

  const fmtDur = (m: number) => fmtDuration(m, ar);
  const fmtDt  = (iso: string) => fmtDateTime(iso, ar);

  const sevMeta = SEV[outage.severity] ?? { color:tsColor(dark), bg:'rgba(148,163,184,0.1)' };
  const images  = (outage.attachments ?? []).filter(a => a.isImage);
  const videos  = (outage.attachments ?? []).filter(a => a.isVideo);

  const summaryText = ar
    ? (
      `*[تنبيه عطل] ${outage.title}*\n` +
      `──────────────────────\n` +
      `*الخطورة:* ${SEV_AR[outage.severity] ?? outage.severity}\n` +
      `*الحالة:* ${ST_AR[outage.status] ?? outage.status}\n` +
      `*النوع:* ${outage.typeNameAr ?? outage.typeName ?? '—'}\n` +
      `*المعالج:* ${outage.handlerName ?? 'غير محدد'}\n` +
      `*البداية:* ${fmtDt(outage.startedAt)}\n` +
      (outage.endedAt ? `*النهاية:* ${fmtDt(outage.endedAt)}\n` : `*الحالة:* مستمر حتى الآن\n`) +
      (outage.durationMinutes ? `*المدة:* ${fmtDur(outage.durationMinutes)}\n` : '') +
      (outage.slaBreached ? `*SLA:* تجاوز الهدف\n` : `*SLA:* ضمن الهدف\n`) +
      (outage.impactedFunctions?.length ? `*الأقسام:* ${outage.impactedFunctions.join('، ')}\n` : '') +
      (outage.description ? `\n*الوصف:*\n${outage.description}\n` : '') +
      (outage.rootCause   ? `\n*السبب:* ${outage.rootCause}\n` : '') +
      (outage.resolution  ? `\n*الحل:* ${outage.resolution}\n` : '') +
      `\n──────────────────────\n_منصة WFM — Boutiqaat Contact Center_`
    )
    : (
      `*[Outage Alert] ${outage.title}*\n` +
      `──────────────────────\n` +
      `*Severity:* ${SEV[outage.severity]?.en ?? outage.severity}\n` +
      `*Status:* ${ST[outage.status]?.en ?? outage.status}\n` +
      `*Type:* ${outage.typeName ?? outage.typeNameAr ?? '—'}\n` +
      `*Handler:* ${outage.handlerName ?? 'Unassigned'}\n` +
      `*Started:* ${fmtDt(outage.startedAt)}\n` +
      (outage.endedAt ? `*Ended:* ${fmtDt(outage.endedAt)}\n` : `*Status:* Ongoing\n`) +
      (outage.durationMinutes ? `*Duration:* ${fmtDur(outage.durationMinutes)}\n` : '') +
      (outage.slaBreached ? `*SLA:* Breached\n` : `*SLA:* On Target\n`) +
      (outage.impactedFunctions?.length ? `*Functions:* ${outage.impactedFunctions.join(', ')}\n` : '') +
      (outage.description ? `\n*Description:*\n${outage.description}\n` : '') +
      (outage.rootCause   ? `\n*Root Cause:* ${outage.rootCause}\n` : '') +
      (outage.resolution  ? `\n*Resolution:* ${outage.resolution}\n` : '') +
      `\n──────────────────────\n_WFM Platform — Boutiqaat Contact Center_`
    );

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(summaryText)}`;
  const mailSubject = encodeURIComponent(
    ar ? `[عطل] ${SEV_AR[outage.severity] ?? ''} — ${outage.title}`
       : `[Outage] ${SEV[outage.severity]?.en ?? ''} — ${outage.title}`);
  const mailBody    = encodeURIComponent(summaryText);
  const mailUrl     = `mailto:?subject=${mailSubject}&body=${mailBody}`;

  const copyText = async () => {
    try { await navigator.clipboard.writeText(summaryText); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch {}
  };

  const openReport = async () => {
    setReportLoading(true);
    try {
      const res = await apiClient.get(`/outages/${outage.id}/share-report`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'text/html;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const win  = window.open(url, '_blank');
      // revoke after window loads to free memory
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      if (!win) alert(ar ? 'فعّل النوافذ المنبثقة لهذا الموقع' : 'Allow popups for this site');
    } catch {
      alert(ar ? 'فشل تحميل التقرير' : 'Failed to load report');
    }
    setReportLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background:T.overlay, backdropFilter:'blur(16px)' }}
      onClick={onClose}>
      <div className="w-full rounded-3xl flex flex-col relative"
        style={{ maxWidth: 520, background:'var(--surface)', border:`1px solid ${T.bdr}`, maxHeight:'92vh', boxShadow:'0 48px 96px rgba(0,0,0,0.8)', overflow:'hidden' }}
        onClick={e => e.stopPropagation()}>

        {/* ── Gradient header ─────────────────────────────────────────────── */}
        <div className="relative flex-shrink-0 px-5 pt-5 pb-4"
          style={{ background:`linear-gradient(135deg,${sevMeta.color}18 0%,rgba(99,102,241,0.06) 100%)`, borderBottom:`1px solid ${sevMeta.color}22` }}>
          <div className="absolute top-0 inset-x-0 h-0.5 rounded-t-3xl"
            style={{ background:`linear-gradient(90deg,${sevMeta.color},transparent)` }} />
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background:sevMeta.bg, border:`1px solid ${sevMeta.color}33` }}>
                <Zap size={16} style={{ color:sevMeta.color }} />
              </div>
              <div>
                <p className="text-[9px] font-bold tracking-widest uppercase mb-0.5" style={{ color:sevMeta.color }}>
                  {ar?'تقرير عطل':'Outage Report'}
                </p>
                <h2 className="text-sm font-bold leading-tight" style={{ color:tp(dark) }}>{outage.title}</h2>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-white/[0.06] flex-shrink-0 transition-colors mt-0.5">
              <X size={14} style={{ color:T.faint }} />
            </button>
          </div>
          {/* badges */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full"
              style={{ background:sevMeta.bg, color:sevMeta.color, border:`1px solid ${sevMeta.color}44` }}>
              {ar ? SEV_AR[outage.severity] : SEV[outage.severity]?.en ?? outage.severity}
            </span>
            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full"
              style={{ background:ST[outage.status]?.bg ?? 'rgba(100,116,139,0.12)', color:ST[outage.status]?.color ?? tsColor(dark), border:`1px solid ${ST[outage.status]?.color ?? tsColor(dark)}33` }}>
              {ar ? ST_AR[outage.status] : ST[outage.status]?.en ?? outage.status}
            </span>
            {outage.typeNameAr && (
              <span className="text-[10px] px-2.5 py-0.5 rounded-full"
                style={{ background:T.panel, color:tsColor(dark), border:`1px solid ${T.bdr}` }}>
                {ar ? outage.typeNameAr : outage.typeName}
              </span>
            )}
            {outage.slaBreached && (
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full"
                style={{ background:'rgba(239,68,68,0.12)', color:'#f87171', border:'1px solid rgba(239,68,68,0.25)' }}>
                ⚠ {ar?'تجاوز SLA':'SLA Breached'}
              </span>
            )}
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth:'thin', scrollbarColor:'rgba(255,255,255,0.15) transparent' }}>

          {/* ── Preview card ───────────────────────────────────────────────── */}
          <div className="mx-4 mt-4 rounded-2xl overflow-hidden"
            style={{ border:`1px solid ${T.bdr}`, background:T.panel }}>

            <div className="px-4 py-2 flex items-center gap-2"
              style={{ background:T.panel, borderBottom:`1px solid ${T.bdr}` }}>
              <Eye size={10} style={{ color:'#60a5fa' }} />
              <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color:'#60a5fa' }}>
                {ar?'معاينة ما سيُرسل':'Preview — what will be sent'}
              </span>
            </div>

            {/* Metrics 2×2 */}
            <div className="grid grid-cols-2 gap-px" style={{ background:T.panel }}>
              {[
                { icon:Clock,      label:ar?'بدأ':'Started',   val:fmtDt(outage.startedAt),                                                     c:tsColor(dark) },
                { icon:AlarmClock, label:ar?'المدة':'Duration', val:outage.durationMinutes ? fmtDur(outage.durationMinutes) : (ar?'مستمر':'Ongoing'), c:outage.durationMinutes && outage.durationMinutes>60?'#f87171':tsColor(dark) },
                { icon:User,       label:ar?'المعالج':'Handler', val:outage.handlerName ?? '—',                                                   c:'#818cf8' },
                { icon:BarChart2,  label:'SLA',                  val:outage.slaBreached?(ar?'تجاوز':'Breached'):(ar?'ضمن الهدف':'On Target'),     c:outage.slaBreached?'#f87171':'#34d399' },
              ].map(({ icon:Icon, label, val, c }) => (
                <div key={label} className="px-4 py-3" style={{ background:'var(--surface)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon size={9} style={{ color:T.faint }} />
                    <span className="text-[9px] uppercase tracking-wider" style={{ color:T.faint }}>{label}</span>
                  </div>
                  <span className="text-xs font-semibold" style={{ color:c }}>{val}</span>
                </div>
              ))}
            </div>

            {/* Impacted functions */}
            {outage.impactedFunctions?.length > 0 && (
              <div className="px-4 py-3" style={{ borderTop:`1px solid ${T.bdr}` }}>
                <p className="text-[9px] uppercase tracking-wider mb-2" style={{ color:tsColor(dark) }}>
                  {ar?'الأقسام المتأثرة':'Impacted Functions'}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {outage.impactedFunctions.map(fn => (
                    <span key={fn} className="text-[10px] px-2 py-0.5 rounded-lg"
                      style={{ background:'rgba(251,146,60,0.1)', color:'#fb923c', border:'1px solid rgba(251,146,60,0.2)' }}>
                      {fn}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            {outage.description && (
              <div className="px-4 py-3" style={{ borderTop:`1px solid ${T.bdr}` }}>
                <p className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color:tsColor(dark) }}>{ar?'الوصف':'Description'}</p>
                <p className="text-xs leading-relaxed" style={{ color:tsColor(dark) }}>{outage.description}</p>
              </div>
            )}

            {/* Root cause */}
            {outage.rootCause && (
              <div className="px-4 py-3" style={{ borderTop:`1px solid ${T.bdr}` }}>
                <p className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color:tsColor(dark) }}>{ar?'السبب الجذري':'Root Cause'}</p>
                <p className="text-xs leading-relaxed" style={{ color:tsColor(dark) }}>{outage.rootCause}</p>
              </div>
            )}

            {/* Resolution */}
            {outage.resolution && (
              <div className="px-4 py-3" style={{ borderTop:'1px solid rgba(34,197,94,0.1)', background:'rgba(34,197,94,0.025)' }}>
                <p className="text-[9px] uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color:'#34d399' }}>
                  <CheckCircle2 size={9} />{ar?'الحل':'Resolution'}
                </p>
                <p className="text-xs leading-relaxed" style={{ color:'#86efac' }}>{outage.resolution}</p>
              </div>
            )}

            {/* Media thumbnails */}
            {(images.length > 0 || videos.length > 0) && (
              <div className="px-4 py-3" style={{ borderTop:`1px solid ${T.bdr}` }}>
                <p className="text-[9px] uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color:tsColor(dark) }}>
                  <Paperclip size={9} />
                  {ar?`مرفقات (${images.length+videos.length})`:`Attachments (${images.length+videos.length})`}
                </p>
                <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth:'none' }}>
                  {images.map(a => (
                    <div key={a.id} className="relative flex-shrink-0 group cursor-pointer">
                      <img src={a.url} alt={a.originalName}
                        className="w-20 h-14 rounded-xl object-cover"
                        style={{ border:`1px solid ${T.bdr}` }} />
                      <div className="absolute inset-0 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background:'rgba(0,0,0,0.45)' }}>
                        <Image size={13} style={{ color:'#fff' }} />
                      </div>
                    </div>
                  ))}
                  {videos.map(a => (
                    <div key={a.id} className="flex-shrink-0 w-20 h-14 rounded-xl flex flex-col items-center justify-center gap-1"
                      style={{ background:'rgba(99,102,241,0.08)', border:'1px solid rgba(99,102,241,0.18)' }}>
                      <Video size={16} style={{ color:'#818cf8' }} />
                      <span className="text-[8px] px-1 text-center leading-tight truncate w-full text-center" style={{ color:T.faint }}>
                        {a.originalName.slice(0,14)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Watermark footer */}
            <div className="px-4 py-2 flex items-center" style={{ borderTop:`1px solid ${T.bdr}`, background:T.panel }}>
              <span className="text-[9px]" style={{ color:T.faint }}>📌 WFM Platform — Boutiqaat Contact Center</span>
            </div>
          </div>

          {/* ── Share actions ──────────────────────────────────────────────── */}
          <div className="px-4 pt-4 pb-5 space-y-2">
            <p className="text-[9px] uppercase tracking-widest mb-3" style={{ color:tsColor(dark) }}>
              {ar?'خيارات الإرسال':'Send via'}
            </p>

            {/* WhatsApp + Email */}
            <div className="grid grid-cols-2 gap-2">
              <a href={whatsappUrl} target="_blank" rel="noreferrer"
                className="flex flex-col items-center gap-2.5 py-4 px-3 rounded-2xl transition-all hover:scale-[1.03] active:scale-[0.98]"
                style={{ background:'linear-gradient(135deg,rgba(37,211,102,0.13),rgba(37,211,102,0.05))', border:'1px solid rgba(37,211,102,0.22)', textDecoration:'none', boxShadow:'0 8px 24px rgba(37,211,102,0.07)' }}>
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
                  style={{ background:'rgba(37,211,102,0.12)', border:'1px solid rgba(37,211,102,0.2)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="#4ade80">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-xs font-bold" style={{ color:'#4ade80' }}>WhatsApp</p>
                  <p className="text-[10px] mt-0.5" style={{ color:tsColor(dark) }}>{ar?'فتح وإرسال':'Open & send'}</p>
                </div>
              </a>

              <a href={mailUrl}
                className="flex flex-col items-center gap-2.5 py-4 px-3 rounded-2xl transition-all hover:scale-[1.03] active:scale-[0.98]"
                style={{ background:'linear-gradient(135deg,rgba(96,165,250,0.13),rgba(96,165,250,0.05))', border:'1px solid rgba(96,165,250,0.22)', textDecoration:'none', boxShadow:'0 8px 24px rgba(96,165,250,0.07)' }}>
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
                  style={{ background:'rgba(96,165,250,0.12)', border:'1px solid rgba(96,165,250,0.2)' }}>
                  <Mail size={22} style={{ color:'#60a5fa' }} />
                </div>
                <div className="text-center">
                  <p className="text-xs font-bold" style={{ color:'#60a5fa' }}>{ar?'إيميل':'Email'}</p>
                  <p className="text-[10px] mt-0.5" style={{ color:tsColor(dark) }}>{ar?'فتح تطبيق البريد':'Open mail app'}</p>
                </div>
              </a>
            </div>

            {/* HTML Report */}
            <button onClick={openReport} disabled={reportLoading}
              className="w-full flex items-center gap-4 p-4 rounded-2xl transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 text-start"
              style={{ background:'linear-gradient(135deg,rgba(251,191,36,0.1),rgba(251,146,60,0.05))', border:'1px solid rgba(251,191,36,0.2)', boxShadow:'0 8px 24px rgba(251,191,36,0.05)' }}>
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background:'rgba(251,191,36,0.1)', border:'1px solid rgba(251,191,36,0.2)' }}>
                {reportLoading
                  ? <Loader2 size={20} style={{ color:'#fbbf24' }} className="animate-spin" />
                  : <Printer size={20} style={{ color:'#fbbf24' }} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold" style={{ color:'#fbbf24' }}>
                  {ar?'تقرير احترافي جاهز للطباعة':'Professional Print-Ready Report'}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color:tsColor(dark) }}>
                  {ar?'يشمل الصور والتسلسل الزمني الكامل':'Includes images, timeline & full details'}
                </p>
              </div>
              <ChevronRight size={14} style={{ color:tsColor(dark), flexShrink:0 }} />
            </button>

            {/* Copy */}
            <button onClick={copyText}
              className="w-full flex items-center gap-4 p-4 rounded-2xl transition-all text-start hover:scale-[1.01] active:scale-[0.99]"
              style={{ background:copied?'rgba(52,211,153,0.07)':T.panel, border:copied?'1px solid rgba(52,211,153,0.22)':`1px solid ${T.bdr}` }}>
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background:copied?'rgba(52,211,153,0.1)':T.panel, border:copied?'1px solid rgba(52,211,153,0.2)':`1px solid ${T.bdr}` }}>
                {copied ? <CheckCircle2 size={20} style={{ color:'#34d399' }}/> : <FileText size={20} style={{ color:tsColor(dark) }}/>}
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color:copied?'#34d399':T.faint }}>
                  {copied?(ar?'✓ تم النسخ!':'✓ Copied!'):(ar?'نسخ الملخص':'Copy Summary Text')}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color:tsColor(dark) }}>
                  {ar?'جاهز للصق في أي مكان':'Ready to paste anywhere'}
                </p>
              </div>
            </button>
          </div>
        </div>
        {/* Bottom fade — scroll indicator */}
        <div className="absolute bottom-0 inset-x-0 h-10 pointer-events-none rounded-b-3xl"
          style={{ background:'linear-gradient(to top, var(--surface), transparent)' }} />
      </div>
    </div>
  );
}
