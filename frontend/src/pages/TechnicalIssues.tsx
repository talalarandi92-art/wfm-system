import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Wrench, Plus, X, Loader2, CheckCircle2, XCircle,
  Paperclip, Upload, Image, Video, Trash2, Eye,
  AlertTriangle, ChevronRight, ChevronDown, RefreshCw, Filter,
  Shield, Download, ExternalLink, Clock, FileText,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { card as cardStyle, tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';
import { fmtDateTime } from '@/utils/format';

// ─── Types ────────────────────────────────────────────────────────────────────
interface TI {
  id: string; title: string; description: string | null;
  status: 'pending_rta' | 'validated' | 'escalated_to_outage' | 'resolved' | 'rejected';
  severity: 'low' | 'medium' | 'high' | 'critical';
  functionName: string | null; channel: string | null;
  reporterName: string | null; validatedByName: string | null;
  validatedAt: string | null; rejectionReason: string | null;
  outageId: string | null; escalatedAt: string | null;
  resolutionNotes: string | null; resolvedAt: string | null;
  attachmentsCount: number; createdAt: string;
}

interface TIDetail extends TI {
  attachments: Attachment[];
}

interface Attachment {
  id: string; uploaderName: string; originalName: string;
  storedName: string; mimeType: string; fileSize: number;
  url: string; isImage: boolean; isVideo: boolean; createdAt: string;
}

interface Stats {
  total: number; pending: number; validated: number;
  escalated: number; resolved: number; rejected: number;
  last24h: number; last7d: number;
}

// ─── Metadata ─────────────────────────────────────────────────────────────────
const SEV: Record<string, { ar: string; en: string; color: string; bg: string }> = {
  low:      { ar: 'منخفض', en: 'Low',      color: '#34d399', bg: 'rgba(52,211,153,0.12)'  },
  medium:   { ar: 'متوسط', en: 'Medium',   color: '#fbbf24', bg: 'rgba(251,191,36,0.12)'  },
  high:     { ar: 'عالي',  en: 'High',     color: '#fb923c', bg: 'rgba(251,146,60,0.12)'  },
  critical: { ar: 'حرج',   en: 'Critical', color: '#f87171', bg: 'rgba(239,68,68,0.12)'   },
};
const ST: Record<string, { ar: string; en: string; color: string; bg: string }> = {
  pending_rta:          { ar: 'قيد مراجعة RTA', en: 'Pending RTA',   color: '#f87171', bg: 'rgba(239,68,68,0.12)'   },
  validated:            { ar: 'تم التحقق',       en: 'Validated',     color: '#fb923c', bg: 'rgba(251,146,60,0.12)'  },
  escalated_to_outage:  { ar: 'تحوّل لعطل',     en: 'Escalated',     color: '#818cf8', bg: 'rgba(99,102,241,0.12)'  },
  resolved:             { ar: 'محلول',            en: 'Resolved',      color: '#34d399', bg: 'rgba(52,211,153,0.12)'  },
  rejected:             { ar: 'مرفوض',            en: 'Rejected',      color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
};
const fmtDt = (dt: string, ar?: boolean) => fmtDateTime(dt, ar);
const fmtSize = (b: number)  => b > 1048576 ? `${(b/1048576).toFixed(1)} MB` : `${Math.round(b/1024)} KB`;

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TechnicalIssuesPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [items, setItems]   = useState<TI[]>([]);
  const [total, setTotal]   = useState(0);
  const [stats, setStats]   = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage]     = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [detail, setDetail] = useState<TIDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showValidate, setShowValidate] = useState(false);
  const [showReject, setShowReject] = useState(false);

  // form
  const [form, setForm] = useState({
    title: '', description: '', severity: 'medium', functionName: '', channel: '',
  });
  const [formFile, setFormFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const formFileRef = useRef<HTMLInputElement>(null);

  // validate modal
  const [valNotes, setValNotes] = useState('');
  const [valConvert, setValConvert] = useState(false);
  const [valSeverity, setValSeverity] = useState('high');
  const [valSubmitting, setValSubmitting] = useState(false);

  // reject modal
  const [rejReason, setRejReason] = useState('');
  const [rejSubmitting, setRejSubmitting] = useState(false);

  // add attachment to detail
  const addAttRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { limit: 20, offset: (page - 1) * 20 };
      if (statusFilter) params.status = statusFilter;
      const { data } = await apiClient.get('/technical-issues', { params });
      setItems(data.data ?? []); setTotal(data.total ?? 0);
    } catch {}
    setLoading(false);
  }, [page, statusFilter]);

  const loadStats = useCallback(() => {
    apiClient.get('/technical-issues/stats').then(r => setStats(r.data)).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStats(); }, [loadStats]);

  // ── Detail ──────────────────────────────────────────────────────────────────
  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try { const { data } = await apiClient.get(`/technical-issues/${id}`); setDetail(data); }
    catch {}
    setDetailLoading(false);
  };
  const refreshDetail = async () => {
    if (!detail) return;
    const { data } = await apiClient.get(`/technical-issues/${detail.id}`);
    setDetail(data); load(); loadStats();
  };

  // ── Submit TI ───────────────────────────────────────────────────────────────
  const submitTI = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('title',        form.title.trim());
      fd.append('description',  form.description);
      fd.append('severity',     form.severity);
      fd.append('functionName', form.functionName);
      fd.append('channel',      form.channel);
      if (formFile) fd.append('file', formFile);

      await apiClient.post('/technical-issues', fd);
      setShowForm(false);
      setForm({ title:'', description:'', severity:'medium', functionName:'', channel:'' });
      setFormFile(null);
      load(); loadStats();
    } catch {}
    setSaving(false);
  };

  // ── Validate ────────────────────────────────────────────────────────────────
  const submitValidate = async () => {
    if (!detail) return;
    setValSubmitting(true);
    try {
      const { data } = await apiClient.patch(`/technical-issues/${detail.id}/validate`, {
        notes: valNotes || undefined,
        convertToOutage: valConvert,
        severity: valConvert ? valSeverity : undefined,
        outageTitle: valConvert ? detail.title : undefined,
      });
      setShowValidate(false); setValNotes(''); setValConvert(false);
      await refreshDetail();
      if (data.convertedToOutage && data.outageId) {
        const arNow = useUiStore.getState().lang === 'ar';
        alert(arNow
          ? `تم تحويله لعطل بنجاح! رقم العطل: ${data.outageId.slice(0,8)}`
          : `Converted to outage successfully! Outage ID: ${data.outageId.slice(0,8)}`);
      }
    } catch {}
    setValSubmitting(false);
  };

  // ── Reject ───────────────────────────────────────────────────────────────────
  const submitReject = async () => {
    if (!detail || !rejReason.trim()) return;
    setRejSubmitting(true);
    try {
      await apiClient.patch(`/technical-issues/${detail.id}/reject`, { reason: rejReason });
      setShowReject(false); setRejReason('');
      await refreshDetail();
    } catch {}
    setRejSubmitting(false);
  };

  // ── Add attachment ───────────────────────────────────────────────────────────
  const handleAddAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !detail) return;
    setUploading(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      await apiClient.post(`/technical-issues/${detail.id}/attachments`, fd);
      await refreshDetail();
    } catch {}
    setUploading(false);
    if (addAttRef.current) addAttRef.current.value = '';
  };

  const deleteAttachment = async (aid: string) => {
    if (!detail) return;
    await apiClient.delete(`/technical-issues/${detail.id}/attachments/${aid}`);
    await refreshDetail();
  };

  const isPendingRTA = (ti: TI) => ti.status === 'pending_rta';

  return (
    <div className="max-w-[1200px] mx-auto space-y-4" dir={ar ? 'rtl' : 'ltr'}>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ background:'rgba(99,102,241,0.15)', border:'1px solid rgba(99,102,241,0.25)' }}>
            <Wrench size={18} style={{ color:'#818cf8' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>
              {ar ? 'المشاكل التقنية' : 'Technical Issues'}
            </h1>
            <p className="text-xs" style={{ color:'#64748b' }}>
              {ar ? 'الإبلاغ عن مشاكل تقنية → تحقق RTA → تحويل لعطل' : 'Report issues · RTA validation · Escalate to outage'}
            </p>
          </div>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
          style={{ background:'rgba(99,102,241,0.15)', border:'1px solid rgba(99,102,241,0.3)', color:'#818cf8' }}>
          <Plus size={14} /> {ar ? 'إبلاغ عن مشكلة' : 'Report Issue'}
        </button>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { l: ar?'قيد المراجعة':'Pending RTA', v: stats.pending,   c:'#f87171' },
            { l: ar?'تم التحقق':'Validated',       v: stats.validated, c:'#fb923c' },
            { l: ar?'تحوّل لعطل':'Escalated',      v: stats.escalated, c:'#818cf8' },
            { l: ar?'آخر 24 ساعة':'Last 24h',      v: stats.last24h,   c:'#fbbf24' },
          ].map(s => (
            <div key={s.l} className="rounded-2xl p-4 flex items-center gap-3"
              style={{ background:'rgba(255,255,255,0.02)', border:`1px solid ${s.c}25` }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background:`${s.c}18`, border:`1px solid ${s.c}30` }}>
                <AlertTriangle size={16} style={{ color:s.c }} />
              </div>
              <div>
                <p className="text-xs" style={{ color:'#475569' }}>{s.l}</p>
                <p className="text-xl font-bold" style={{ color:'#e2e8f0' }}>{s.v}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={12} style={{ color:'#475569' }} />
        {['','pending_rta','validated','escalated_to_outage','resolved','rejected'].map(s => (
          <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
            className="px-3 py-1 rounded-lg text-xs transition-all"
            style={{
              background: statusFilter===s ? 'rgba(99,102,241,0.2)'  : 'rgba(255,255,255,0.04)',
              border:     statusFilter===s ? '1px solid rgba(99,102,241,0.35)' : '1px solid rgba(255,255,255,0.06)',
              color:      statusFilter===s ? '#818cf8' : '#64748b',
            }}>
            {!s ? (ar?'الكل':'All') : (ar ? (ST[s]?.ar ?? s) : (ST[s]?.en ?? s))}
          </button>
        ))}
        <button onClick={() => { load(); loadStats(); }} className="ms-auto" style={{ color:'#475569' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin" style={{ color:'#475569' }} />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle2 size={30} className="mx-auto mb-2" style={{ color:'#34d399' }} />
          <p className="text-sm" style={{ color:'#34d399' }}>{ar?'لا توجد مشاكل تقنية':'No technical issues'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(ti => {
            const sv = SEV[ti.severity] ?? SEV.medium;
            const st = ST[ti.status]   ?? ST.pending_rta;
            return (
              <div key={ti.id}
                className="rounded-2xl overflow-hidden cursor-pointer transition-all hover:scale-[1.002]"
                style={{ background:'rgba(255,255,255,0.02)', border:`1px solid ${isPendingRTA(ti) ? sv.color+'30' : 'rgba(255,255,255,0.06)'}` }}
                onClick={() => openDetail(ti.id)}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background:sv.color, boxShadow: isPendingRTA(ti) ? `0 0 6px ${sv.color}80` : 'none' }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold truncate" style={{ color:'#e2e8f0' }}>{ti.title}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background:st.bg, color:st.color }}>{ar?st.ar:st.en}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background:sv.bg, color:sv.color }}>{ar?sv.ar:sv.en}</span>
                      {isPendingRTA(ti) && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full animate-pulse"
                          style={{ background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.3)', color:'#f87171' }}>
                          {ar?'يحتاج RTA':'Needs RTA'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap" style={{ fontSize:11, color:'#475569' }}>
                      {ti.reporterName && <span>{ti.reporterName}</span>}
                      {ti.functionName && <span>· {ti.functionName}</span>}
                      <span><Clock size={9} className="inline me-0.5" />{fmtDt(ti.createdAt)}</span>
                      {ti.attachmentsCount > 0 && <span className="flex items-center gap-0.5"><Paperclip size={9} />{ti.attachmentsCount}</span>}
                    </div>
                  </div>
                  <ChevronRight size={14} style={{ color:'#475569', flexShrink:0 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 20 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          {Array.from({ length: Math.min(Math.ceil(total/20), 8) }, (_,i) => i+1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className="w-8 h-8 rounded-lg text-xs font-medium"
              style={{ background:p===page?'rgba(99,102,241,0.25)':'rgba(255,255,255,0.04)', color:p===page?'#818cf8':'#64748b', border:p===page?'1px solid rgba(99,102,241,0.35)':'1px solid rgba(255,255,255,0.06)' }}>
              {p}
            </button>
          ))}
        </div>
      )}

      {/* ══ Detail Panel ══════════════════════════════════════════════════════ */}
      {(detailLoading || detail) && (
        <div className="fixed inset-0 z-50 flex" style={{ background:'rgba(0,0,0,0.75)', backdropFilter:'blur(6px)' }}
          onClick={() => !detailLoading && setDetail(null)}>
          <div className="ms-auto h-full w-full max-w-xl flex flex-col overflow-hidden"
            style={{ background:'#0b1120', borderLeft:'1px solid rgba(255,255,255,0.08)', boxShadow:'-24px 0 64px rgba(0,0,0,0.5)' }}
            onClick={e => e.stopPropagation()}>

            {detailLoading ? (
              <div className="flex items-center justify-center flex-1">
                <Loader2 size={24} className="animate-spin" style={{ color:'#475569' }} />
              </div>
            ) : detail && (
              <>
                {/* Panel header */}
                <div className="flex items-start justify-between px-6 py-4 flex-shrink-0"
                  style={{ borderBottom:'1px solid rgba(255,255,255,0.07)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                        style={{ background:ST[detail.status]?.bg, color:ST[detail.status]?.color }}>
                        {ar ? ST[detail.status]?.ar : ST[detail.status]?.en}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{ background:SEV[detail.severity]?.bg, color:SEV[detail.severity]?.color }}>
                        {ar ? SEV[detail.severity]?.ar : SEV[detail.severity]?.en}
                      </span>
                    </div>
                    <h2 className="text-base font-bold" style={{ color:'#f1f5f9' }}>{detail.title}</h2>
                  </div>
                  <button onClick={() => setDetail(null)} className="ms-3 p-1.5 rounded-lg hover:bg-white/[0.06]">
                    <X size={16} style={{ color:'#64748b' }} />
                  </button>
                </div>

                {/* Panel body */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

                  {/* Meta grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { l:ar?'المُبلِّغ':'Reporter',        v: detail.reporterName ?? '—' },
                      { l:ar?'القسم':'Function',              v: detail.functionName ?? '—' },
                      { l:ar?'القناة':'Channel',              v: detail.channel ?? '—' },
                      { l:ar?'وقت الإبلاغ':'Reported At',   v: fmtDt(detail.createdAt) },
                      ...(detail.validatedByName ? [{ l:ar?'تحقق بواسطة':'Validated By', v: detail.validatedByName }] : []),
                    ].map(d => (
                      <div key={d.l} className="rounded-xl p-3"
                        style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)' }}>
                        <p className="text-[10px] mb-1" style={{ color:'#475569' }}>{d.l}</p>
                        <p className="text-xs font-medium" style={{ color:'#e2e8f0' }}>{d.v}</p>
                      </div>
                    ))}
                  </div>

                  {detail.description && (
                    <div className="rounded-xl p-3" style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)' }}>
                      <p className="text-[10px] mb-1" style={{ color:'#475569' }}>{ar?'وصف المشكلة':'Description'}</p>
                      <p className="text-xs leading-relaxed" style={{ color:'#94a3b8' }}>{detail.description}</p>
                    </div>
                  )}
                  {detail.resolutionNotes && (
                    <div className="rounded-xl p-3" style={{ background:'rgba(52,211,153,0.05)', border:'1px solid rgba(52,211,153,0.15)' }}>
                      <p className="text-[10px] mb-1" style={{ color:'#475569' }}>{ar?'ملاحظات RTA':'RTA Notes'}</p>
                      <p className="text-xs leading-relaxed" style={{ color:'#34d399' }}>{detail.resolutionNotes}</p>
                    </div>
                  )}
                  {detail.rejectionReason && (
                    <div className="rounded-xl p-3" style={{ background:'rgba(239,68,68,0.05)', border:'1px solid rgba(239,68,68,0.15)' }}>
                      <p className="text-[10px] mb-1" style={{ color:'#475569' }}>{ar?'سبب الرفض':'Rejection Reason'}</p>
                      <p className="text-xs leading-relaxed" style={{ color:'#f87171' }}>{detail.rejectionReason}</p>
                    </div>
                  )}
                  {detail.outageId && (
                    <div className="rounded-xl p-3" style={{ background:'rgba(99,102,241,0.08)', border:'1px solid rgba(99,102,241,0.2)' }}>
                      <p className="text-[10px] mb-1" style={{ color:'#818cf8' }}>{ar?'تم التحويل لعطل':'Escalated to Outage'}</p>
                      <a href={`/outages`} className="text-xs font-medium flex items-center gap-1" style={{ color:'#818cf8' }}>
                        <ExternalLink size={11} /> {ar?'عرض العطل':'View Outage'} — {detail.outageId.slice(0,8)}
                      </a>
                    </div>
                  )}

                  {/* RTA Actions */}
                  {detail.status === 'pending_rta' && (
                    <div className="rounded-xl p-3 space-y-2"
                      style={{ background:'rgba(251,191,36,0.04)', border:'1px solid rgba(251,191,36,0.15)' }}>
                      <p className="text-xs font-semibold" style={{ color:'#fbbf24' }}>
                        {ar ? '⚡ إجراء RTA مطلوب' : '⚡ RTA Action Required'}
                      </p>
                      <div className="flex gap-2">
                        <button onClick={() => setShowValidate(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium flex-1 justify-center"
                          style={{ background:'rgba(52,211,153,0.15)', border:'1px solid rgba(52,211,153,0.3)', color:'#34d399' }}>
                          <CheckCircle2 size={12} /> {ar?'تحقق وأقر':'Validate'}
                        </button>
                        <button onClick={() => setShowReject(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium flex-1 justify-center"
                          style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.25)', color:'#f87171' }}>
                          <XCircle size={12} /> {ar?'ارفض':'Reject'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Download report */}
                  <div className="flex gap-2">
                    <a href={`/api/v1/technical-issues/${detail.id}/report`} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium flex-1 justify-center"
                      style={{ background:'rgba(99,102,241,0.1)', border:'1px solid rgba(99,102,241,0.2)', color:'#818cf8', textDecoration:'none' }}>
                      <Download size={12} /> {ar?'تحميل التقرير':'Download Report'}
                    </a>
                    <WhatsAppShare ti={detail} ar={ar} />
                  </div>

                  {/* ── Attachments ──────────────────────────────────── */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold flex items-center gap-1.5" style={{ color:'#94a3b8' }}>
                        <Paperclip size={12} /> {ar?`المرفقات (${detail.attachments.length})`:`Attachments (${detail.attachments.length})`}
                      </p>
                      <button onClick={() => addAttRef.current?.click()} disabled={uploading}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs disabled:opacity-40"
                        style={{ background:'rgba(251,191,36,0.1)', border:'1px solid rgba(251,191,36,0.25)', color:'#fbbf24' }}>
                        {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                        {ar?'رفع':'Upload'}
                      </button>
                      <input ref={addAttRef} type="file" className="hidden"
                        accept="image/*,video/*,.pdf" onChange={handleAddAttachment} />
                    </div>
                    {detail.attachments.length === 0
                      ? <p className="text-xs" style={{ color:'#475569' }}>{ar?'لا توجد مرفقات':'No attachments'}</p>
                      : (
                        <div className="grid grid-cols-3 gap-2">
                          {detail.attachments.map(a => (
                            <div key={a.id} className="relative rounded-xl overflow-hidden group"
                              style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', aspectRatio:'1' }}>
                              {a.isImage
                                ? <img src={a.url} alt={a.originalName} className="w-full h-full object-cover cursor-pointer" onClick={() => setLightbox(a)} />
                                : a.isVideo
                                  ? <video src={a.url} className="w-full h-full object-cover cursor-pointer" onClick={() => setLightbox(a)} />
                                  : <div className="w-full h-full flex flex-col items-center justify-center">
                                      <FileText size={22} style={{ color:'#64748b' }} />
                                      <span className="text-[9px] mt-1 px-1 text-center truncate w-full" style={{ color:'#475569' }}>{a.originalName}</span>
                                    </div>
                              }
                              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-1.5"
                                style={{ background:'linear-gradient(to top,rgba(0,0,0,0.7),transparent)' }}>
                                <span className="text-[9px]" style={{ color:'#cbd5e1' }}>{fmtSize(a.fileSize)}</span>
                                <div className="flex gap-1">
                                  <a href={a.url} download={a.originalName} className="p-1 rounded-lg" style={{ background:'rgba(255,255,255,0.15)' }} onClick={e => e.stopPropagation()}>
                                    <Download size={10} style={{ color:'#fff' }} />
                                  </a>
                                  <button className="p-1 rounded-lg" style={{ background:'rgba(239,68,68,0.3)' }}
                                    onClick={e => { e.stopPropagation(); deleteAttachment(a.id); }}>
                                    <Trash2 size={10} style={{ color:'#fca5a5' }} />
                                  </button>
                                </div>
                              </div>
                              {a.isImage && <Image size={10} className="absolute top-1.5 start-1.5" style={{ color:'#60a5fa' }} />}
                              {a.isVideo && <Video size={10} className="absolute top-1.5 start-1.5" style={{ color:'#a78bfa' }} />}
                            </div>
                          ))}
                        </div>
                      )
                    }
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══ Validate Modal ═══════════════════════════════════════════════════ */}
      {showValidate && detail && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background:'rgba(0,0,0,0.75)', backdropFilter:'blur(6px)' }}>
          <div className="w-full max-w-md rounded-3xl p-6"
            style={{ background:'#0f172a', border:'1px solid rgba(52,211,153,0.2)' }}>
            <div className="flex items-center gap-2 mb-4">
              <Shield size={16} style={{ color:'#34d399' }} />
              <h3 className="font-bold" style={{ color:'#e2e8f0' }}>{ar?'تحقق RTA':'RTA Validation'}</h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] mb-1.5" style={{ color:'#64748b' }}>{ar?'ملاحظات':'Notes'}</label>
                <textarea value={valNotes} onChange={e => setValNotes(e.target.value)}
                  rows={2} placeholder={ar?'ملاحظات التحقق...':'Validation notes...'} className="inp w-full text-xs" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer p-3 rounded-xl"
                style={{ background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.15)' }}>
                <input type="checkbox" checked={valConvert} onChange={e => setValConvert(e.target.checked)}
                  className="w-3.5 h-3.5 accent-red-500" />
                <span className="text-xs font-medium" style={{ color:'#f87171' }}>
                  {ar?'تحويل لعطل على الداشبورد':'Convert to Outage on Dashboard'}
                </span>
              </label>
              {valConvert && (
                <div>
                  <label className="block text-[11px] mb-1.5" style={{ color:'#64748b' }}>{ar?'خطورة العطل':'Outage Severity'}</label>
                  <select value={valSeverity} onChange={e => setValSeverity(e.target.value)} className="inp w-full text-xs">
                    {['critical','high','medium','low'].map(s => (
                      <option key={s} value={s}>{ar ? SEV[s].ar : SEV[s].en}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowValidate(false)} className="px-4 py-2 rounded-xl text-sm" style={{ color:'#64748b' }}>
                {ar?'إلغاء':'Cancel'}
              </button>
              <button onClick={submitValidate} disabled={valSubmitting}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                style={{ background:'rgba(52,211,153,0.15)', border:'1px solid rgba(52,211,153,0.3)', color:'#34d399' }}>
                {valSubmitting && <Loader2 size={12} className="animate-spin" />}
                {ar?'تأكيد التحقق':'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Reject Modal ══════════════════════════════════════════════════════ */}
      {showReject && detail && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background:'rgba(0,0,0,0.75)', backdropFilter:'blur(6px)' }}>
          <div className="w-full max-w-md rounded-3xl p-6"
            style={{ background:'#0f172a', border:'1px solid rgba(239,68,68,0.2)' }}>
            <div className="flex items-center gap-2 mb-4">
              <XCircle size={16} style={{ color:'#f87171' }} />
              <h3 className="font-bold" style={{ color:'#e2e8f0' }}>{ar?'رفض المشكلة':'Reject Issue'}</h3>
            </div>
            <div>
              <label className="block text-[11px] mb-1.5" style={{ color:'#64748b' }}>{ar?'سبب الرفض *':'Rejection Reason *'}</label>
              <textarea value={rejReason} onChange={e => setRejReason(e.target.value)}
                rows={3} placeholder={ar?'اذكر السبب...':'State the reason...'} className="inp w-full text-xs" />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowReject(false)} className="px-4 py-2 rounded-xl text-sm" style={{ color:'#64748b' }}>
                {ar?'إلغاء':'Cancel'}
              </button>
              <button onClick={submitReject} disabled={rejSubmitting || !rejReason.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                style={{ background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.3)', color:'#f87171' }}>
                {rejSubmitting && <Loader2 size={12} className="animate-spin" />}
                {ar?'رفض':'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Create Form ════════════════════════════════════════════════════════ */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background:'rgba(0,0,0,0.75)', backdropFilter:'blur(6px)' }}
          onClick={() => setShowForm(false)}>
          <div className="w-full max-w-lg rounded-3xl p-5 overflow-y-auto max-h-[90vh]"
            style={{ background:'#0f172a', border:'1px solid rgba(255,255,255,0.1)' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold" style={{ color:'#e2e8f0' }}>
                {ar ? 'الإبلاغ عن مشكلة تقنية' : 'Report Technical Issue'}
              </h2>
              <button onClick={() => setShowForm(false)}><X size={16} style={{ color:'#64748b' }} /></button>
            </div>

            <div className="space-y-2">
              <Fld label={ar ? 'العنوان *' : 'Title *'}>
                <input value={form.title} onChange={e => setForm(f=>({...f,title:e.target.value}))}
                  placeholder={ar ? 'وصف مختصر واضح...' : 'Brief, clear description...'}
                  className="inp" autoFocus />
              </Fld>

              <div className="grid grid-cols-2 gap-3">
                <Fld label={ar ? 'الخطورة' : 'Severity'}>
                  <select value={form.severity} onChange={e => setForm(f=>({...f,severity:e.target.value}))} className="inp">
                    {['critical','high','medium','low'].map(s => (
                      <option key={s} value={s}>{ar ? SEV[s].ar : SEV[s].en}</option>
                    ))}
                  </select>
                </Fld>
                <Fld label={ar ? 'القناة' : 'Channel'}>
                  <select value={form.channel} onChange={e => setForm(f=>({...f,channel:e.target.value}))} className="inp">
                    <option value="">{ar ? '-- اختر --' : '-- Select --'}</option>
                    {['Voice','Chat','WhatsApp','Email','Social','CRM','System'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Fld>
              </div>

              <Fld label={ar ? 'القسم / الوظيفة' : 'Function / Department'}>
                <input value={form.functionName} onChange={e => setForm(f=>({...f,functionName:e.target.value}))}
                  placeholder={ar ? 'مثال: Inbound، خدمة العملاء...' : 'e.g. Inbound, Customer Care...'}
                  className="inp" />
              </Fld>

              <Fld label={ar ? 'وصف المشكلة' : 'Description'}>
                <textarea value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))}
                  rows={2} placeholder={ar ? 'متى بدأت؟ ما هو تأثيرها على العمل؟' : 'When did it start? What is the business impact?'}
                  className="inp resize-none" />
              </Fld>

              <Fld label={ar ? 'صورة أو فيديو (اختياري)' : 'Photo / Video (optional)'}>
                {formFile ? (
                  <div className="flex items-center gap-3 p-3 rounded-xl"
                    style={{ background:'rgba(99,102,241,0.08)', border:'1px solid rgba(99,102,241,0.25)' }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background:'rgba(99,102,241,0.15)' }}>
                      {formFile.type.startsWith('image/') ? <Image size={14} style={{ color:'#818cf8' }} /> : <Video size={14} style={{ color:'#a78bfa' }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color:'#e2e8f0' }}>{formFile.name}</p>
                      <p className="text-[10px]" style={{ color:'#64748b' }}>{fmtSize(formFile.size)}</p>
                    </div>
                    <button onClick={() => setFormFile(null)} style={{ color:'#94a3b8' }}><X size={12} /></button>
                  </div>
                ) : (
                  <button onClick={() => formFileRef.current?.click()}
                    className="inp flex items-center gap-2 cursor-pointer"
                    style={{ justifyContent:'flex-start' }}>
                    <Upload size={14} style={{ color:'#64748b' }} />
                    <span style={{ color:'#64748b' }}>{ar ? 'رفع ملف...' : 'Upload file...'}</span>
                  </button>
                )}
                <input ref={formFileRef} type="file" className="hidden"
                  accept="image/*,video/*,.pdf"
                  onChange={e => setFormFile(e.target.files?.[0] ?? null)} />
              </Fld>

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setShowForm(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                  style={{ color:'#64748b', border:'1px solid rgba(100,116,139,0.25)' }}>
                  {ar ? 'إلغاء' : 'Cancel'}
                </button>
                <button onClick={submitTI} disabled={saving || !form.title.trim()}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow:'0 4px 14px rgba(99,102,241,0.4)' }}>
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <AlertTriangle size={13} />}
                  {saving ? (ar ? 'جاري الإرسال...' : 'Sending...') : (ar ? 'إرسال البلاغ' : 'Submit Issue')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          style={{ background:'rgba(0,0,0,0.92)' }} onClick={() => setLightbox(null)}>
          {lightbox.isImage
            ? <img src={lightbox.url} alt={lightbox.originalName} className="max-w-full max-h-full rounded-xl object-contain" onClick={e => e.stopPropagation()} />
            : <video src={lightbox.url} controls autoPlay className="max-w-full max-h-full rounded-xl" onClick={e => e.stopPropagation()} />
          }
          <button className="absolute top-4 end-4 p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.1)' }}>
            <X size={18} style={{ color:'#fff' }} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── WhatsApp Share ─────────────────────────────────────────────────────────────
function WhatsAppShare({ ti, ar }: { ti: TIDetail; ar: boolean }) {
  const text = ar
    ? `🔧 *مشكلة تقنية — ${ti.title}*\n` +
      `• الخطورة: ${ti.severity}\n` +
      `• القسم: ${ti.functionName ?? '—'}\n` +
      `• القناة: ${ti.channel ?? '—'}\n` +
      `• المُبلِّغ: ${ti.reporterName ?? '—'}\n` +
      `• الوقت: ${fmtDateTime(ti.createdAt, true)}\n` +
      (ti.description ? `• الوصف: ${ti.description}\n` : '') +
      `• المرفقات: ${ti.attachmentsCount}\n` +
      `\n📌 منصة WFM — Boutiqaat Contact Center`
    : `🔧 *Technical Issue — ${ti.title}*\n` +
      `• Severity: ${ti.severity}\n` +
      `• Function: ${ti.functionName ?? '—'}\n` +
      `• Channel: ${ti.channel ?? '—'}\n` +
      `• Reporter: ${ti.reporterName ?? '—'}\n` +
      `• Time: ${fmtDateTime(ti.createdAt, false)}\n` +
      (ti.description ? `• Description: ${ti.description}\n` : '') +
      `• Attachments: ${ti.attachmentsCount}\n` +
      `\n📌 WFM Platform — Boutiqaat Contact Center`;

  return (
    <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium flex-1 justify-center"
      style={{ background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.25)', color:'#4ade80', textDecoration:'none' }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
      </svg>
      {ar?'واتساب':'WhatsApp'}
    </a>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs mb-1 font-semibold tracking-wide" style={{ color:'#94a3b8' }}>{label}</label>
      {children}
    </div>
  );
}
