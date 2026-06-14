import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload, BarChart3, Users, TrendingUp, TrendingDown, Trash2,
  FileSpreadsheet, Download, AlertCircle, CheckCircle2, Clock,
  CreditCard, MessageSquare, ThumbsUp, ThumbsDown, Minus,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useUiStore } from '@/store/ui.store';

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface Batch {
  id: string; file_name: string; period_from: string; period_to: string;
  total_rows: number; uploaded_at: string; uploaded_by_name: string; notes: string;
}
interface Summary {
  totalContacts: number; agents: number; days: number;
  survey: { sent: number; clicked: number; clickRate: number | null };
  sentiment: { positive: number; negative: number; neutral: number; positivePct: number | null; negativePct: number | null };
  channels: { channel: string; count: number }[];
}
interface AgentRow {
  rank: number; agent: string; agentLogin: string; contacts: number;
  activeDays: number; avgPerDay: number | null; surveySent: number;
  positive: number; negative: number; positivePct: number | null;
}
interface ReasonRow { rank: number; reason: string; count: number; negativeCount: number }
interface PaymentRow { method: string; count: number }
interface TrendRow { week: string; weekStart: string; contacts: number; positive: number; negative: number; deltaPct: number | null }
interface HourCell { date: string; hour: number; count: number }
interface Preview {
  fileName: string; sheetName: string; totalRows: number;
  detectedColumns: Record<string, string>; unmappedHeaders: string[];
  periodFrom: string | null; periodTo: string | null;
  channels: string[]; warnings: string[];
}

const fmtD = (d: string) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const FIELD_LABELS: Record<string, { ar: string }> = {
  timestamp:     { ar: 'وقت التواصل' },
  channel:       { ar: 'القناة' },
  payment:       { ar: 'طريقة الدفع' },
  reason:        { ar: 'سبب التواصل' },
  agentName:     { ar: 'اسم الموظف' },
  agentLogin:    { ar: 'إيميل/لوجن' },
  surveySent:    { ar: 'سيرفي مرسل' },
  surveyClicked: { ar: 'سيرفي مفتوح' },
  rating:        { ar: 'التقييم' },
};

/* ─── KPI Card ──────────────────────────────────────────────────────────── */
function KpiCard({ icon: Icon, label, value, sub, color = '#6366f1' }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-2xl"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}22`, color }}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">{label}</p>
        <p className="text-xl font-bold text-white leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
      </div>
    </div>
  );
}

/* ─── Horizontal Bar ────────────────────────────────────────────────────── */
function HBar({ label, value, max, color = '#6366f1', suffix = '' }: {
  label: string; value: number; max: number; color?: string; suffix?: string;
}) {
  const pct = max ? Math.round(100 * value / max) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400 w-40 truncate text-start" title={label}>{label}</span>
      <div className="flex-1 h-5 rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div className="h-full rounded-lg transition-all flex items-center px-2"
          style={{ width: `${Math.max(pct, 3)}%`, background: `linear-gradient(90deg, ${color}cc, ${color}77)` }}>
        </div>
      </div>
      <span className="text-xs font-bold text-white w-16 text-end">{value.toLocaleString()}{suffix}</span>
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────────────── */
export default function OperationsAnalyticsPage() {
  const { lang } = useUiStore();
  const ar = lang === 'ar';

  const [batches, setBatches]       = useState<Batch[]>([]);
  const [activeBatch, setActiveBatch] = useState<Batch | null>(null);
  const [tab, setTab]               = useState<'overview' | 'agents' | 'trends' | 'upload'>('overview');

  const [summary, setSummary]   = useState<Summary | null>(null);
  const [agents, setAgents]     = useState<AgentRow[]>([]);
  const [reasons, setReasons]   = useState<ReasonRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [trends, setTrends]     = useState<TrendRow[]>([]);
  const [hourly, setHourly]     = useState<{ cells: HourCell[]; hourTotals: { hour: number; count: number }[] }>({ cells: [], hourTotals: [] });
  const [loading, setLoading]   = useState(false);

  // Upload state
  const [preview, setPreview]       = useState<Preview | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [uploadMsg, setUploadMsg]   = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadBatches = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/ops-analytics/batches');
      setBatches(data);
      if (data.length && !activeBatch) setActiveBatch(data[0]);
      if (!data.length) setTab('upload');
    } catch {}
  }, []);

  useEffect(() => { loadBatches(); }, []);

  useEffect(() => {
    if (!activeBatch) return;
    setLoading(true);
    const id = activeBatch.id;
    Promise.all([
      apiClient.get(`/ops-analytics/batches/${id}/summary`),
      apiClient.get(`/ops-analytics/batches/${id}/agents`),
      apiClient.get(`/ops-analytics/batches/${id}/reasons`),
      apiClient.get(`/ops-analytics/batches/${id}/payments`),
      apiClient.get(`/ops-analytics/batches/${id}/trends`),
      apiClient.get(`/ops-analytics/batches/${id}/hourly`),
    ]).then(([s, a, r, p, t, h]: any[]) => {
      setSummary(s.data); setAgents(a.data); setReasons(r.data);
      setPayments(p.data); setTrends(t.data); setHourly(h.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [activeBatch?.id]);

  /* ── Upload handlers ──────────────────────────────────────────────────── */
  const doPreview = async (file: File) => {
    setUploading(true); setUploadMsg(null); setPreview(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await (apiClient as any).post('/ops-analytics/upload/preview', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(data);
      setUploadFile(file);
    } catch (e: any) {
      setUploadMsg({ type: 'err', text: e?.response?.data?.message ?? 'فشل تحليل الملف' });
    } finally { setUploading(false); }
  };

  const doCommit = async () => {
    if (!uploadFile) return;
    setUploading(true); setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      const { data } = await (apiClient as any).post('/ops-analytics/upload/commit', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploadMsg({ type: 'ok', text: `تم حفظ ${data.totalRows.toLocaleString()} سجل بنجاح` });
      setPreview(null); setUploadFile(null);
      await loadBatches();
      setTab('overview');
    } catch (e: any) {
      setUploadMsg({ type: 'err', text: e?.response?.data?.message ?? 'فشل حفظ البيانات' });
    } finally { setUploading(false); }
  };

  const deleteBatch = async (id: string) => {
    if (!confirm(ar ? 'حذف هذه الدفعة وكل بياناتها؟' : 'Delete this batch and all its data?')) return;
    try {
      await apiClient.delete(`/ops-analytics/batches/${id}`);
      setActiveBatch(null);
      await loadBatches();
    } catch {}
  };

  const exportExcel = async () => {
    if (!activeBatch) return;
    try {
      const resp = await (apiClient as any).get(`/ops-analytics/batches/${activeBatch.id}/export`, { responseType: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(resp.data);
      a.download = `ops-analytics-${activeBatch.file_name ?? 'export'}.xlsx`;
      a.click();
    } catch {}
  };

  /* ── Heatmap data prep ────────────────────────────────────────────────── */
  const heatDates = [...new Set(hourly.cells.map(c => c.date))].sort();
  const heatMax = Math.max(1, ...hourly.cells.map(c => c.count));
  const heatLookup: Record<string, number> = {};
  hourly.cells.forEach(c => { heatLookup[`${c.date}|${c.hour}`] = c.count; });
  const hourMax = Math.max(1, ...hourly.hourTotals.map(h => h.count));

  const maxReason  = Math.max(1, ...reasons.map(r => r.count));
  const maxPayment = Math.max(1, ...payments.map(p => p.count));
  const maxChannel = Math.max(1, ...(summary?.channels.map(c => c.count) ?? [1]));
  const maxTrend   = Math.max(1, ...trends.map(t => t.contacts));

  const TABS = [
    { key: 'overview', icon: BarChart3,  label: ar ? 'نظرة عامة' : 'Overview' },
    { key: 'agents',   icon: Users,      label: ar ? 'ترتيب الموظفين' : 'Agent Ranking' },
    { key: 'trends',   icon: TrendingUp, label: ar ? 'الاتجاه الأسبوعي' : 'Weekly Trends' },
    { key: 'upload',   icon: Upload,     label: ar ? 'رفع البيانات' : 'Upload Data' },
  ] as const;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">{ar ? 'تحليلات العمليات' : 'Operations Analytics'}</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {ar ? 'تحليل بيانات التواصل: الحجم بالساعة، الأسباب، الدفع، السيرفي، وترتيب الموظفين' : 'Contact data analysis: hourly volume, reasons, payments, surveys, agent ranking'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {batches.length > 0 && (
            <select
              value={activeBatch?.id ?? ''}
              onChange={e => setActiveBatch(batches.find(b => b.id === e.target.value) ?? null)}
              className="px-3 py-2 rounded-xl text-xs text-white outline-none cursor-pointer"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
              {batches.map(b => (
                <option key={b.id} value={b.id} style={{ background: '#0f1527' }}>
                  {b.file_name} ({fmtD(b.period_from)} → {fmtD(b.period_to)})
                </option>
              ))}
            </select>
          )}
          {activeBatch && (
            <>
              <button onClick={exportExcel}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-slate-300 hover:text-white hover:bg-white/10 transition-all"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <Download size={13} /> {ar ? 'تصدير' : 'Export'}
              </button>
              <button onClick={() => deleteBatch(activeBatch.id)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-2xl w-fit"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all
              ${tab === t.key ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
            style={tab === t.key ? { background: 'linear-gradient(135deg,#4338ca,#6366f1)' } : {}}>
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {loading && tab !== 'upload' ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-7 h-7 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        </div>
      ) : (
        <>
          {/* ══ OVERVIEW ══ */}
          {tab === 'overview' && summary && (
            <div className="space-y-4">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <KpiCard icon={MessageSquare} label={ar ? 'إجمالي التواصل' : 'Total Contacts'} value={summary.totalContacts.toLocaleString()} sub={`${summary.days} ${ar ? 'يوم' : 'days'}`} />
                <KpiCard icon={Users} label={ar ? 'الموظفين' : 'Agents'} value={summary.agents} color="#22c55e" />
                <KpiCard icon={CheckCircle2} label={ar ? 'سيرفي مرسل' : 'Surveys Sent'} value={summary.survey.sent.toLocaleString()} color="#f59e0b" />
                <KpiCard icon={TrendingUp} label={ar ? 'نسبة فتح السيرفي' : 'Survey Click Rate'} value={summary.survey.clickRate !== null ? `${summary.survey.clickRate}%` : '—'} sub={`${summary.survey.clicked.toLocaleString()} ${ar ? 'نقرة' : 'clicks'}`} color="#06b6d4" />
                <KpiCard icon={ThumbsUp} label={ar ? 'تقييم إيجابي' : 'Positive'} value={summary.sentiment.positivePct !== null ? `${summary.sentiment.positivePct}%` : '—'} sub={`${summary.sentiment.positive.toLocaleString()}`} color="#22c55e" />
                <KpiCard icon={ThumbsDown} label={ar ? 'تقييم سلبي' : 'Negative'} value={summary.sentiment.negativePct !== null ? `${summary.sentiment.negativePct}%` : '—'} sub={`${summary.sentiment.negative.toLocaleString()}`} color="#ef4444" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Top Reasons */}
                <div className="p-5 rounded-2xl space-y-3"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <AlertCircle size={14} className="text-amber-400" />
                    {ar ? 'أهم 10 أسباب تواصل' : 'Top 10 Contact Reasons'}
                  </h3>
                  {reasons.length === 0 ? <p className="text-xs text-slate-600 py-4 text-center">{ar ? 'لا بيانات' : 'No data'}</p> :
                    reasons.map(r => <HBar key={r.rank} label={`${r.rank}. ${r.reason}`} value={r.count} max={maxReason} color="#f59e0b" />)}
                </div>

                {/* Payments */}
                <div className="p-5 rounded-2xl space-y-3"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <CreditCard size={14} className="text-emerald-400" />
                    {ar ? 'طرق الدفع' : 'Payment Methods'}
                  </h3>
                  {payments.length === 0 ? <p className="text-xs text-slate-600 py-4 text-center">{ar ? 'لا بيانات' : 'No data'}</p> :
                    payments.slice(0, 10).map(p => <HBar key={p.method} label={p.method} value={p.count} max={maxPayment} color="#22c55e" />)}

                  <h3 className="text-sm font-bold text-white flex items-center gap-2 pt-3">
                    <BarChart3 size={14} className="text-indigo-400" />
                    {ar ? 'القنوات' : 'Channels'}
                  </h3>
                  {summary.channels.slice(0, 6).map(c => <HBar key={c.channel} label={c.channel} value={c.count} max={maxChannel} color="#6366f1" />)}
                </div>
              </div>

              {/* Hourly heatmap */}
              <div className="p-5 rounded-2xl"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
                  <Clock size={14} className="text-cyan-400" />
                  {ar ? 'حجم التواصل بالساعة' : 'Hourly Contact Volume'}
                </h3>

                {/* Per-hour totals bar chart */}
                <div className="flex items-end gap-1 h-28 mb-4" dir="ltr">
                  {Array.from({ length: 24 }, (_, h) => {
                    const cnt = hourly.hourTotals.find(x => x.hour === h)?.count ?? 0;
                    return (
                      <div key={h} className="flex-1 flex flex-col items-center gap-1 group">
                        <div className="w-full rounded-t-md transition-all relative"
                          style={{
                            height: `${Math.max(4, Math.round(96 * cnt / hourMax))}px`,
                            background: cnt ? 'linear-gradient(180deg,#06b6d4,#0e7490)' : 'rgba(255,255,255,0.05)',
                          }}>
                          <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-cyan-300 opacity-0 group-hover:opacity-100 font-bold whitespace-nowrap">{cnt.toLocaleString()}</span>
                        </div>
                        <span className="text-[8px] text-slate-600">{h}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Date × hour heatmap (last 14 days max) */}
                {heatDates.length > 1 && (
                  <div className="overflow-x-auto" dir="ltr">
                    <table className="border-separate" style={{ borderSpacing: 2 }}>
                      <thead>
                        <tr>
                          <th className="text-[9px] text-slate-600 px-1 text-right">{ar ? 'التاريخ' : 'Date'}</th>
                          {Array.from({ length: 24 }, (_, h) => (
                            <th key={h} className="text-[8px] text-slate-600 w-7">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {heatDates.slice(-14).map(d => (
                          <tr key={d}>
                            <td className="text-[9px] text-slate-500 px-1 whitespace-nowrap">{fmtD(d)}</td>
                            {Array.from({ length: 24 }, (_, h) => {
                              const cnt = heatLookup[`${d}|${h}`] ?? 0;
                              const intensity = cnt / heatMax;
                              return (
                                <td key={h} className="w-7 h-5 rounded text-center text-[8px] font-bold"
                                  title={`${d} ${h}:00 — ${cnt}`}
                                  style={{
                                    background: cnt ? `rgba(99,102,241,${0.15 + intensity * 0.75})` : 'rgba(255,255,255,0.02)',
                                    color: intensity > 0.5 ? '#fff' : '#64748b',
                                  }}>
                                  {cnt || ''}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══ AGENTS ══ */}
          {tab === 'agents' && (
            <div className="rounded-2xl overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 text-[10px] uppercase" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <th className="px-4 py-3 text-start">#</th>
                    <th className="px-4 py-3 text-start">{ar ? 'الموظف' : 'Agent'}</th>
                    <th className="px-4 py-3 text-center">{ar ? 'التواصلات' : 'Contacts'}</th>
                    <th className="px-4 py-3 text-center">{ar ? 'أيام نشطة' : 'Active Days'}</th>
                    <th className="px-4 py-3 text-center">{ar ? 'معدل/يوم' : 'Avg/Day'}</th>
                    <th className="px-4 py-3 text-center">{ar ? 'سيرفي' : 'Surveys'}</th>
                    <th className="px-4 py-3 text-center">👍</th>
                    <th className="px-4 py-3 text-center">👎</th>
                    <th className="px-4 py-3 text-center">{ar ? 'إيجابية %' : 'Positive %'}</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map(a => (
                    <tr key={a.rank} className="border-t border-white/[0.04] hover:bg-white/[0.03] transition-all">
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex w-6 h-6 rounded-lg items-center justify-center text-[10px] font-bold
                          ${a.rank <= 3 ? 'text-amber-300' : 'text-slate-500'}`}
                          style={{ background: a.rank <= 3 ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)' }}>
                          {a.rank}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-white font-semibold">{a.agent}</p>
                        {a.agentLogin && <p className="text-[9px] text-slate-600">{a.agentLogin}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-center font-bold text-white">{a.contacts.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-center text-slate-400">{a.activeDays}</td>
                      <td className="px-4 py-2.5 text-center text-slate-400">{a.avgPerDay ?? '—'}</td>
                      <td className="px-4 py-2.5 text-center text-slate-400">{a.surveySent}</td>
                      <td className="px-4 py-2.5 text-center text-emerald-400">{a.positive}</td>
                      <td className="px-4 py-2.5 text-center text-red-400">{a.negative}</td>
                      <td className="px-4 py-2.5 text-center">
                        {a.positivePct !== null ? (
                          <span className={`font-bold ${a.positivePct >= 80 ? 'text-emerald-400' : a.positivePct >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                            {a.positivePct}%
                          </span>
                        ) : <Minus size={11} className="text-slate-600 inline" />}
                      </td>
                    </tr>
                  ))}
                  {agents.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-600">{ar ? 'لا بيانات موظفين' : 'No agent data'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ══ TRENDS ══ */}
          {tab === 'trends' && (
            <div className="p-5 rounded-2xl space-y-4"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <h3 className="text-sm font-bold text-white">{ar ? 'الحجم الأسبوعي (أسبوع مقابل أسبوع)' : 'Weekly Volume (Week over Week)'}</h3>
              {trends.length === 0 ? <p className="text-xs text-slate-600 py-6 text-center">{ar ? 'لا بيانات' : 'No data'}</p> : (
                <div className="space-y-2.5">
                  {trends.map(t => (
                    <div key={t.week} className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-500 w-20 flex-shrink-0">{t.week}</span>
                      <div className="flex-1 h-7 rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                        <div className="h-full rounded-lg flex items-center px-2.5 gap-2"
                          style={{ width: `${Math.max(5, Math.round(100 * t.contacts / maxTrend))}%`,
                            background: 'linear-gradient(90deg,#4338ca,#6366f1aa)' }}>
                          <span className="text-[10px] font-bold text-white whitespace-nowrap">{t.contacts.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="w-24 flex items-center gap-2 flex-shrink-0">
                        {t.deltaPct !== null && (
                          <span className={`flex items-center gap-0.5 text-[10px] font-bold ${t.deltaPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {t.deltaPct >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                            {t.deltaPct > 0 ? '+' : ''}{t.deltaPct}%
                          </span>
                        )}
                        <span className="text-[9px] text-emerald-500">{t.positive}👍</span>
                        <span className="text-[9px] text-red-500">{t.negative}👎</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══ UPLOAD ══ */}
          {tab === 'upload' && (
            <div className="max-w-3xl space-y-4">
              {/* Drop zone */}
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) doPreview(f); }}
                className="flex flex-col items-center justify-center gap-3 py-12 rounded-2xl cursor-pointer transition-all hover:bg-white/[0.04]"
                style={{ border: '2px dashed rgba(99,102,241,0.35)', background: 'rgba(99,102,241,0.04)' }}>
                {uploading ? (
                  <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                ) : (
                  <>
                    <FileSpreadsheet size={36} className="text-indigo-400" />
                    <p className="text-sm font-semibold text-white">{ar ? 'اسحب ملف Excel/CSV هنا أو اضغط للاختيار' : 'Drop Excel/CSV file here or click to browse'}</p>
                    <p className="text-[10px] text-slate-500">{ar ? 'حتى 50 ميجا — يتم اكتشاف الأعمدة تلقائياً' : 'Up to 50MB — columns auto-detected'}</p>
                  </>
                )}
                <input ref={fileRef} type="file" className="hidden" accept=".xlsx,.xls,.csv"
                  onChange={e => { const f = e.target.files?.[0]; if (f) doPreview(f); e.target.value = ''; }} />
              </div>

              {uploadMsg && (
                <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold
                  ${uploadMsg.type === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}
                  style={{ background: uploadMsg.type === 'ok' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                    border: `1px solid ${uploadMsg.type === 'ok' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}` }}>
                  {uploadMsg.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  {uploadMsg.text}
                </div>
              )}

              {/* Preview */}
              {preview && (
                <div className="p-5 rounded-2xl space-y-4"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">{ar ? 'معاينة قبل الحفظ' : 'Preview Before Commit'}</h3>
                    <span className="text-[10px] text-slate-500">{preview.sheetName} · {preview.totalRows.toLocaleString()} {ar ? 'صف' : 'rows'}</span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                    <div className="p-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <p className="text-[9px] text-slate-500">{ar ? 'الصفوف' : 'Rows'}</p>
                      <p className="text-sm font-bold text-white">{preview.totalRows.toLocaleString()}</p>
                    </div>
                    <div className="p-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <p className="text-[9px] text-slate-500">{ar ? 'من' : 'From'}</p>
                      <p className="text-sm font-bold text-white">{preview.periodFrom ? fmtD(preview.periodFrom) : '—'}</p>
                    </div>
                    <div className="p-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <p className="text-[9px] text-slate-500">{ar ? 'إلى' : 'To'}</p>
                      <p className="text-sm font-bold text-white">{preview.periodTo ? fmtD(preview.periodTo) : '—'}</p>
                    </div>
                    <div className="p-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <p className="text-[9px] text-slate-500">{ar ? 'القنوات' : 'Channels'}</p>
                      <p className="text-sm font-bold text-white">{preview.channels.length}</p>
                    </div>
                  </div>

                  {/* Detected columns */}
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">{ar ? 'الأعمدة المكتشفة' : 'Detected Columns'}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(preview.detectedColumns).map(([field, header]) => (
                        <span key={field} className="px-2.5 py-1 rounded-lg text-[10px]"
                          style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#86efac' }}>
                          {FIELD_LABELS[field]?.ar ?? field} ← <b>{header}</b>
                        </span>
                      ))}
                    </div>
                    {preview.unmappedHeaders.length > 0 && (
                      <p className="text-[9px] text-slate-600 mt-2">
                        {ar ? 'أعمدة غير مستخدمة:' : 'Unmapped:'} {preview.unmappedHeaders.slice(0, 10).join('، ')}
                      </p>
                    )}
                  </div>

                  {preview.warnings.length > 0 && (
                    <div className="space-y-1">
                      {preview.warnings.map((w, i) => (
                        <p key={i} className="flex items-center gap-1.5 text-[10px] text-amber-400">
                          <AlertCircle size={11} /> {w}
                        </p>
                      ))}
                    </div>
                  )}

                  <button onClick={doCommit} disabled={uploading}
                    className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg,#4338ca,#6366f1)' }}>
                    {uploading ? (ar ? 'جاري الحفظ...' : 'Saving...') : (ar ? `حفظ ${preview.totalRows.toLocaleString()} سجل` : `Commit ${preview.totalRows.toLocaleString()} rows`)}
                  </button>
                </div>
              )}

              {/* Existing batches */}
              {batches.length > 0 && (
                <div className="p-4 rounded-2xl space-y-1"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">{ar ? 'الدفعات المحفوظة' : 'Saved Batches'}</p>
                  {batches.map(b => (
                    <div key={b.id} className="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/[0.04] transition-all group">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileSpreadsheet size={14} className="text-indigo-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-white truncate">{b.file_name}</p>
                          <p className="text-[9px] text-slate-600">
                            {fmtD(b.period_from)} → {fmtD(b.period_to)} · {b.total_rows?.toLocaleString()} {ar ? 'صف' : 'rows'} · {b.uploaded_by_name}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => deleteBatch(b.id)}
                        className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all flex-shrink-0">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab !== 'upload' && !activeBatch && !loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-600">
              <BarChart3 size={36} className="opacity-25" />
              <p className="text-sm">{ar ? 'لا توجد بيانات بعد — ارفع ملف العمليات أولاً' : 'No data yet — upload an operations file first'}</p>
              <button onClick={() => setTab('upload')}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white"
                style={{ background: 'linear-gradient(135deg,#4338ca,#6366f1)' }}>
                {ar ? 'رفع البيانات' : 'Upload Data'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
