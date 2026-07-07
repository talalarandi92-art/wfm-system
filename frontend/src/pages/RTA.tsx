import {
  useState, useEffect, useCallback, useRef, useMemo,
} from 'react';
import {
  Radio, RefreshCw, UserCheck, Clock,
  Loader2, WifiOff, Activity, TrendingUp,
  AlertTriangle, Coffee, Tv,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, useInjectDsStyles } from '@/components/ds';
import {
  SpLive, BreakTracker, AgentTimeline, Coverage, QueueDetail,
  IncidentReport, SkillDispatchForm,
  DailyReport, ContactForecast, AdherenceReport, IntradayData, ViolationsReport,
  slaColor,
} from './rta/types';
import { KpiCard, QueueCard } from './rta/shared';
import { LiveAgentsPanel, Agent360Drawer, QueueDetailPanel } from './rta/LivePanels';
import { BreaksPanel, PermissionsPanel, CoveragePanel, AgentHoursPanel } from './rta/StationPanels';
import { ReportIncidentModal, UnauthorizedBreakAlert, CrossSkillAlertPanel, SkillDispatchModal } from './rta/IncidentsCrossSkill';
import { DailyReportPanel, AdherencePanel, CompliancePanel } from './rta/ReportPanels';
import { Wallboard, ExecutiveOverview } from './rta/WallboardPanels';

export default function RTAPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [live, setLive]           = useState<SpLive | null>(null);
  const [breakData, setBreakData] = useState<BreakTracker | null>(null);
  const [timeline, setTimeline]   = useState<AgentTimeline[]>([]);
  const [coverage, setCoverage]   = useState<Coverage | null>(null);
  const [queueDetail, setQueueDetail] = useState<QueueDetail | null>(null);
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);
  const [agent360Id, setAgent360Id] = useState<string | null>(null);
  const [tvMode, setTvMode] = useState(false);
  const [tab, setTab]   = useState<'overview' | 'queues' | 'liveagents' | 'breaks' | 'permissions' | 'coverage' | 'agents' | 'daily' | 'compliance' | 'adherence'>('queues');
  const [violations, setViolations] = useState<ViolationsReport | null>(null);
  const [adherence, setAdherence]   = useState<AdherenceReport | null>(null);
  const [intraday, setIntraday]     = useState<IntradayData | null>(null);
  const [adhRefreshing, setAdhRefreshing] = useState(false);
  const todayStr = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const [daily, setDaily]           = useState<DailyReport | null>(null);
  const [fc, setFc]                 = useState<ContactForecast | null>(null);
  const [dailyFrom, setDailyFrom]   = useState(todayStr);
  const [dailyTo, setDailyTo]       = useState(todayStr);
  const [dailyRefreshing, setDailyRefreshing] = useState(false);
  const [qFilter, setQFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [skillDispatch, setSkillDispatch] = useState<SkillDispatchForm | null>(null);
  const [dispatchingSkill, setDispatchingSkill] = useState(false);
  const [dispatchDone, setDispatchDone] = useState(false);
  const [incidentForm, setIncidentForm] = useState<IncidentReport | null>(null);
  const [pulse, setPulse]     = useState(false);
  const [tick, setTick]       = useState(0);
  const [now, setNow]         = useState(new Date());
  const spTimer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadLive = useCallback(async () => {
    try {
      const { data } = await apiClient.get<SpLive>('/integrations/sprinklr/live');
      setLive(data);
      setPulse(true);
      setTimeout(() => setPulse(false), 600);
    } catch { /* stale */ }
    setLoading(false);
  }, []);

  const loadQueueDetail = useCallback(async (queueId: string) => {
    try {
      const { data } = await apiClient.get<QueueDetail>(`/integrations/sprinklr/queue/${queueId}`);
      setQueueDetail(data);
    } catch { setQueueDetail(null); }
  }, []);

  const loadBreaks = useCallback(async () => {
    try {
      const { data } = await apiClient.get<BreakTracker>('/integrations/sprinklr/break-tracker');
      setBreakData(data);
    } catch { /* non-fatal */ }
  }, []);

  const loadTimeline = useCallback(async () => {
    try {
      const { data } = await apiClient.get<AgentTimeline[]>('/integrations/sprinklr/agent-timeline');
      setTimeline(data ?? []);
    } catch { /* non-fatal */ }
  }, []);

  const loadCoverage = useCallback(async () => {
    try {
      const { data } = await apiClient.get<Coverage>('/integrations/sprinklr/coverage');
      setCoverage(data);
    } catch { /* non-fatal */ }
  }, []);

  const loadDaily = useCallback(async (refresh = false) => {
    if (refresh) setDailyRefreshing(true);
    try {
      const [rep, fcast] = await Promise.all([
        apiClient.get<DailyReport>(`/integrations/sprinklr/agent-daily?from=${dailyFrom}&to=${dailyTo}${refresh ? '&refresh=1' : ''}`),
        apiClient.get<ContactForecast>('/integrations/sprinklr/contact-forecast?days=7'),
      ]);
      setDaily(rep.data);
      setFc(fcast.data);
    } catch { /* non-fatal */ }
    setDailyRefreshing(false);
  }, [dailyFrom, dailyTo]);

  useEffect(() => {
    if (tab === 'daily') loadDaily(false);
  }, [tab, loadDaily]);

  const loadViolations = useCallback(async () => {
    try {
      const { data } = await apiClient.get<ViolationsReport>(
        `/integrations/sprinklr/violations?from=${dailyFrom}&to=${dailyTo}`);
      setViolations(data);
    } catch { /* non-fatal */ }
  }, [dailyFrom, dailyTo]);

  useEffect(() => {
    if (tab === 'compliance') loadViolations();
  }, [tab, loadViolations]);

  const loadAdherence = useCallback(async (refresh = false) => {
    if (refresh) setAdhRefreshing(true);
    try {
      const [rep, intra] = await Promise.all([
        apiClient.get<AdherenceReport>(`/integrations/sprinklr/adherence?from=${dailyFrom}&to=${dailyTo}${refresh ? '&refresh=1' : ''}`),
        apiClient.get<IntradayData>(`/integrations/sprinklr/adherence-intraday?date=${dailyTo}`),
      ]);
      setAdherence(rep.data);
      setIntraday(intra.data);
    } catch { /* non-fatal */ }
    setAdhRefreshing(false);
  }, [dailyFrom, dailyTo]);

  useEffect(() => {
    if (tab === 'adherence') loadAdherence(false);
    if (tab === 'overview') { loadViolations(); loadAdherence(false); loadDaily(false); }
  }, [tab, loadAdherence]);

  const reviewViolation = useCallback(async (id: string, status: string) => {
    try {
      await apiClient.put(`/integrations/sprinklr/violations/${id}/status`, { status });
      loadViolations();
    } catch { /* non-fatal */ }
  }, [loadViolations]);

  useEffect(() => {
    loadLive(); loadBreaks(); loadTimeline(); loadCoverage();
    spTimer.current = setInterval(() => { loadLive(); setTick(t => t + 1); }, 10_000);
    const t2 = setInterval(() => { loadBreaks(); loadCoverage(); }, 30_000);
    const t3 = setInterval(loadTimeline, 60_000);
    return () => { clearInterval(spTimer.current); clearInterval(t2); clearInterval(t3); };
  }, [loadLive, loadBreaks, loadTimeline, loadCoverage]);

  useEffect(() => {
    if (selectedQueue) loadQueueDetail(selectedQueue);
  }, [selectedQueue, tick, loadQueueDetail]);

  const s = live?.summary;
  const filteredQueues = useMemo(() =>
    (live?.queues ?? [])
      .filter(q => !qFilter || q.queueName.toLowerCase().includes(qFilter.toLowerCase()))
      .sort((a, b) => b.waiting - a.waiting),
    [live?.queues, qFilter]);

  // Count idle as available (logged-in but not handling = available)
  const agAvail   = useMemo(() => (live?.agents ?? []).filter(a => a.status === 'available' || a.status === 'idle').length, [live]);
  const agBusy    = useMemo(() => (live?.agents ?? []).filter(a => a.status === 'busy').length, [live]);
  const agBreak   = useMemo(() => (live?.agents ?? []).filter(a => a.status === 'break' || a.status === 'away').length, [live]);
  const agOffline = useMemo(() => (live?.agents ?? []).filter(a => a.status === 'offline' || a.status === 'unknown').length, [live]);
  const selectedQueueObj = live?.queues.find(q => q.queueId === selectedQueue) ?? null;
  const isStale = live?.isStale ?? false;
  // Human-friendly age of the last snapshot, so a silent outage is obvious.
  const fmtStale = (sec: number) => {
    if (sec < 90) return ar ? `${sec}ث` : `${sec}s`;
    const m = Math.round(sec / 60); if (m < 90) return ar ? `${m}د` : `${m}m`;
    const h = Math.round(m / 60); if (h < 36) return ar ? `${h}س` : `${h}h`;
    const d = Math.round(h / 24); return ar ? `${d} يوم` : `${d}d`;
  };

  const gapQueues = useMemo(() =>
    (live?.queues ?? []).filter(q => q.waiting > 0 && (q.agentsAvailable < 5 || q.slaPct < 70)),
    [live]);

  const handleSkillDispatch = async (form: SkillDispatchForm) => {
    setDispatchingSkill(true);
    try {
      await apiClient.post('/skills/dispatch', {
        employeeId:   form.employeeId,
        fromFunction: form.fromFunction,
        toFunction:   form.toFunction,
        skillCode:    form.skillCode,
        startAt:      form.startAt,
        endAt:        form.endAt,
        reason:       form.reason,
      });
      setDispatchDone(true);
    } catch { /* non-fatal — modal stays open */ }
    setDispatchingSkill(false);
  };

  return (
    <div className="flex flex-col" dir={ar ? 'rtl' : 'ltr'}
      style={{ height: '100%', overflow: 'hidden' }}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 gap-3 flex-wrap"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.25)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.2)' }}>
            <Radio size={14} style={{ color: '#22d3ee' }} />
          </div>
          <div>
            <h1 className="text-sm font-bold leading-none" style={{ color: tp(dark) }}>
              {ar ? 'مراقبة الوقت الحقيقي' : 'Real-Time Monitoring'}
            </h1>
            <p className="text-[10px] mt-0.5" style={{ color: '#334155' }}>
              {now.toLocaleTimeString('en-u-nu-latn', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
              {' · '}{now.toLocaleDateString('en-u-nu-latn', { weekday: 'short', day: 'numeric', month: 'short' })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {live && !isStale ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px]"
              style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80' }}>
              <span className={`w-1.5 h-1.5 rounded-full bg-green-400 ${pulse ? 'scale-150' : ''} transition-transform`} />
              {ar ? `متصل · ${live.staleSec}ث` : `Live · ${live.staleSec}s`}
            </div>
          ) : isStale ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px]"
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24' }}>
              <WifiOff size={10} />{ar ? `بيانات قديمة · ${fmtStale(live!.staleSec)}` : `Stale · ${fmtStale(live!.staleSec)}`}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px]"
              style={{ background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.2)', color: '#64748b' }}>
              <Loader2 size={10} className="animate-spin" />{ar ? 'جارٍ الاتصال...' : 'Connecting...'}
            </div>
          )}
          <button onClick={() => { setTvMode(true); loadDaily(false); try { document.documentElement.requestFullscreen?.(); } catch { /* */ } }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:opacity-80 text-[11px] font-semibold"
            style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', color: '#a5b4fc' }}
            title={ar ? 'وضع شاشة العرض' : 'Wallboard / TV mode'}>
            <Tv size={13} /> {ar ? 'شاشة العرض' : 'Wallboard'}
          </button>
          <button onClick={() => { setLoading(true); loadLive(); loadBreaks(); loadTimeline(); loadCoverage(); }}
            className="p-1.5 rounded-lg hover:opacity-70"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <RefreshCw size={12} style={{ color: '#64748b' }} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── BRIDGE-OFFLINE BANNER (stale data self-explains) ───────────────── */}
      {isStale && live && (
        <div className="flex-shrink-0 mx-4 mt-2 flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-[11px]"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.28)', color: '#fbbf24' }}>
          <WifiOff size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ lineHeight: 1.55 }}>
            <b>{ar ? 'الجسر متوقف عن الإرسال' : 'The bridge is not pushing'}</b>{' — '}
            {ar
              ? `آخر بيانات وصلت قبل ${fmtStale(live.staleSec)}. الصفحة تعرض آخر لقطة معروفة (ليست لحظية).`
              : `last data arrived ${fmtStale(live.staleSec)} ago. Showing the last known snapshot (not live).`}
            <div className="mt-0.5" style={{ color: '#d97706' }}>
              {ar
                ? 'افتح تبويب Sprinklr مع إضافة WFM Bridge مفعّلة وثبّت التبويب (Pin) — ثم اضغط 🩺 في الإضافة للتشخيص.'
                : 'Open the Sprinklr tab with the WFM Bridge extension enabled and pin the tab — then click 🩺 in the extension to diagnose.'}
            </div>
          </div>
        </div>
      )}

      {/* ── KPI STRIP ──────────────────────────────────────────────────────── */}
      {s && (
        <div className="flex-shrink-0 grid grid-cols-5 gap-2 px-4 pt-2.5 pb-2">
          <KpiCard label={ar ? 'إجمالي الانتظار' : 'Waiting'}  val={s.totalWaiting}   color="#f59e0b" icon={Clock} />
          <KpiCard label={ar ? 'قيد التنفيذ'     : 'Active'}   val={s.totalInProgress} color="#818cf8" icon={Activity} />
          <KpiCard label={ar ? 'إيجنت متاح'      : 'Available'} val={s.totalAvailable || agAvail} color="#22c55e" icon={UserCheck} />
          <KpiCard label={ar ? 'في استراحة'      : 'On Break'}  val={agBreak}           color={agBreak > 0 ? '#818cf8' : '#475569'} icon={Coffee}
            sub={breakData && breakData.unauthorizedCount > 0 ? `${breakData.unauthorizedCount} ${ar ? 'غير مرخّص' : 'unauth'}` : undefined} />
          <KpiCard label={ar ? 'متوسط SLA'       : 'Avg SLA'}  val={`${s.avgSla}%`}   color={slaColor(s.avgSla)} icon={TrendingUp} />
        </div>
      )}

      {/* ── AT-RISK BANNER ─────────────────────────────────────────────────── */}
      {live && live.atRisk.length > 0 && (
        <div className="flex-shrink-0 mx-4 mb-1.5 rounded-xl px-3 py-1.5 flex items-center gap-2 flex-wrap"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertTriangle size={11} style={{ color: '#f87171' }} className="flex-shrink-0" />
          <span className="text-[11px] font-semibold me-1" style={{ color: '#f87171' }}>
            {ar ? `${live.atRisk.length} طوابير تحت SLA` : `${live.atRisk.length} below SLA`}
          </span>
          {live.atRisk.map(q => (
            <button key={q.queueId}
              onClick={() => { setSelectedQueue(q.queueId); setTab('queues'); }}
              className="text-[10px] px-1.5 py-0.5 rounded-full hover:opacity-80"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.25)' }}>
              {q.queueName} · {q.slaPct}%
            </button>
          ))}
        </div>
      )}

      {/* Agent Status row + Station mirror moved into the dedicated "Agents (live)"
          tab so the top stays a clean overview and each tab is focused. */}

      {/* ── UNAUTHORIZED BREAK ALERT ───────────────────────────────────────── */}
      {(breakData?.onBreakNow ?? []).filter(a => !a.isAuthorized).length > 0 && (
        <UnauthorizedBreakAlert
          agents={(breakData!.onBreakNow).filter(a => !a.isAuthorized)}
          ar={ar}
          onReport={inc => setIncidentForm(inc)}
        />
      )}

      {/* ── CROSS-SKILL ALERT ──────────────────────────────────────────────── */}
      {gapQueues.length > 0 && (
        <CrossSkillAlertPanel gapQueues={gapQueues} ar={ar}
          onDispatch={form => { setSkillDispatch(form); setDispatchDone(false); }} />
      )}

      {/* ── TABS (grouped: ● Live  |  ▣ Reports & performance) ───────────────── */}
      <div className="flex-shrink-0 flex items-center gap-1 px-4 pb-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {(() => {
          const groups: { groupAr: string; groupEn: string; dot: string; items: { key: typeof tab; label: string; alert: number }[] }[] = [
            { groupAr: 'تنفيذي', groupEn: 'Executive', dot: '#eab308', items: [
              { key: 'overview',    label: ar ? 'نظرة تنفيذية' : 'Overview',    alert: (live?.atRisk.length ?? 0) + (violations?.summary.open ?? 0) },
            ] },
            { groupAr: 'مباشر', groupEn: 'Live', dot: '#22c55e', items: [
              { key: 'queues',      label: ar ? 'الكيوز'      : 'Queues',      alert: live?.atRisk.length ?? 0 },
              { key: 'liveagents',  label: ar ? 'الإيجنتات'   : 'Agents',      alert: 0 },
              { key: 'coverage',    label: ar ? 'التغطية'     : 'Coverage',    alert: 0 },
              { key: 'breaks',      label: ar ? 'البريكات'    : 'Breaks',      alert: breakData?.unauthorizedCount ?? 0 },
              { key: 'permissions', label: ar ? 'الاستئذانات' : 'Permissions', alert: breakData?.activePermissions.length ?? 0 },
            ] },
            { groupAr: 'تقارير وأداء', groupEn: 'Reports', dot: '#818cf8', items: [
              { key: 'agents',      label: ar ? 'ساعات العمل'  : 'Work Hours',   alert: 0 },
              { key: 'daily',       label: ar ? 'التقرير اليومي' : 'Daily Report', alert: 0 },
              { key: 'adherence',   label: ar ? 'الالتزام'     : 'Adherence',    alert: adherence?.summary.below85 ?? 0 },
              { key: 'compliance',  label: ar ? 'المخالفات'    : 'Compliance',   alert: violations?.summary.open ?? 0 },
            ] },
          ];
          return groups.map((g, gi) => (
            <div key={g.groupEn} className="flex items-center gap-1 flex-shrink-0">
              {gi > 0 && <div className="mx-1.5 self-stretch" style={{ width: 1, background: 'rgba(255,255,255,0.1)' }} />}
              <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider me-0.5" style={{ color: '#475569' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: g.dot }} />{ar ? g.groupAr : g.groupEn}
              </span>
              {g.items.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all flex-shrink-0"
                  style={{
                    background: tab === t.key ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.03)',
                    color: tab === t.key ? '#818cf8' : '#475569',
                    border: tab === t.key ? '1px solid rgba(99,102,241,0.3)' : '1px solid rgba(255,255,255,0.06)',
                  }}>
                  {t.label}
                  {t.alert > 0 && <span className="px-1 rounded text-[9px] font-bold" style={{ background: '#ef444428', color: '#f87171' }}>{t.alert}</span>}
                </button>
              ))}
            </div>
          ));
        })()}
      </div>

      {/* ── CONTENT ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex" style={{ minHeight: 0 }}>

        {/* QUEUES TAB — grid left + detail right */}
        {tab === 'overview' && (
          <ExecutiveOverview live={live} breakData={breakData} coverage={coverage}
            violations={violations} adherence={adherence} fc={fc} ar={ar}
            onSelectQueue={(id) => { setSelectedQueue(id); setTab('queues'); }} />
        )}

        {tab === 'queues' && (
          <>
            {/* LEFT — queue grid (3 cols) */}
            <div className="flex flex-col"
              style={{ flex: selectedQueueObj ? '0 0 55%' : '1 1 auto', minWidth: 0, width: selectedQueueObj ? '55%' : '100%', transition: 'flex-basis 0.25s ease, width 0.25s ease', borderInlineEnd: selectedQueueObj ? '1px solid rgba(255,255,255,0.07)' : 'none', overflow: 'hidden' }}>

              {/* Search + channel filter */}
              <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
                <input value={qFilter} onChange={e => setQFilter(e.target.value)}
                  placeholder={ar ? 'بحث عن طابور...' : 'Search queue...'}
                  className="flex-1 rounded-xl text-xs py-1.5 outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0', paddingInlineStart: 10 }} />
                <span className="text-[10px] flex-shrink-0" style={{ color: '#334155' }}>
                  {filteredQueues.length} {ar ? 'طابور' : 'queues'}
                </span>
              </div>

              {/* Grid */}
              <div className="flex-1 overflow-y-auto px-3 pb-3" style={{ scrollbarWidth: 'thin' }}>
                {!live ? (
                  <div className="flex flex-col items-center justify-center h-40">
                    <WifiOff size={28} className="mb-2" style={{ color: '#1e293b' }} />
                    <p className="text-xs" style={{ color: '#334155' }}>{ar ? 'لا توجد بيانات سبرينكلر' : 'No Sprinklr data'}</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: selectedQueueObj ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: 8 }}>
                    {filteredQueues.map(q => (
                      <QueueCard key={q.queueId} q={q} ar={ar}
                        selected={selectedQueue === q.queueId}
                        onClick={() => setSelectedQueue(p => p === q.queueId ? null : q.queueId)} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT — detail panel (only when queue selected) */}
            {selectedQueueObj && (
              <div className="flex-1 overflow-y-auto px-4 py-3 pb-6" style={{ scrollbarWidth: 'thin', minWidth: 0 }}>
                <QueueDetailPanel q={selectedQueueObj} detail={queueDetail}
                  agents={live?.agents ?? []} breakData={breakData} ar={ar}
                  onClose={() => setSelectedQueue(null)} onSelectAgent={setAgent360Id} />
              </div>
            )}
          </>
        )}

        {tab === 'liveagents' && (
          <div className="flex-1 overflow-y-auto px-4 py-2 pb-6" style={{ scrollbarWidth: 'thin' }}>
            <LiveAgentsPanel live={live} breakData={breakData} ar={ar} onSelectAgent={setAgent360Id} />
          </div>
        )}

        {tab === 'breaks' && (
          <div className="flex-1 overflow-y-auto px-4 py-2 pb-6" style={{ scrollbarWidth: 'thin' }}>
            <BreaksPanel breakData={breakData} ar={ar} />
          </div>
        )}
        {tab === 'permissions' && (
          <div className="flex-1 overflow-y-auto px-4 py-2 pb-6" style={{ scrollbarWidth: 'thin' }}>
            <PermissionsPanel breakData={breakData} ar={ar} />
          </div>
        )}
        {tab === 'coverage' && (
          <div className="flex-1 overflow-y-auto px-4 py-2 pb-6" style={{ scrollbarWidth: 'thin' }}>
            <CoveragePanel coverage={coverage} live={live} ar={ar} />
          </div>
        )}
        {tab === 'agents' && (
          <div className="flex-1 overflow-y-auto px-4 py-2 pb-6" style={{ scrollbarWidth: 'thin' }}>
            <AgentHoursPanel timeline={timeline} liveAgents={live?.agents ?? []} ar={ar} />
          </div>
        )}
        {tab === 'daily' && (
          <div className="flex-1 overflow-y-auto px-4 py-2 pb-6" style={{ scrollbarWidth: 'thin' }}>
            <DailyReportPanel report={daily} forecast={fc} ar={ar}
              from={dailyFrom} to={dailyTo}
              onRange={(f, t) => { setDailyFrom(f); setDailyTo(t); }}
              onRefresh={() => loadDaily(true)} refreshing={dailyRefreshing} />
          </div>
        )}
        {tab === 'compliance' && (
          <div className="flex-1 overflow-y-auto px-4 py-2 pb-6" style={{ scrollbarWidth: 'thin' }}>
            <CompliancePanel report={violations} ar={ar}
              from={dailyFrom} to={dailyTo}
              onRange={(f, t) => { setDailyFrom(f); setDailyTo(t); }}
              onReview={reviewViolation} />
          </div>
        )}
        {tab === 'adherence' && (
          <div className="flex-1 overflow-y-auto px-4 py-2 pb-6" style={{ scrollbarWidth: 'thin' }}>
            <AdherencePanel report={adherence} intraday={intraday} ar={ar}
              from={dailyFrom} to={dailyTo}
              onRange={(f, t) => { setDailyFrom(f); setDailyTo(t); }}
              onRefresh={() => loadAdherence(true)} refreshing={adhRefreshing} />
          </div>
        )}
      </div>

      {/* ── REPORT INCIDENT MODAL ──────────────────────────────────────────── */}
      {incidentForm && (
        <ReportIncidentModal
          initial={incidentForm}
          ar={ar}
          onClose={() => setIncidentForm(null)}
        />
      )}

      {/* ── SKILL DISPATCH MODAL ───────────────────────────────────────────── */}
      {skillDispatch && (
        <SkillDispatchModal
          form={skillDispatch}
          dispatching={dispatchingSkill}
          done={dispatchDone}
          ar={ar}
          onClose={() => { setSkillDispatch(null); setDispatchDone(false); }}
          onSubmit={handleSkillDispatch}
        />
      )}

      {/* ── AGENT 360 DRAWER ───────────────────────────────────────────────── */}
      {agent360Id && (
        <Agent360Drawer
          agentId={agent360Id}
          fallbackName={live?.agents.find(a => a.agentId === agent360Id)?.agentName}
          ar={ar} dark={dark}
          onClose={() => setAgent360Id(null)}
        />
      )}

      {/* ── WALLBOARD / TV MODE ────────────────────────────────────────────── */}
      {tvMode && (
        <Wallboard live={live} breakData={breakData} fc={fc} coverage={coverage} ar={ar}
          onClose={() => { setTvMode(false); try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch { /* */ } }} />
      )}
    </div>
  );
}
