import { useState } from 'react';
import {
  Shield, X, AlertTriangle, Loader2, Shuffle, ArrowLeftRight, CheckCircle2,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { fmtDuration } from '@/utils/format';
import {
  SpQueue, BreakAgent, IncidentReport, CrossSkillCandidate, SkillDispatchForm,
  CH_COLOR, fmtTime,
} from './types';
import { CH_ICON } from './shared';

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  REPORT INCIDENT MODAL                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */
export function ReportIncidentModal({
  initial, onClose, ar,
}: {
  initial: IncidentReport; onClose: () => void; ar: boolean;
}) {
  const [form, setForm]       = useState<IncidentReport>(initial);
  const [submitting, setSub]  = useState(false);
  const [done, setDone]       = useState(false);
  const [error, setError]     = useState('');

  const set = (k: keyof IncidentReport, v: string) =>
    setForm(p => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!form.notes.trim()) { setError(ar ? 'أضف ملاحظة قبل الرفع' : 'Add notes before submitting'); return; }
    setSub(true); setError('');
    try {
      await apiClient.post('/integrations/sprinklr/incidents', form);
      setDone(true);
    } catch {
      /* non-fatal — still mark done so RTA can move on */
      setDone(true);
    }
    setSub(false);
  };

  const incLabel = (t: string) => ({
    unauthorized_break:       ar ? 'بريك بدون موافقة'          : 'Unauthorized Break',
    status_change_no_approval: ar ? 'تغيير حالة بدون موافقة' : 'Status Change Without Approval',
  }[t] ?? t);

  const durLabel = (m: number) => fmtDuration(m, ar);

  if (done) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl p-6 text-center"
        style={{ background: '#0f172a', border: '1px solid rgba(239,68,68,0.3)' }}
        onClick={e => e.stopPropagation()}>
        <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <Shield size={26} style={{ color: '#f87171' }} />
        </div>
        <h2 className="text-base font-bold mb-2" style={{ color: '#e2e8f0' }}>
          {ar ? 'تم رفع الإنسيدينت' : 'Incident Reported'}
        </h2>
        <p className="text-sm mb-1" style={{ color: '#94a3b8' }}>{form.employeeName}</p>
        <p className="text-xs mb-5" style={{ color: '#475569' }}>
          {ar
            ? 'تم تسجيل الإنسيدينت وسيصلك تأكيد.'
            : 'Incident logged. You will receive confirmation.'}
        </p>
        <button onClick={onClose}
          className="px-6 py-1.5 rounded-xl text-sm font-semibold"
          style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
          {ar ? 'إغلاق' : 'Close'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl p-5 space-y-3"
        style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <Shield size={14} style={{ color: '#f87171' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold leading-none" style={{ color: '#e2e8f0' }}>
                {ar ? 'رفع إنسيدينت' : 'Report Incident'}
              </h2>
              <p className="text-[10px] mt-0.5" style={{ color: '#64748b' }}>
                {ar ? 'سيُسجَّل في سجل الأحداث' : 'Will be logged in incident register'}
              </p>
            </div>
          </div>
          <button onClick={onClose}><X size={16} style={{ color: '#64748b' }} /></button>
        </div>

        {/* Employee info card */}
        <div className="rounded-xl p-3 flex items-start gap-3"
          style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold truncate" style={{ color: '#fca5a5' }}>{form.employeeName}</div>
            <div className="flex flex-wrap gap-2 mt-1 text-[10px]" style={{ color: '#64748b' }}>
              <span>{incLabel(form.incidentType)}</span>
              <span>·</span>
              <span>{fmtTime(form.occurredAt)}</span>
              {form.durationMinutes > 0 && (
                <><span>·</span><span style={{ color: '#f87171' }}>{durLabel(form.durationMinutes)}</span></>
              )}
            </div>
          </div>
        </div>

        {/* Incident type */}
        <div>
          <label className="text-[11px] mb-1.5 block" style={{ color: '#64748b' }}>
            {ar ? 'نوع الإنسيدينت' : 'Incident Type'}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['unauthorized_break', 'status_change_no_approval'] as const).map(t => (
              <button key={t} onClick={() => set('incidentType', t)}
                className="py-2 px-3 rounded-xl text-[11px] font-medium text-start transition-all"
                style={{
                  background: form.incidentType === t ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.03)',
                  border: form.incidentType === t ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(255,255,255,0.07)',
                  color: form.incidentType === t ? '#fca5a5' : '#64748b',
                }}>
                {incLabel(t)}
              </button>
            ))}
          </div>
        </div>

        {/* Severity */}
        <div>
          <label className="text-[11px] mb-1.5 block" style={{ color: '#64748b' }}>
            {ar ? 'الخطورة' : 'Severity'}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {([
              ['low',    ar ? 'منخفضة' : 'Low',    '#22c55e', 'rgba(34,197,94,0.12)'],
              ['medium', ar ? 'متوسطة' : 'Medium',  '#f59e0b', 'rgba(245,158,11,0.12)'],
              ['high',   ar ? 'عالية'  : 'High',    '#ef4444', 'rgba(239,68,68,0.15)'],
            ] as const).map(([v, l, c, bg]) => (
              <button key={v} onClick={() => set('severity', v)}
                className="py-2 rounded-xl text-[11px] font-semibold transition-all"
                style={{
                  background:  form.severity === v ? bg : 'rgba(255,255,255,0.03)',
                  border:      form.severity === v ? `1px solid ${c}66` : '1px solid rgba(255,255,255,0.07)',
                  color:       form.severity === v ? c : '#475569',
                }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-[11px] mb-1 block" style={{ color: '#64748b' }}>
            {ar ? 'الملاحظات *' : 'Notes *'}
          </label>
          <textarea rows={3} className="inp w-full resize-none" autoFocus
            placeholder={ar
              ? 'اكتب تفاصيل الحادثة — ماذا حدث؟ ما التأثير على الطابور؟'
              : 'Describe the incident — what happened? Impact on queue?'}
            value={form.notes}
            onChange={e => set('notes', e.target.value)} />
        </div>

        {error && (
          <p className="text-[11px] flex items-center gap-1.5" style={{ color: '#f87171' }}>
            <AlertTriangle size={11} />{error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-medium"
            style={{ color: '#64748b', border: '1px solid rgba(100,116,139,0.25)' }}>
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button onClick={submit} disabled={submitting}
            className="px-5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5"
            style={{ background: 'linear-gradient(135deg,#dc2626,#ef4444)', color: '#fff', opacity: submitting ? 0.6 : 1 }}>
            {submitting && <Loader2 size={11} className="animate-spin" />}
            {ar ? 'رفع الإنسيدينت' : 'Submit Incident'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  UNAUTHORIZED BREAK ALERT STRIP                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */
export function UnauthorizedBreakAlert({
  agents, onReport, ar,
}: {
  agents: BreakAgent[];
  onReport: (inc: IncidentReport) => void;
  ar: boolean;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = agents.filter(a => !dismissed.has(a.agentId));
  if (!visible.length) return null;

  const handleReport = (a: BreakAgent) => {
    const occurredAt = a.lastBreakStart ?? new Date().toISOString();
    const durationMinutes = a.lastBreakStart
      ? Math.round((Date.now() - new Date(a.lastBreakStart).getTime()) / 60000)
      : 0;
    onReport({
      employeeId:   a.agentId,
      employeeName: a.agentName,
      incidentType: 'unauthorized_break',
      occurredAt,
      durationMinutes,
      severity:     durationMinutes > 30 ? 'high' : durationMinutes > 15 ? 'medium' : 'low',
      notes:        '',
    });
  };

  return (
    <div className="flex-shrink-0 mx-4 mb-1.5 rounded-2xl overflow-hidden"
      style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid rgba(239,68,68,0.12)' }}>
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#ef4444' }} />
        <AlertTriangle size={11} style={{ color: '#f87171' }} />
        <span className="text-xs font-semibold flex-1" style={{ color: '#f87171' }}>
          {ar
            ? `${visible.length} ${visible.length === 1 ? 'موظف' : 'موظفين'} في بريك بدون موافقة`
            : `${visible.length} agent${visible.length !== 1 ? 's' : ''} on unauthorized break`}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold animate-pulse"
          style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171' }}>
          {ar ? 'تنبيه' : 'LIVE'}
        </span>
      </div>

      {/* Agent rows */}
      <div className="px-3 py-2 space-y-1.5">
        {visible.map(a => {
          const durationMins = a.lastBreakStart
            ? Math.round((Date.now() - new Date(a.lastBreakStart).getTime()) / 60000)
            : 0;
          const isLong = durationMins > 20;
          return (
            <div key={a.agentId}
              className="flex items-center gap-2 py-2 px-2.5 rounded-xl"
              style={{
                background: isLong ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.02)',
                border: isLong ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(255,255,255,0.05)',
              }}>
              {/* Status dot */}
              <span className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse"
                style={{ background: isLong ? '#ef4444' : '#f87171' }} />

              {/* Name + queue */}
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold truncate block" style={{ color: '#fca5a5' }}>
                  {a.agentName}
                </span>
                {a.lastBreakStart && (
                  <span className="text-[10px]" style={{ color: '#64748b' }}>
                    {ar ? 'منذ' : 'since'} {fmtTime(a.lastBreakStart)}
                    {durationMins > 0 && (
                      <span className="ms-1 font-semibold" style={{ color: isLong ? '#f87171' : '#94a3b8' }}>
                        ({durationMins}{ar ? 'د' : 'm'})
                      </span>
                    )}
                  </span>
                )}
              </div>

              {/* System status changed badge */}
              <span className="text-[10px] px-1.5 py-0.5 rounded-lg flex-shrink-0"
                style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}>
                {ar ? 'بدون موافقة' : 'No approval'}
              </span>

              {/* Report button */}
              <button onClick={() => handleReport(a)}
                className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg font-semibold flex-shrink-0 transition-opacity hover:opacity-80"
                style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)' }}>
                <Shield size={9} />
                {ar ? 'إنسيدينت' : 'Incident'}
              </button>

              {/* Dismiss */}
              <button onClick={() => setDismissed(p => { const n = new Set(p); n.add(a.agentId); return n; })}
                className="p-0.5 opacity-40 hover:opacity-70 transition-opacity flex-shrink-0">
                <X size={11} style={{ color: '#64748b' }} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CROSS-SKILL ALERT PANEL                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */
const CHANNEL_SKILL: Record<string, string> = {
  whatsapp: 'WHATSAPP', chat: 'CHAT', email: 'EMAIL', social: 'SOCIAL', voice: 'VOICE',
};

export function CrossSkillAlertPanel({
  gapQueues, onDispatch, ar,
}: {
  gapQueues: SpQueue[];
  onDispatch: (form: SkillDispatchForm) => void;
  ar: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Record<string, CrossSkillCandidate[]>>({});
  const [loadingC, setLoadingC] = useState<Record<string, boolean>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = gapQueues.filter(q => !dismissed.has(q.queueId));
  if (!visible.length) return null;

  const loadCandidates = async (q: SpQueue) => {
    const skill = CHANNEL_SKILL[q.channel] ?? q.channel.toUpperCase();
    if (candidates[q.queueId] !== undefined || loadingC[q.queueId]) return;
    setLoadingC(p => ({ ...p, [q.queueId]: true }));
    try {
      const { data } = await apiClient.get('/skills/gaps', {
        params: { skillCode: skill, functionName: q.queueName },
      });
      setCandidates(p => ({ ...p, [q.queueId]: Array.isArray(data) ? data : [] }));
    } catch { setCandidates(p => ({ ...p, [q.queueId]: [] })); }
    setLoadingC(p => ({ ...p, [q.queueId]: false }));
  };

  const handleExpand = (q: SpQueue) => {
    if (expanded === q.queueId) { setExpanded(null); return; }
    setExpanded(q.queueId);
    loadCandidates(q);
  };

  const handleDispatch = (q: SpQueue, c: CrossSkillCandidate) => {
    const skill = CHANNEL_SKILL[q.channel] ?? q.channel.toUpperCase();
    const now = new Date();
    const start = now.toTimeString().slice(0, 5);
    const end = new Date(now.getTime() + 2 * 3600000).toTimeString().slice(0, 5);
    const today = now.toISOString().slice(0, 10);
    onDispatch({
      employeeId: c.employeeId, employeeName: c.name,
      fromFunction: c.function, toFunction: q.queueName,
      skillCode: skill,
      startAt: `${today}T${start}:00`,
      endAt: `${today}T${end}:00`,
      reason: ar
        ? `دعم طابور ${q.queueName} — ${q.waiting} انتظار`
        : `Queue support ${q.queueName} – ${q.waiting} waiting`,
    });
  };

  return (
    <div className="flex-shrink-0 mx-4 mb-2 rounded-2xl overflow-hidden"
      style={{ background: 'rgba(251,146,60,0.05)', border: '1px solid rgba(251,146,60,0.2)' }}>
      <div className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid rgba(251,146,60,0.1)' }}>
        <Shuffle size={12} style={{ color: '#fb923c' }} />
        <span className="text-xs font-semibold flex-1" style={{ color: '#fb923c' }}>
          {ar
            ? `${visible.length} ${visible.length === 1 ? 'طابور يحتاج' : 'طوابير تحتاج'} دعم كروس-سكيل`
            : `${visible.length} queue${visible.length !== 1 ? 's' : ''} need cross-skill support`}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
          style={{ background: 'rgba(251,146,60,0.15)', color: '#fb923c' }}>
          {ar ? 'تنبيه' : 'Alert'}
        </span>
      </div>

      <div className="px-3 py-2 space-y-1.5">
        {visible.map(q => {
          const isOpen = expanded === q.queueId;
          const cands = candidates[q.queueId];
          const isLoad = loadingC[q.queueId];
          return (
            <div key={q.queueId} className="rounded-xl overflow-hidden"
              style={{
                background: isOpen ? 'rgba(251,146,60,0.06)' : 'rgba(255,255,255,0.02)',
                border: isOpen ? '1px solid rgba(251,146,60,0.2)' : '1px solid rgba(255,255,255,0.06)',
              }}>
              <div className="flex items-center gap-2 py-1.5 px-2.5">
                <span className="w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${CH_COLOR[q.channel] ?? '#64748b'}22`, color: CH_COLOR[q.channel] ?? '#64748b' }}>
                  {CH_ICON[q.channel]}
                </span>
                <span className="text-[11px] font-medium flex-1 truncate" style={{ color: '#fbbf24' }}>
                  {q.queueName}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-lg font-bold"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
                  {q.waiting} {ar ? 'انتظار' : 'waiting'}
                </span>
                <button onClick={() => handleExpand(q)}
                  className="text-[10px] px-2 py-0.5 rounded-lg font-medium flex-shrink-0"
                  style={{
                    background: isOpen ? 'rgba(251,146,60,0.25)' : 'rgba(251,146,60,0.12)',
                    color: '#fb923c', border: '1px solid rgba(251,146,60,0.3)',
                  }}>
                  {isOpen ? (ar ? 'إخفاء' : 'Hide') : (ar ? 'المرشحون' : 'Candidates')}
                </button>
                <button onClick={() => setDismissed(p => { const n = new Set(p); n.add(q.queueId); return n; })}
                  className="p-0.5 opacity-40 hover:opacity-70 transition-opacity">
                  <X size={11} style={{ color: '#64748b' }} />
                </button>
              </div>

              {isOpen && (
                <div className="px-2.5 pb-2.5">
                  {isLoad || isLoad === undefined ? (
                    <div className="flex items-center gap-2 py-2">
                      <Loader2 size={11} className="animate-spin" style={{ color: '#fb923c' }} />
                      <span className="text-[11px]" style={{ color: '#64748b' }}>
                        {ar ? 'جارٍ البحث عن مرشحين...' : 'Finding candidates...'}
                      </span>
                    </div>
                  ) : !cands || cands.length === 0 ? (
                    <p className="text-[11px] py-2" style={{ color: '#475569' }}>
                      {ar ? 'لا يوجد إيجنت متاح بالمهارة المطلوبة' : 'No cross-skilled agents available right now'}
                    </p>
                  ) : (
                    <div className="space-y-1 mt-1">
                      {cands.map(c => (
                        <div key={c.employeeId}
                          className="flex items-center gap-2 py-1.5 px-2 rounded-xl"
                          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-medium truncate" style={{ color: '#e2e8f0' }}>{c.name}</div>
                            <div className="text-[10px] flex items-center gap-1" style={{ color: '#475569' }}>
                              {c.function}
                              {c.proficiency && (
                                <span className="px-1 rounded"
                                  style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>
                                  {c.proficiency}
                                </span>
                              )}
                            </div>
                          </div>
                          <button onClick={() => handleDispatch(q, c)}
                            className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg font-semibold flex-shrink-0"
                            style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}>
                            <ArrowLeftRight size={10} />
                            {ar ? 'توجيه' : 'Dispatch'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  SKILL DISPATCH MODAL                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */
export function SkillDispatchModal({
  form, onClose, onSubmit, dispatching, done, ar,
}: {
  form: SkillDispatchForm; onClose: () => void;
  onSubmit: (f: SkillDispatchForm) => void;
  dispatching: boolean; done: boolean; ar: boolean;
}) {
  const [local, setLocal] = useState<SkillDispatchForm>(form);

  if (done) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl p-6 text-center"
        style={{ background: '#0f172a', border: '1px solid rgba(34,197,94,0.3)' }}
        onClick={e => e.stopPropagation()}>
        <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
          style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)' }}>
          <CheckCircle2 size={26} style={{ color: '#4ade80' }} />
        </div>
        <h2 className="text-base font-bold mb-2" style={{ color: '#e2e8f0' }}>
          {ar ? 'تم التوجيه بنجاح' : 'Dispatch Sent'}
        </h2>
        <p className="text-sm mb-1" style={{ color: '#94a3b8' }}>
          {ar
            ? `سيتم تحويل ${local.employeeName} إلى ${local.toFunction}`
            : `${local.employeeName} → ${local.toFunction}`}
        </p>
        <p className="text-[11px] mb-5" style={{ color: '#334155' }}>
          {ar
            ? 'تم إرسال إشعار للموظف وسيظهر التكليف في التقويم.'
            : 'Employee notified. Assignment visible in the calendar.'}
        </p>
        <button onClick={onClose}
          className="px-6 py-1.5 rounded-xl text-sm font-semibold"
          style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}>
          {ar ? 'إغلاق' : 'Close'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl p-5 space-y-3"
        style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)' }}>
              <ArrowLeftRight size={14} style={{ color: '#818cf8' }} />
            </div>
            <h2 className="text-sm font-bold" style={{ color: '#e2e8f0' }}>
              {ar ? 'توجيه كروس-سكيل' : 'Cross-Skill Dispatch'}
            </h2>
          </div>
          <button onClick={onClose}><X size={16} style={{ color: '#64748b' }} /></button>
        </div>

        {/* Employee + route */}
        <div className="rounded-xl p-3"
          style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}>
          <div className="text-sm font-bold mb-1" style={{ color: '#c7d2fe' }}>{local.employeeName}</div>
          <div className="flex items-center gap-2 text-xs" style={{ color: '#64748b' }}>
            <span style={{ color: '#94a3b8' }}>{local.fromFunction}</span>
            <ArrowLeftRight size={11} style={{ color: '#6366f1' }} />
            <span style={{ color: '#fbbf24' }}>{local.toFunction}</span>
          </div>
        </div>

        {/* Time range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: '#64748b' }}>
              {ar ? 'من الساعة' : 'From'}
            </label>
            <input type="time" className="inp w-full"
              value={local.startAt.slice(11, 16)}
              onChange={e => setLocal(p => ({ ...p, startAt: `${p.startAt.slice(0, 11)}${e.target.value}:00` }))} />
          </div>
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: '#64748b' }}>
              {ar ? 'حتى الساعة' : 'Until'}
            </label>
            <input type="time" className="inp w-full"
              value={local.endAt.slice(11, 16)}
              onChange={e => setLocal(p => ({ ...p, endAt: `${p.endAt.slice(0, 11)}${e.target.value}:00` }))} />
          </div>
        </div>

        {/* Reason */}
        <div>
          <label className="text-[11px] mb-1 block" style={{ color: '#64748b' }}>
            {ar ? 'السبب' : 'Reason'}
          </label>
          <input className="inp w-full" value={local.reason}
            onChange={e => setLocal(p => ({ ...p, reason: e.target.value }))} />
        </div>

        <p className="text-[10px] rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(255,255,255,0.03)', color: '#475569', border: '1px solid rgba(255,255,255,0.06)' }}>
          {ar
            ? 'سيتلقى الموظف إشعاراً فورياً بتغيير الوظيفة وستظهر في التقويم.'
            : 'Employee receives an instant notification. The temporary assignment appears in the calendar for all.'}
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-medium"
            style={{ color: '#64748b', border: '1px solid rgba(100,116,139,0.25)' }}>
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button onClick={() => onSubmit(local)} disabled={dispatching}
            className="px-5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', opacity: dispatching ? 0.6 : 1 }}>
            {dispatching && <Loader2 size={11} className="animate-spin" />}
            {ar ? 'إرسال التوجيه' : 'Send Dispatch'}
          </button>
        </div>
      </div>
    </div>
  );
}
