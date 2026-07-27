/**
 * RTA COMMAND CENTER — mission control, told as a story.
 *
 * Executive strip (<Kpi> provenance tiles + freshness) →
 * ① live status board (who is in which state, right now) →
 * ② intraday adherence & coverage (scheduled vs actual, per interval) →
 * ③ queue health (real queues — or an honest degraded banner) →
 * ④ alerts feed (severity-sorted).
 *
 * HONESTY IS THE HEADLINE. A missing/degraded feed renders AS degraded:
 * SLA shows "—" with an explicit "queue feed missing — UNKNOWN (not zero)"
 * banner, never a fake green 100%. Endpoints that are not deployed yet
 * (/rta/intraday, /rta/alerts) graceful-hide behind an awaiting state instead of
 * inventing numbers.
 *
 * Same shared design language as the Capacity / Schedule / Roster rebuilds:
 * numbered Section cards, <Kpi> provenance, one-meaning-per-hue palette, nfmt
 * numbers, AR/EN inline, all three themes in-page, RTL.
 */
import { useMemo, useState } from 'react';
import {
  Users, Gauge, ShieldCheck, Signal, Siren, Activity,
  LayoutGrid, Radar, Bell, TrendingUp, Clock,
} from 'lucide-react';
import { Kpi, KpiRow } from '@/components/kpi';
import { useUiStore } from '@/store/ui.store';
import {
  SpLive, BreakTracker, Coverage, ViolationsReport, AdherenceReport, slaColor,
} from './types';
import {
  QPAL, nfmt, pctFmt, hhmm, riskHue, fmtAgo, ink, foldCoverage,
  Section, Awaiting, Degraded, FreshChip, Pulse, MiniBar, HeatCell,
  useMaybe, readIntraday, readAlerts, alertHue, sevRank,
  type RtaAlert,
} from './kit';
import { AgentDonut, AgentBoard, AgentStateBreakdown } from './LivePanels';
import { kwToday } from '@/utils/format';

const SP_LIVE_EP = 'GET /api/v1/integrations/sprinklr/live';
const COV_EP = 'GET /api/v1/integrations/sprinklr/coverage';
const ADH_EP = 'GET /api/v1/integrations/sprinklr/adherence';

/* Kuwait "today" — the same anchor the rest of the RTA page uses. */


export default function CommandCenter({
  live, breakData, coverage, violations, adherence, ar, onSelectQueue, onSelectAgent, pulse,
}: {
  live: SpLive | null; breakData: BreakTracker | null; coverage: Coverage | null;
  violations: ViolationsReport | null; adherence: AdherenceReport | null;
  ar: boolean;
  onSelectQueue?: (id: string) => void;
  onSelectAgent?: (id: string) => void;
  pulse?: boolean;                    // parent's 10s live-poll heartbeat
}) {
  const { dark } = useUiStore();
  /* colour text through ink() so the light theme keeps ≥4.4:1 without changing
     the semantic hue; dots/bars/tints keep the vivid palette. */
  const T = (c: string) => ink(c, dark);
  const [date, setDate] = useState(kwToday());
  const [fn, setFn] = useState('');

  /* ── live agent mix (the one canonical bucketing, shared with the wallboard) ── */
  const agents = live?.agents ?? [];
  const avail = agents.filter(a => a.status === 'available' || a.status === 'idle').length;
  const busy = agents.filter(a => a.status === 'busy').length;
  const brk = agents.filter(a => a.status === 'break' || a.status === 'away').length;
  const off = agents.filter(a => a.status === 'offline' || a.status === 'unknown').length;
  const online = avail + busy + brk;               // logged in and reachable
  const s = live?.summary;

  /* ── the honesty gate: a degraded queue feed makes SLA UNKNOWN, never 100 ── */
  const feedDegraded = !!live?.queueFeedMissing || (agents.length > 0 && (live?.queues.length ?? 0) === 0);
  const avgSla = s?.avgSla ?? null;                // null ⇒ UNKNOWN
  const queues = useMemo(
    () => [...(live?.queues ?? [])].sort((a, b) => {
      const ra = (a.slaPct ?? 100) < 80 || a.waiting > 50 ? 0 : 1;
      const rb = (b.slaPct ?? 100) < 80 || b.waiting > 50 ? 0 : 1;
      return ra - rb || (b.waiting || 0) - (a.waiting || 0);
    }),
    [live?.queues]);

  /* ── coverage curve ───────────────────────────────────────────────────────
     Folded through the shared `foldCoverage` (kit.tsx) so this panel and the
     Coverage station cannot disagree: per-function rows summed to a floor
     total, and `liveUsable` deciding the honest basis (live bridge, or the
     SCHEDULED column explicitly labelled as such when live is stale/empty). */
  const covCurve = useMemo(() => foldCoverage(coverage?.intervals), [coverage]);

  /* the interval containing the current hour (Asia/Kuwait) */
  const covNow = useMemo(() => {
    if (!covCurve?.rows.length) return null;
    const nowH = String(new Date(Date.now() + 3 * 3600e3).getUTCHours()).padStart(2, '0');
    const hit = covCurve.rows.find(r => r.at.startsWith(`${nowH}:`)) ?? null;
    if (!hit) return null;
    return {
      req: hit.req, have: hit.have, gap: hit.gap,
      pct: hit.req > 0 ? (hit.have / hit.req) * 100 : null,
      at: hit.at, date: covCurve.date, live: covCurve.liveUsable,
    };
  }, [covCurve]);
  const covToday = covNow?.date === kwToday();

  const avgAdh = adherence?.summary.avgAdherence ?? null;
  const below85 = adherence?.summary.below85 ?? 0;
  const openViol = violations?.summary.open ?? 0;
  const unauth = breakData?.unauthorizedCount ?? 0;

  /* ── NEW endpoints (parallel backend agent) — hide-on-404 ────────────────── */
  const intraRes = useMaybe(`/rta/intraday?date=${date}${fn ? `&function=${encodeURIComponent(fn)}` : ''}`, 60_000);
  const intraday = useMemo(() => (intraRes.status === 'live' ? readIntraday(intraRes.data) : null), [intraRes]);
  const alertsRes = useMaybe('/rta/alerts', 30_000);
  const svcAlerts = useMemo(() => (alertsRes.status === 'live' ? readAlerts(alertsRes.data) : null), [alertsRes]);

  /* ── locally-derived alerts: always available, always labelled as derived ── */
  const localAlerts = useMemo<RtaAlert[]>(() => {
    const out: RtaAlert[] = [];
    if (feedDegraded) out.push({
      severity: 'high', type: 'feed_degraded', metric: 'avgSla',
      text: 'Queue feed missing — SLA, waiting and at-risk queues are UNKNOWN (not zero).',
      textAr: 'تغذية الطوابير مفقودة — SLA وعدد المنتظرين والطوابير تحت الخطر غير معروفة (ليست ٠).',
    });
    if (live?.isStale) out.push({
      severity: 'high', type: 'bridge_stale', metric: fmtAgo(live.staleSec, ar),
      text: `Bridge not pushing — last snapshot ${fmtAgo(live.staleSec, false)} old.`,
      textAr: `الجسر متوقف عن الإرسال — آخر لقطة عمرها ${fmtAgo(live.staleSec, true)}.`,
    });
    (live?.atRisk ?? []).forEach(q => out.push({
      severity: 'critical', type: 'sla_breach', metric: `${q.slaPct}%`,
      text: `${q.queueName} below SLA — ${q.slaPct}% · ${q.waiting} waiting.`,
      textAr: `${q.queueName} تحت الـSLA — ${q.slaPct}٪ · ${q.waiting} بالانتظار.`,
    }));
    if (unauth > 0) out.push({
      severity: 'warning', type: 'unauthorized_break', metric: String(unauth),
      text: `${unauth} unauthorized break${unauth > 1 ? 's' : ''} in progress.`,
      textAr: `${unauth} بريك غير مرخّص جارٍ الآن.`,
    });
    if (covNow && covNow.gap < 0) out.push({
      severity: 'critical', type: 'coverage_gap', metric: String(covNow.gap),
      text: `Coverage gap now (${covNow.at}) — ${covNow.have} on seat vs ${covNow.req} required.`,
      textAr: `فجوة تغطية الآن (${covNow.at}) — ${covNow.have} على المقعد مقابل ${covNow.req} مطلوب.`,
    });
    if (below85 > 0) out.push({
      severity: 'warning', type: 'adherence_low', metric: String(below85),
      text: `${below85} agent${below85 > 1 ? 's' : ''} below 85% adherence today.`,
      textAr: `${below85} موظف تحت ٨٥٪ التزام اليوم.`,
    });
    if (openViol > 0) out.push({
      severity: 'info', type: 'open_violations', metric: String(openViol),
      text: `${openViol} open compliance violation${openViol > 1 ? 's' : ''} awaiting review.`,
      textAr: `${openViol} مخالفة مفتوحة بانتظار المراجعة.`,
    });
    return out.sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
  }, [feedDegraded, live, unauth, covNow, below85, openViol, ar]);

  const openAlerts = (svcAlerts?.length ?? 0) + localAlerts.length;

  /* ── posture: a degraded feed can NEVER read as "all clear" ──────────────── */
  const posture = (live?.atRisk.length ?? 0) > 0 || (covNow && covNow.gap < 0) || below85 > 3 || unauth > 2
    ? { c: QPAL.gap, en: 'Risk — needs intervention now', arT: 'خطر — يتطلّب تدخّلاً الآن' }
    : feedDegraded || live?.isStale || openViol > 0 || unauth > 0 || (avgSla ?? 100) < 90
      ? { c: QPAL.watch, en: 'Caution — watch closely', arT: 'انتباه — راقب عن قرب' }
      : { c: QPAL.ok, en: 'Stable — everything on target', arT: 'مستقرّ — كل شيء ضمن الهدف' };

  /* function options — from the live people the bridge actually sees */
  const fnOptions = useMemo(() => {
    const set = new Set<string>();
    [...(breakData?.onBreakNow ?? []), ...(breakData?.availableNow ?? []), ...(breakData?.busyNow ?? [])]
      .forEach(a => { if (a.functionName) set.add(a.functionName); });
    return [...set].sort();
  }, [breakData]);

  const period = `${date}`;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ scrollbarWidth: 'thin' }} dir={ar ? 'rtl' : 'ltr'}>

      {/* ── POSTURE + FRESHNESS ─────────────────────────────────────────────── */}
      <div className="rounded-2xl px-4 py-2.5 flex items-center gap-3 flex-wrap"
        style={{ background: `${posture.c}12`, border: `1px solid ${posture.c}44` }}>
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ background: posture.c, boxShadow: `0 0 10px ${posture.c}` }} />
        <span className="text-[13px] font-extrabold" style={{ color: T(posture.c) }}>
          {ar ? 'الوضع التنفيذي' : 'Operational posture'}: {ar ? posture.arT : posture.en}
        </span>
        <div className="flex items-center gap-2 flex-wrap" style={{ marginInlineStart: 'auto' }}>
          {feedDegraded && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
              style={{ background: `${QPAL.gap}18`, border: `1px solid ${QPAL.gap}44`, color: T(QPAL.gap) }}>
              {ar ? 'تغذية طوابير مفقودة' : 'queue feed missing'}
            </span>
          )}
          <FreshChip ar={ar} staleSec={live?.staleSec} isStale={live?.isStale}
            connecting={!live} pulse={pulse} />
        </div>
      </div>

      {/* ── EXECUTIVE STRIP — every number traceable (ⓘ) ─────────────────────── */}
      <KpiRow cols={6}>
        <Kpi
          label={ar ? 'موظفون متصلون' : 'Agents online'}
          value={live ? <Pulse value={online} color={QPAL.ok}>{nfmt(online)}</Pulse> : '—'}
          sub={!live ? (ar ? 'بانتظار الجسر' : 'awaiting the bridge')
            : live.isStale
              ? (ar ? `لقطة قديمة (${fmtAgo(live.staleSec, ar)}) — ليست الآن` : `stale snapshot (${fmtAgo(live.staleSec, ar)}) — not now`)
              : `${nfmt(avail)} ${ar ? 'متاح' : 'avail'} · ${nfmt(busy)} ${ar ? 'مشغول' : 'busy'} · ${nfmt(brk)} ${ar ? 'بريك' : 'break'}`}
          accent={QPAL.ok}
          icon={<Users size={15} strokeWidth={2.2} />}
          source={{
            endpoint: SP_LIVE_EP, table: 'sprinklr_live_snapshots',
            definition: 'Agents seen by the Sprinklr bridge in a reachable state (available + idle + busy + break). Offline/unknown excluded.',
            definitionAr: 'الموظفون الذين يراهم جسر سبرينكلر في حالة قابلة للوصول (متاح + خامل + مشغول + بريك). المستبعد: غير متصل/غير معروف.',
            period: live ? `${ar ? 'لقطة عمرها' : 'snapshot age'} ${fmtAgo(live.staleSec, ar)}` : undefined,
          }}
        />
        <Kpi
          label={ar ? 'SLA الحيّ' : 'Live SLA'}
          value={avgSla == null ? '—' : <Pulse value={avgSla} color={slaColor(avgSla)}>{`${avgSla}%`}</Pulse>}
          sub={avgSla == null
            ? (feedDegraded ? (ar ? 'غير معروف — لا تغذية طوابير' : 'UNKNOWN — no queue feed') : (ar ? 'بانتظار البيانات' : 'awaiting data'))
            : `${nfmt(s?.totalWaiting)} ${ar ? 'بالانتظار' : 'waiting'} · ${nfmt(queues.length)} ${ar ? 'طابور' : 'queues'}`}
          accent={avgSla == null ? QPAL.degraded : slaColor(avgSla)}
          icon={<Signal size={15} strokeWidth={2.2} />}
          source={{
            endpoint: SP_LIVE_EP, table: 'sprinklr_live_snapshots (queue rows)',
            definition: 'Average SLA % across live queues. NULL when the bridge sees agents but no queues — rendered "—" and flagged degraded, never a fabricated 100%.',
            definitionAr: 'متوسط نسبة الـSLA على الطوابير الحيّة. يكون NULL عندما يرى الجسر الموظفين بلا طوابير — يُعرض "—" ويُعلَّم كمتدهور، ولا يُختلق ١٠٠٪ أبدًا.',
          }}
        />
        <Kpi
          label={ar ? 'التغطية الآن' : 'Coverage now'}
          value={covNow ? <Pulse value={covNow.have} color={riskHue(covNow.pct)}>{`${nfmt(covNow.have)}/${nfmt(covNow.req)}`}</Pulse> : '—'}
          sub={!covNow ? (ar ? 'بانتظار منحنى التغطية' : 'awaiting coverage curve')
            : `${covNow.gap < 0
              ? (ar ? `فجوة ${nfmt(Math.abs(covNow.gap))}` : `${nfmt(Math.abs(covNow.gap))} short`)
              : (ar ? `فائض ${nfmt(covNow.gap)}` : `${nfmt(covNow.gap)} spare`)
            } · ${covNow.at} · ${covNow.live ? (ar ? 'حيّ' : 'live') : (ar ? 'مجدول (الجسر قديم)' : 'scheduled (bridge stale)')}${
              covToday ? '' : ` · ${covNow.date}`}`}
          accent={covNow ? (covNow.gap < 0 ? QPAL.gap : covNow.gap === 0 ? QPAL.watch : QPAL.ok) : QPAL.degraded}
          icon={<Gauge size={15} strokeWidth={2.2} />}
          source={{
            endpoint: COV_EP, table: 'headcount requirement × roster_days × live bridge',
            definition: 'HC on seat vs required HC for the interval containing the current hour (Asia/Kuwait), summed across ALL functions — the endpoint returns one row per function per interval. Basis is the live bridge column; when that is stale/empty it falls back to the SCHEDULED column and says so.',
            definitionAr: 'الـHC على المقعد مقابل المطلوب للفترة التي تحوي الساعة الحالية (توقيت الكويت)، مجموعًا على كل الفنكشنز — الواجهة ترجع صفًا لكل فنكشن لكل فترة. الأساس هو عمود الجسر الحيّ؛ وعند تقادمه/خلوّه يُستخدم العمود المجدول مع التصريح بذلك.',
            period: covNow ? `${covNow.date ?? ''} ${ar ? 'فترة' : 'interval'} ${covNow.at}`.trim() : undefined,
          }}
        />
        <Kpi
          label={ar ? 'الالتزام اليوم' : 'Adherence today'}
          value={avgAdh != null ? pctFmt(avgAdh) : '—'}
          sub={avgAdh != null
            ? `${nfmt(adherence?.summary.measured)} ${ar ? 'مقيس' : 'measured'}${below85 ? ` · ${below85} ${ar ? 'تحت ٨٥٪' : 'below 85%'}` : ''}`
            : (ar ? 'بانتظار حساب الالتزام' : 'awaiting adherence run')}
          accent={riskHue(avgAdh)}
          icon={<ShieldCheck size={15} strokeWidth={2.2} />}
          source={{
            endpoint: ADH_EP, table: 'sprinklr_agent_daily × roster_days',
            definition: 'Average adherence % = minutes in the scheduled state ÷ scheduled minutes, across agents matched to a roster shift today.',
            definitionAr: 'متوسط نسبة الالتزام = الدقائق داخل الحالة المجدولة ÷ الدقائق المجدولة، للموظفين المطابقين لشفت في الروستر اليوم.',
            period,
          }}
        />
        <Kpi
          label={ar ? 'تنبيهات مفتوحة' : 'Open alerts'}
          value={<Pulse value={openAlerts} color={openAlerts > 0 ? QPAL.gap : QPAL.ok}>{nfmt(openAlerts)}</Pulse>}
          sub={svcAlerts
            ? `${nfmt(svcAlerts.length)} ${ar ? 'من المحرك' : 'from engine'} · ${nfmt(localAlerts.length)} ${ar ? 'مشتقّة' : 'derived'}`
            : alertsRes.status === 'loading' ? '…'
            : (ar ? `${nfmt(localAlerts.length)} مشتقّة · بانتظار محرك التنبيهات` : `${nfmt(localAlerts.length)} derived · awaiting alerts engine`)}
          accent={openAlerts > 0 ? QPAL.gap : QPAL.ok}
          icon={<Siren size={15} strokeWidth={2.2} />}
          source={{
            endpoint: 'GET /api/v1/rta/alerts',
            definition: 'Alerts raised by the RTA engine plus alerts derived in-page from the live snapshot (SLA breach, coverage gap, stale/degraded feed, unauthorized breaks).',
            definitionAr: 'التنبيهات الصادرة من محرك الـRTA بالإضافة إلى تنبيهات مشتقّة داخل الصفحة من اللقطة الحيّة (خرق SLA، فجوة تغطية، تغذية قديمة/متدهورة، بريكات غير مرخّصة).',
          }}
        />
        <Kpi
          label={ar ? 'قيد المعالجة' : 'In progress'}
          /* degraded queue feed ⇒ UNKNOWN, exactly like SLA — a 0 here would read
             as "nothing in flight", which is a claim we cannot make. */
          value={s && !feedDegraded ? <Pulse value={s.totalInProgress} color={QPAL.busy}>{nfmt(s.totalInProgress)}</Pulse> : '—'}
          sub={feedDegraded
            ? (ar ? 'غير معروف — لا تغذية طوابير' : 'UNKNOWN — no queue feed')
            : `${nfmt(busy)} ${ar ? 'موظف مشغول' : 'agents busy'}`}
          accent={feedDegraded ? QPAL.degraded : QPAL.busy}
          icon={<Activity size={15} strokeWidth={2.2} />}
          source={{
            endpoint: SP_LIVE_EP, table: 'sprinklr_live_snapshots (queue rows)',
            definition: 'Conversations currently being handled across live queues. UNKNOWN while the queue feed is degraded.',
            definitionAr: 'المحادثات قيد المعالجة حاليًا عبر الطوابير الحيّة. غير معروفة أثناء تدهور تغذية الطوابير.',
          }}
        />
      </KpiRow>

      {/* ── ① LIVE STATUS BOARD ─────────────────────────────────────────────── */}
      <Section no="١" icon={LayoutGrid} color={QPAL.ok}
        title={ar ? 'لوحة الحالة الحيّة' : 'Live status board'}
        desc={ar
          ? 'كل موظف يراه الجسر الآن — في أي حالة، ومنذ متى. هذه أرقام مقاسة، لا تقديرات.'
          : 'Every agent the bridge can see right now — which state, and for how long. Measured, not estimated.'}
        actions={<FreshChip ar={ar} staleSec={live?.staleSec} isStale={live?.isStale} connecting={!live} pulse={pulse} />}>
        {!live ? (
          <Awaiting ar={ar}
            text="Connecting to the Sprinklr bridge — no live snapshot yet."
            textAr="جارٍ الاتصال بجسر سبرينكلر — لا توجد لقطة حيّة بعد." />
        ) : agents.length === 0 ? (
          <Degraded ar={ar}
            title="No agents in the snapshot" titleAr="لا يوجد موظفون في اللقطة"
            body="the bridge is reachable but reported zero agents — treat this as UNKNOWN, not as an empty floor."
            bodyAr="الجسر متصل لكنه أبلغ عن صفر موظف — اعتبر هذا غير معروف، وليس أرضية فارغة."
            fix="Open the Sprinklr Supervisor station with the WFM Bridge extension enabled and pin the tab."
            fixAr="افتح محطة Sprinklr Supervisor مع إضافة WFM Bridge مفعّلة وثبّت التبويب." />
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(190px, 240px) 1fr' }}>
              {/* donut — theme-aware in-page (keepDark stays a Wallboard-only concern) */}
              <div className="rounded-2xl flex items-center justify-center py-2"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <AgentDonut avail={avail} busy={busy} brk={brk} off={off} ar={ar} size={140} thickness={15} />
              </div>
              {/* floor context — the SCHEDULE side of the same moment (the donut
                  already carries the state mix, so this adds, never repeats) */}
              <div className="rounded-2xl p-3"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-3)' }}>
                  {ar ? 'الأرضية الآن — الجانب المجدول' : 'The floor right now — the scheduled side'}
                </div>
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
                  {[
                    {
                      k: 'seat', l: ar ? 'على المقعد / مطلوب' : 'On seat / required',
                      v: covNow ? `${nfmt(covNow.have)} / ${nfmt(covNow.req)}` : '—',
                      c: covNow ? (covNow.gap < 0 ? QPAL.gap : covNow.gap === 0 ? QPAL.watch : QPAL.ok) : QPAL.degraded,
                      bar: covNow?.pct ?? null,
                      note: covNow
                        ? `${covNow.at} · ${covNow.live ? (ar ? 'حيّ' : 'live') : (ar ? 'مجدول' : 'scheduled')}${covToday ? '' : ` · ${covNow.date}`}`
                        : (ar ? 'بانتظار المنحنى' : 'awaiting curve'),
                    },
                    {
                      /* "0 / 0" would read as "nobody came to work" — alarming, and false.
                         Nothing scheduled means the roster has not been published for this
                         date, which is a fact about the SYSTEM, not about the floor. Say
                         that instead; never let an absent input look like a measurement. */
                      k: 'punch', l: ar ? 'حضور / مجدول' : 'Punched / scheduled',
                      v: !coverage?.attendance ? '—'
                        : coverage.attendance.total_scheduled > 0
                          ? `${nfmt(coverage.attendance.punched_in)} / ${nfmt(coverage.attendance.total_scheduled)}`
                          : (ar ? 'لا يوجد روستر' : 'no roster'),
                      c: coverage?.attendance && coverage.attendance.total_scheduled === 0 ? QPAL.degraded : QPAL.brand,
                      bar: coverage?.attendance && coverage.attendance.total_scheduled > 0
                        ? (coverage.attendance.punched_in / coverage.attendance.total_scheduled) * 100 : null,
                      note: coverage?.attendance && coverage.attendance.total_scheduled === 0
                        ? (ar ? 'الروستر غير منشور لهذا اليوم' : 'roster not published for this date')
                        : (ar ? 'من الروستر اليوم' : "from today's roster"),
                    },
                    {
                      k: 'perm', l: ar ? 'على استئذان' : 'On permission',
                      v: coverage ? nfmt(coverage.onPermission) : '—',
                      c: (coverage?.onPermission ?? 0) > 0 ? QPAL.watch : QPAL.ok, bar: null,
                      note: ar ? 'استئذان معتمد نشط' : 'approved & active now',
                    },
                    {
                      k: 'brk', l: ar ? 'بريك: مرخّص / غير' : 'Breaks: auth / unauth',
                      v: breakData ? `${nfmt(breakData.authorizedCount)} / ${nfmt(unauth)}` : '—',
                      c: unauth > 0 ? QPAL.gap : QPAL.brk, bar: null,
                      note: ar ? 'مقارنة ببريك مانجمنت' : 'vs break management',
                    },
                  ].map(x => (
                    <div key={x.k} className="rounded-xl p-2.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      <div className="text-[9.5px] mb-1" style={{ color: 'var(--text-3)' }}>{x.l}</div>
                      <div className="text-[17px] font-extrabold tabular-nums leading-none" style={{ color: T(x.c), letterSpacing: '-.02em' }}>
                        <Pulse value={x.v} color={x.c}>{x.v}</Pulse>
                      </div>
                      {x.bar != null && <div className="mt-1.5"><MiniBar pct={x.bar} color={x.c} height={4} /></div>}
                      <div className="text-[9px] mt-1.5" style={{ color: 'var(--text-3)' }}>{x.note}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 mt-2.5 text-[10px]" style={{ color: 'var(--text-3)' }}>
                  <Clock size={10} style={{ color: QPAL.degraded }} />
                  {ar
                    ? 'الدائرة = ما يراه سبرينكلر · هذه البطاقات = ما يقوله الروستر. الفرق بينهما هو عمل الـRTA.'
                    : 'The donut is what Sprinklr sees · these cards are what the roster says. The gap between them is the RTA job.'}
                </div>
              </div>
            </div>
            <AgentStateBreakdown agents={agents} breakData={breakData} ar={ar} onSelectAgent={onSelectAgent} />
            <AgentBoard ar={ar} onSelectAgent={onSelectAgent} />
          </div>
        )}
      </Section>

      {/* ── ② INTRADAY ADHERENCE & COVERAGE ─────────────────────────────────── */}
      <Section no="٢" icon={Radar} color={QPAL.info}
        title={ar ? 'الالتزام والتغطية خلال اليوم' : 'Intraday adherence & coverage'}
        desc={ar
          ? 'مجدول مقابل فعلي لكل فترة — وأين تفتح فجوة التغطية قبل أن تضرب الـSLA.'
          : 'Scheduled vs actual per interval — and where a coverage gap opens before it hits SLA.'}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="px-2 py-1 rounded-lg text-[11px] outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }} />
            {fnOptions.length > 0 && (
              <select value={fn} onChange={e => setFn(e.target.value)}
                className="px-2 py-1 rounded-lg text-[11px] outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>
                <option value="">{ar ? 'كل الفنكشن' : 'All functions'}</option>
                {fnOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
          </div>
        }>
        <IntradayBody ar={ar} intraday={intraday} status={intraRes.status} curve={covCurve} />
      </Section>

      {/* ── ③ QUEUE HEALTH ──────────────────────────────────────────────────── */}
      <Section no="٣" icon={TrendingUp} color={QPAL.watch}
        title={ar ? 'صحّة الطوابير' : 'Queue health'}
        desc={ar
          ? 'الطوابير الحيّة مرتّبة بالخطر أولًا. إذا غابت التغذية تُعرض الحالة كـ«غير معروفة» وليست سليمة.'
          : 'Live queues, riskiest first. When the feed is missing the state reads UNKNOWN — not healthy.'}
        actions={queues.length > 0
          ? <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-3)' }}>
            {nfmt(queues.length)} {ar ? 'طابور' : 'queues'}
          </span>
          : undefined}>
        {feedDegraded ? (
          <Degraded ar={ar}
            title="Queue feed missing" titleAr="تغذية الطوابير مفقودة"
            body="the bridge sees agents but not queue state right now, so SLA, waiting and at-risk queues are UNKNOWN (not zero). This is not an all-clear."
            bodyAr="الجسر يرى الموظفين لكن لا يرى حالة الطوابير الآن، فحالة SLA وعدد المنتظرين والطوابير تحت الخطر غير معروفة (ليست ٠). هذه ليست حالة «كل شيء سليم»."
            fix="Open the Sprinklr Supervisor station (Queue Summary) with the WFM Bridge extension enabled and pin the tab."
            fixAr="افتح محطة Sprinklr Supervisor (Queue Summary) مع إضافة WFM Bridge مفعّلة وثبّت التبويب." />
        ) : queues.length === 0 ? (
          <Awaiting ar={ar}
            text="No queue snapshot yet — waiting for the bridge."
            textAr="لا توجد لقطة طوابير بعد — بانتظار الجسر." />
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="grid items-center gap-2 px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-wider"
              style={{ gridTemplateColumns: '1fr 52px 52px 60px 70px', background: 'var(--surface-2)', color: 'var(--text-3)' }}>
              <span>{ar ? 'الطابور' : 'Queue'}</span>
              <span className="text-end">{ar ? 'انتظار' : 'Wait'}</span>
              <span className="text-end">{ar ? 'نشط' : 'Active'}</span>
              <span className="text-end">{ar ? 'متاح' : 'Avail'}</span>
              <span className="text-end">SLA</span>
            </div>
            {queues.map(q => {
              const sla = q.slaPct ?? null;
              const risk = (sla ?? 100) < 80 || q.waiting > 50;
              const c = sla == null ? QPAL.degraded : slaColor(sla);
              return (
                <button key={q.queueId} onClick={() => onSelectQueue?.(q.queueId)}
                  className="w-full grid items-center gap-2 px-3 py-2 text-[11px] text-start transition-colors"
                  style={{
                    gridTemplateColumns: '1fr 52px 52px 60px 70px',
                    borderTop: '1px solid var(--border)',
                    background: risk ? `${QPAL.gap}0c` : 'transparent',
                    cursor: onSelectQueue ? 'pointer' : 'default',
                  }}>
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c }} />
                    <span className="truncate" style={{ color: 'var(--text-1)' }}>{q.queueName}</span>
                  </span>
                  <span className="tabular-nums text-end font-semibold" style={{ color: q.waiting > 0 ? T(QPAL.watch) : 'var(--text-3)' }}>
                    <Pulse value={q.waiting} color={QPAL.watch}>{nfmt(q.waiting)}</Pulse>
                  </span>
                  <span className="tabular-nums text-end" style={{ color: 'var(--text-2)' }}>{nfmt(q.inProgress)}</span>
                  <span className="tabular-nums text-end" style={{ color: T(q.agentsAvailable > 0 ? QPAL.ok : QPAL.gap) }}>{nfmt(q.agentsAvailable)}</span>
                  <span className="tabular-nums text-end font-bold" style={{ color: T(c) }}>{sla == null ? '—' : `${sla}%`}</span>
                </button>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── ④ ALERTS FEED ───────────────────────────────────────────────────── */}
      <Section no="٤" icon={Bell} color={QPAL.gap}
        title={ar ? 'سجل التنبيهات' : 'Alerts feed'}
        desc={ar
          ? 'مرتّبة بالخطورة. كل تنبيه يقول مصدره: محرك الـRTA أم مشتقّ من اللقطة الحيّة.'
          : 'Severity-sorted. Each alert says where it came from: the RTA engine, or derived from the live snapshot.'}
        actions={
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
            style={{
              background: openAlerts > 0 ? `${QPAL.gap}18` : `${QPAL.ok}18`,
              border: `1px solid ${openAlerts > 0 ? QPAL.gap : QPAL.ok}44`,
              color: T(openAlerts > 0 ? QPAL.gap : QPAL.ok),
            }}>
            {nfmt(openAlerts)} {ar ? 'مفتوح' : 'open'}
          </span>
        }>
        <div className="space-y-1.5">
          {alertsRes.status === 'missing' && (
            <Awaiting ar={ar}
              text="RTA alerts engine (GET /rta/alerts) not deployed yet — showing alerts derived in-page from the live snapshot only."
              textAr="محرك تنبيهات الـRTA (GET /rta/alerts) غير منشور بعد — نعرض فقط التنبيهات المشتقّة داخل الصفحة من اللقطة الحيّة." />
          )}
          {[...(svcAlerts ?? []).map(a => ({ a, src: 'engine' as const })),
            ...localAlerts.map(a => ({ a, src: 'derived' as const }))]
            .sort((x, y) => sevRank(x.a.severity) - sevRank(y.a.severity))
            .map(({ a, src }, i) => {
              const c = alertHue(a.severity); const ct = T(c);
              return (
                <div key={`${src}-${a.type}-${i}`} className="flex items-start gap-2.5 rounded-xl px-3 py-2"
                  style={{ background: `${c}0e`, border: `1px solid ${c}33` }}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c, marginTop: 5 }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px]" style={{ color: 'var(--text-1)', lineHeight: 1.5 }}>{ar ? a.textAr : a.text}</div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide"
                        style={{ background: `${c}22`, color: ct }}>{a.severity}</span>
                      <span className="text-[9.5px]" style={{ color: 'var(--text-3)' }}>{a.type.replace(/_/g, ' ')}</span>
                      {a.metric && <span className="text-[9.5px] tabular-nums px-1.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>{a.metric}</span>}
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
                        {src === 'engine' ? (ar ? 'محرك RTA' : 'RTA engine') : (ar ? 'مشتقّ من اللقطة' : 'derived from snapshot')}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          {openAlerts === 0 && alertsRes.status !== 'loading' && (
            <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
              style={{ background: `${QPAL.ok}0e`, border: `1px solid ${QPAL.ok}33` }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: QPAL.ok }} />
              <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                {ar ? 'لا تنبيهات مفتوحة — وكل التغذيات حيّة.' : 'No open alerts — and every feed is live.'}
              </span>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

/* ── ② body: heat strip from /rta/intraday, with an honest coverage fallback ─ */
function IntradayBody({ ar, intraday, status, curve }: {
  ar: boolean;
  intraday: ReturnType<typeof readIntraday>;
  status: 'loading' | 'live' | 'missing';
  /* already folded to the floor total (one row per interval, all functions) */
  curve: { rows: { key: string; at: string; req: number; sched: number; live: number; stale: boolean; have: number; gap: number }[]; date: string | null; liveUsable: boolean } | null;
}) {
  const { dark } = useUiStore();
  const T = (c: string) => ink(c, dark);
  if (status === 'loading') {
    return <Awaiting ar={ar} text="Loading intraday…" textAr="جارٍ تحميل بيانات اليوم…" />;
  }

  if (intraday?.intervals.length) {
    const maxAbsGap = Math.max(1, ...intraday.intervals.map(i => Math.abs(i.gap ?? 0)));
    const gaps = intraday.intervals.filter(i => i.risk === 'gap');
    const unknowns = intraday.intervals.filter(i => i.risk == null).length;
    const adhVals = intraday.intervals.map(i => i.adherencePct).filter((v): v is number => v != null);
    const dayAdh = adhVals.length ? adhVals.reduce((a, b) => a + b, 0) / adhVals.length : null;
    return (
      <div className="space-y-3">
        {/* The service caps at today and falls back to the newest reconciled day.
            Serving an older day silently would be the exact dishonesty this page
            exists to prevent — so say it, loudly, above the numbers. */}
        {!intraday.isExact && (
          <Degraded ar={ar}
            title="Not the day you asked for" titleAr="ليس اليوم الذي طلبته"
            body={`showing ${intraday.date ?? '—'} — the newest reconciled day${intraday.requestedDate ? ` (you asked for ${intraday.requestedDate})` : ''}${intraday.ageDays != null ? `, ${intraday.ageDays} day(s) old` : ''}. Read it as history, not as now.`}
            bodyAr={`المعروض ${intraday.date ?? '—'} — أحدث يوم مطابَق${intraday.requestedDate ? ` (طلبت ${intraday.requestedDate})` : ''}${intraday.ageDays != null ? `، عمره ${intraday.ageDays} يوم` : ''}. اقرأه كتاريخ، لا كوضع لحظي.`} />
        )}
        <div className="flex items-center gap-3 flex-wrap text-[11px]" style={{ color: 'var(--text-3)' }}>
          <span>{ar ? 'متوسط الالتزام خلال اليوم' : 'Day adherence'}: <b style={{ color: T(riskHue(dayAdh)) }}>{pctFmt(dayAdh)}</b></span>
          <span>{ar ? 'فترات بفجوة' : 'Intervals in gap'}: <b style={{ color: T(gaps.length ? QPAL.gap : QPAL.ok) }}>{nfmt(gaps.length)}</b></span>
          <span>{ar ? 'فترات غير معروفة' : 'Unknown intervals'}: <b style={{ color: T(QPAL.degraded) }}>{nfmt(unknowns)}</b></span>
          <span>{ar ? 'إجمالي الفترات' : 'Intervals'}: <b style={{ color: 'var(--text-2)' }}>{nfmt(intraday.intervals.length)}</b></span>
          {intraday.date && <span>{ar ? 'اليوم' : 'Day'}: <b style={{ color: 'var(--text-2)' }}>{intraday.date}</b></span>}
        </div>
        <div className="flex gap-1 flex-wrap">
          {intraday.intervals.map(i => {
            const c = i.risk === 'gap' ? QPAL.gap : i.risk === 'watch' ? QPAL.watch : i.risk === 'ok' ? QPAL.ok : QPAL.degraded;
            const inten = i.gap == null ? 0.25 : Math.abs(i.gap) / maxAbsGap;
            return (
              <HeatCell key={i.interval} label={hhmm(i.interval)} color={c} intensity={inten}
                dim={i.risk == null}
                sub={i.gap != null ? (i.gap > 0 ? `+${nfmt(i.gap)}` : nfmt(i.gap)) : i.adherencePct != null ? pctFmt(i.adherencePct) : '—'}
                title={[
                  `${hhmm(i.interval)}`,
                  i.scheduled != null ? `${ar ? 'مجدول' : 'scheduled'}: ${nfmt(i.scheduled)}` : null,
                  i.actual != null ? `${ar ? 'فعلي' : 'actual'}: ${nfmt(i.actual)}` : null,
                  i.required != null ? `${ar ? 'مطلوب' : 'required'}: ${nfmt(i.required)}` : null,
                  i.adherencePct != null ? `${ar ? 'التزام' : 'adherence'}: ${pctFmt(i.adherencePct)}` : (ar ? 'التزام: غير معروف' : 'adherence: UNKNOWN'),
                  i.noEvidence ? `${ar ? 'بلا دليل نظام' : 'no system evidence'}: ${nfmt(i.noEvidence)}` : null,
                  i.gap != null ? `${ar ? 'فجوة' : 'gap'}: ${i.gap > 0 ? '+' : ''}${nfmt(i.gap)}` : null,
                ].filter(Boolean).join(' · ')} />
            );
          })}
        </div>
        {gaps.length > 0 && (
          <div className="rounded-xl p-2.5 space-y-1" style={{ background: `${QPAL.gap}0e`, border: `1px solid ${QPAL.gap}33` }}>
            <div className="text-[10.5px] font-bold" style={{ color: T(QPAL.gap) }}>
              {ar ? 'فترات تحتاج تدخّل الآن' : 'Intervals needing intervention'}
            </div>
            {gaps.slice(0, 8).map(g => (
              <div key={g.interval} className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-2)' }}>
                <span className="tabular-nums font-semibold" style={{ color: 'var(--text-1)', minWidth: 44 }}>{hhmm(g.interval)}</span>
                <span>{ar ? 'متاح' : 'available'} <b className="tabular-nums">{nfmt(g.available ?? g.actual)}</b></span>
                <span style={{ color: 'var(--text-3)' }}>{ar ? 'مقابل' : 'vs'}</span>
                <span>{ar ? 'مطلوب' : 'required'} <b className="tabular-nums">{nfmt(g.required)}</b></span>
                <span className="tabular-nums font-bold" style={{ color: T(QPAL.gap), marginInlineStart: 'auto' }}>
                  {g.gap != null ? `${g.gap > 0 ? '+' : ''}${nfmt(g.gap)}` : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* endpoint missing (or returned nothing usable) → honest fallback */
  return (
    <div className="space-y-3">
      <Awaiting ar={ar}
        text="Per-interval adherence (GET /rta/intraday) is not deployed yet — scheduled-vs-actual and the risk flag will appear here the moment it lands."
        textAr="الالتزام لكل فترة (GET /rta/intraday) غير منشور بعد — سيظهر هنا المجدول مقابل الفعلي وعلَم الخطر فور توفّره." />
      {curve?.rows.length ? (() => {
        const maxAbs = Math.max(1, ...curve.rows.map(y => Math.abs(y.gap)));
        const short = curve.rows.filter(r => r.gap < 0);
        return (
        <>
          <div className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
            {ar
              ? `حتى ذلك الحين — منحنى التغطية لكل الفنكشنز (مطلوب مقابل ${curve.liveUsable ? 'على المقعد حيًّا' : 'المجدول — الجسر الحيّ قديم'})${curve.date ? ` · ${curve.date}` : ''}:`
              : `Meanwhile — the all-functions coverage curve (required vs ${curve.liveUsable ? 'live on seat' : 'scheduled — the live bridge is stale'})${curve.date ? ` · ${curve.date}` : ''}:`}
          </div>
          <div className="flex items-center gap-3 flex-wrap text-[11px]" style={{ color: 'var(--text-3)' }}>
            <span>{ar ? 'فترات ناقصة' : 'Intervals short'}: <b style={{ color: T(short.length ? QPAL.gap : QPAL.ok) }}>{nfmt(short.length)}</b></span>
            <span>{ar ? 'إجمالي الفترات' : 'Intervals'}: <b style={{ color: 'var(--text-2)' }}>{nfmt(curve.rows.length)}</b></span>
            <span>{ar ? 'ذروة المطلوب' : 'Peak required'}: <b style={{ color: 'var(--text-2)' }}>{nfmt(Math.max(0, ...curve.rows.map(r => r.req)))}</b></span>
          </div>
          <div className="flex gap-1 flex-wrap">
            {curve.rows.map(x => {
              const c = x.gap < 0 ? QPAL.gap : x.gap === 0 ? QPAL.watch : QPAL.ok;
              return (
                <HeatCell key={x.key} label={x.at} color={c} intensity={Math.abs(x.gap) / maxAbs}
                  sub={`${x.gap > 0 ? '+' : ''}${nfmt(x.gap)}`}
                  title={`${x.at} · ${ar ? 'مطلوب' : 'required'} ${nfmt(x.req)} · ${ar ? (curve.liveUsable ? 'على المقعد' : 'مجدول') : (curve.liveUsable ? 'on seat' : 'scheduled')} ${nfmt(x.have)}`} />
              );
            })}
          </div>
        </>
        );
      })() : (
        <Awaiting ar={ar}
          text="No coverage curve available either — nothing measurable for this day yet."
          textAr="لا يوجد منحنى تغطية أيضًا — لا شيء قابل للقياس لهذا اليوم بعد." />
      )}
    </div>
  );
}
