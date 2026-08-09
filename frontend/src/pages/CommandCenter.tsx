import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Crown, Users, ShieldCheck, Scale, UserMinus, Clock, FileText, CalendarClock,
  Activity, AlertTriangle, ArrowRight, Building2, Home, CheckCircle2,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { fetchDataSpan } from '@/hooks/useDataSpan';
import { useUiStore } from '@/store/ui.store';
import { Gauge, Donut, BarRow } from '@/components/dazzle';
import { Kpi, KpiRow, KpiSource } from '@/components/kpi';

/** Executive Command Center — the cinematic single-screen operation overview.
 *  Aggregates only VERIFIED endpoints (dashboard, coverage-impact, fairness, attrition,
 *  roster summary, chief briefing). Every number is real; the dazzle kit makes it premium. */
export default function CommandCenter() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const [d, setD] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const [rosterWindow, setRosterWindow] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    /* The roster slice behind the conformance gauge, the OT tile and the whole
       presence donut was pinned to `from=2026-06-01&to=2026-06-20` — a frozen
       20-day window, on a page whose own header says "live from the system" and
       whose footer says "all numbers verified, no demo data". By 2026-07 it was
       six weeks stale and getting staler, and only the OT tile's hover tooltip
       admitted a fixed period at all. The span endpoint answers where the data
       genuinely is, so the executive view moves with the business. */
    let cancelled = false;
    fetchDataSpan().then((span) => {
      if (cancelled) return;
      const from = span?.defaultFrom ?? span?.roster.from ?? null;
      const to = span?.latestDay ?? span?.roster.to ?? null;
      setRosterWindow(from && to ? { from, to } : null);
      const rosterCall = from && to
        ? apiClient.get(`/attendance-recon/roster-v2?from=${from}&to=${to}&limit=1`)
        : Promise.reject(new Error('no roster coverage'));
      Promise.allSettled([
        apiClient.get('/dashboard/summary'),
        apiClient.get('/attendance-recon/roster-v2/coverage-impact'),
        apiClient.get('/attendance-recon/roster-v2/fairness'),
        apiClient.get('/attrition'),
        rosterCall,
        apiClient.get(`/chief/briefing?lang=${ar ? 'ar' : 'en'}`),
      ]).then((res: any[]) => {
        if (cancelled) return;
        const g = (i: number) => res[i].status === 'fulfilled' ? res[i].value.data : null;
        setD({ sum: g(0), cov: g(1), fair: g(2), attr: g(3), ros: g(4), chief: g(5) });
        setLoading(false);
      });
    });
    return () => { cancelled = true; };
  }, [ar]);

  const sev: Record<string, { c: string; ar: string; en: string }> = {
    risk: { c: '#ef4444', ar: 'خطر', en: 'Risk' }, caution: { c: '#f59e0b', ar: 'انتباه', en: 'Caution' },
    ok: { c: '#22c55e', ar: 'مستقرّ', en: 'Stable' }, info: { c: '#64748b', ar: 'معلومة', en: 'Info' },
  };
  const adhC = (v: number) => v >= 95 ? '#22c55e' : v >= 85 ? '#06b6d4' : v >= 70 ? '#f59e0b' : '#f43f5e';

  // ── derive verified numbers ──
  const coverage = d.cov?.totals?.coverage ?? null;
  const conf = d.ros?.summary?.conformance_pct != null ? Number(d.ros.summary.conformance_pct) : null;
  const fair = d.fair?.summary?.fairnessScore ?? null;
  const weekendFair = d.fair?.summary?.weekendFairnessScore ?? null;
  const headcount = d.sum?.employees?.total ?? null;
  const present = d.sum?.today?.present ?? null;
  const onPerm = d.cov?.totals?.on_permission ?? null;
  const pending = d.sum?.requests?.pending ?? null;
  const otHours = d.ros?.summary?.ot_hours ?? null;
  const wfh = d.ros?.summary?.wfh ?? null;
  const office = d.ros?.summary?.office ?? null;
  const off = d.ros?.summary?.off ?? null;
  const leave = d.ros?.summary?.leave ?? null;
  const absent = d.ros?.summary?.absent ?? null;
  const attrRate = d.attr?.summary?.attritionRateAnnualized ?? null;
  // mini-trend series pulled from the SAME payload already fetched (no extra calls):
  //   presentTrend — 14-day present count from /dashboard/summary → trend[].present
  //   attrTrend    — monthly separations from /attrition → byMonth[].total (chronological)
  const presentTrend = (d.sum?.trend ?? []).map((x: any) => Number(x.present)).filter((n: number) => !Number.isNaN(n));
  const attrTrend = [...(d.attr?.byMonth ?? [])].sort((a: any, b: any) => String(a.key).localeCompare(String(b.key))).map((m: any) => Number(m.total));
  const riskRows = [...(d.cov?.rows ?? [])].filter((r: any) => r.coverage != null).sort((a: any, b: any) => a.coverage - b.coverage);
  const maxPlanned = Math.max(1, ...riskRows.map((r: any) => r.planned || 0));
  const posture = d.chief ? (sev[d.chief.posture] || sev.info) : null;
  const presSegs = [
    { label: ar ? 'مكتب' : 'Office', value: office || 0, color: '#22c55e' },
    { label: 'WFH', value: wfh || 0, color: '#06b6d4' },
    { label: ar ? 'أوف' : 'Off', value: off || 0, color: '#64748b' },
    { label: ar ? 'إجازة' : 'Leave', value: leave || 0, color: '#8b5cf6' },
    { label: ar ? 'غياب' : 'Absent', value: absent || 0, color: '#f43f5e' },
  ].filter(s => s.value > 0);

  const panel = { background: 'var(--surface)', border: '1px solid var(--border)' } as React.CSSProperties;
  const riskColor = (r: string) => r === 'critical' ? '#ef4444' : r === 'watch' ? '#f59e0b' : '#22c55e';

  if (loading) return <div className="py-24 text-center text-sm" style={{ color: 'var(--text-3)' }}>{ar ? 'جارٍ تجهيز مركز القيادة…' : 'Preparing the command center…'}</div>;

  return (
    <div className="space-y-4 page-enter" dir={ar ? 'rtl' : 'ltr'}>
      {/* ── HERO ── */}
      <div className="rounded-3xl p-5 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.14), rgba(6,182,212,0.08) 60%, transparent)', border: '1px solid var(--border)' }}>
        <div className="absolute -top-10 -inline-end-10 w-48 h-48 rounded-full" style={{ background: '#6366f1', opacity: 0.12, filter: 'blur(50px)' }} />
        <div className="flex items-center justify-between flex-wrap gap-3 relative">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#6366f1,#06b6d4)', boxShadow: '0 8px 24px rgba(99,102,241,0.4)' }}><Crown size={24} className="text-white" /></div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'مركز القيادة التنفيذي' : 'Executive Command Center'}</h1>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>{ar ? 'صحّة العمليات الكاملة في شاشة واحدة — أرقام حيّة من النظام' : 'the whole operation’s health on one screen — live from the system'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {posture && <span className="text-xs font-bold px-3 py-1.5 rounded-xl" style={{ background: posture.c, color: '#0b0f1c' }}>{ar ? 'الوضع' : 'Posture'}: {ar ? posture.ar : posture.en}</span>}
            <span className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-xl" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> {now.toLocaleTimeString(ar ? 'ar' : 'en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        </div>
        {d.chief?.directive && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl relative" style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)' }}>
            <Activity size={15} style={{ color: '#eab308', flexShrink: 0 }} /><p className="text-xs font-bold" style={{ color: '#fde047' }}>{d.chief.directive}</p>
          </div>
        )}
      </div>

      {/* ── HERO GAUGES (4) ──
          These four do NOT share a period, and the single "roster window" line in the
          footer sat under all of them as if they did. Coverage is ONE day; conformance
          is the roster window; both fairness scores are year-to-date, because the
          fairness call takes no dates and a month is too short to judge how night load
          and weekend rest are shared out. The numbers are right — the framing was not,
          so each gauge now carries the span it was actually measured over. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(() => {
          const span = (a?: string, b?: string) => a && b ? `${String(a).slice(5)} → ${String(b).slice(5)}` : null;
          const fairSpan = span(d.fair?.from, d.fair?.to);
          const rosSpan = span(rosterWindow?.from, rosterWindow?.to);
          const withSpan = (base: string, sp: string | null) => sp ? `${base} · ${sp}` : base;
          return [
          { v: coverage, l: ar ? 'التغطية' : 'Coverage',
            sub: withSpan(ar ? 'حاضر/مخطّط' : 'present/planned', d.cov?.date ? String(d.cov.date).slice(5) : null),
            c: coverage == null ? '#64748b' : coverage >= 90 ? '#22c55e' : coverage >= 75 ? '#f59e0b' : '#ef4444' },
          { v: conf, l: ar ? 'الكونفورمانس' : 'Conformance',
            sub: withSpan(ar ? 'التزام الفترة' : 'period adherence', rosSpan),
            c: adhC(conf || 0) },
          { v: fair, l: ar ? 'عدالة الشفتات' : 'Shift Fairness',
            sub: withSpan(ar ? 'توزيع الليل' : 'night load', fairSpan),
            c: (fair || 0) >= 80 ? '#22c55e' : (fair || 0) >= 60 ? '#f59e0b' : '#ef4444' },
          { v: weekendFair, l: ar ? 'عدالة أوف الويك-اند' : 'Weekend-OFF Fairness',
            sub: withSpan(ar ? 'توزيع الراحة' : 'rest equity', fairSpan),
            c: (weekendFair || 0) >= 80 ? '#22c55e' : (weekendFair || 0) >= 60 ? '#f59e0b' : '#ef4444' },
          ]; })().map((g, i) => (
          <div key={i} className="rounded-2xl p-4 flex items-center justify-center" style={panel}>
            {g.v == null ? <span className="text-sm" style={{ color: 'var(--text-3)' }}>—</span>
              : <Gauge value={Number(g.v)} label={g.l} color={g.c} size={150} sub={g.sub} />}
          </div>
        ))}
      </div>

      {/* ── KPI TILES — provenance kit: every number clickable + ⓘ source ── */}
      <KpiRow cols={6}>
        <Kpi label={ar ? 'القوى العاملة' : 'Headcount'} value={headcount ?? '—'} accent="#6366f1" icon={<Users size={15} />} drill="/roster?tab=grid" sub={ar ? 'لايف' : 'live'}
          source={{ endpoint: 'GET /api/v1/dashboard/summary', table: 'employees',
            definition: "COUNT(*) of employees with status = 'active' (live HR master — includes interns)",
            definitionAr: "عدد الموظفين بحالة 'active' في جدول الموظفين (لحظي — يشمل المتدربين)",
            period: ar ? 'الآن' : 'now' } satisfies KpiSource} />
        <Kpi label={ar ? 'حاضرون اليوم' : 'Present today'} value={present ?? '—'} accent="#22c55e" icon={<CheckCircle2 size={15} />} drill="/attendance?tab=dashboard" sub={ar ? 'لايف · اليوم' : 'live · today'}
          spark={presentTrend.length > 1 ? presentTrend : undefined}
          source={{ endpoint: 'GET /api/v1/dashboard/summary', table: 'attendance_records',
            definition: "COUNT of records with attendance_marker = 'present' on the reference date (today if attendance exists, else the latest date ≤ today) — live attendance spine, not the corrected roster",
            definitionAr: "عدد سجلات الحضور بعلامة 'present' في تاريخ المرجع (اليوم إن وُجد حضور، وإلا آخر تاريخ ≤ اليوم) — من سجل الحضور اللحظي وليس الروستر المُصحّح",
            period: d.sum?.refDate ?? undefined } satisfies KpiSource} />
        <Kpi label={ar ? 'على إذن' : 'On permission'} value={onPerm ?? '—'} accent="#8b5cf6" icon={<FileText size={15} />} drill="/requests" sub={ar ? 'مُصحّح' : 'corrected'}
          source={{ endpoint: 'GET /api/v1/attendance-recon/roster-v2/coverage-impact', table: 'roster_days',
            definition: 'COUNT of rows with permission_type IS NOT NULL on the latest day with real coverage (≥20 working rows), summed across functions — corrected reconciliation spine',
            definitionAr: 'عدد أيام الروستر التي سُجّل لها permission_type في آخر يوم بتغطية حقيقية (≥20 صف عمل)، مجموعاً على كل الأقسام — من التسوية المعتمدة',
            period: d.cov?.date ?? undefined } satisfies KpiSource} />
        <Kpi label={ar ? 'طلبات معلّقة' : 'Pending requests'} value={pending ?? '—'} accent="#f59e0b" icon={<CalendarClock size={15} />} drill="/requests" sub={ar ? 'لايف' : 'live'}
          source={{ endpoint: 'GET /api/v1/dashboard/summary', table: 'requests',
            definition: "COUNT of requests with status = 'pending' (peer_pending is returned separately and NOT included here)",
            definitionAr: "عدد الطلبات بحالة 'pending' (حالة peer_pending تُعاد منفصلة وغير مشمولة هنا)",
            period: ar ? 'الآن' : 'now' } satisfies KpiSource} />
        <Kpi label={ar ? 'التسرّب السنوي' : 'Annual attrition'} value={attrRate != null ? `${attrRate}%` : '—'} accent={attrRate != null && attrRate >= 35 ? '#ef4444' : attrRate != null && attrRate >= 20 ? '#f59e0b' : '#22c55e'} icon={<UserMinus size={15} />} drill="/analytics?tab=attrition" sub={ar ? 'من علامات RES/TER' : 'from RES/TER markers'}
          spark={attrTrend.length > 1 ? attrTrend : undefined}
          source={{ endpoint: 'GET /api/v1/attrition', table: 'roster_days',
            definition: 'Distinct canonical persons with a RES/TER marker ÷ average monthly headcount × (12 / months in window), annualized — internal TRANSFERs excluded',
            definitionAr: 'عدد الأشخاص (بعد توحيد الهوية) بعلامة RES/TER ÷ متوسط الهيدكاونت الشهري × (12 ÷ عدد الأشهر) — التنقلات الداخلية TRANSFER مستثناة',
            period: d.attr ? `${d.attr.from} → ${d.attr.to}` : undefined } satisfies KpiSource} />
        <Kpi label={ar ? 'ساعات OT (الفترة)' : 'OT hours (period)'} value={otHours != null ? `${otHours}${ar ? 'س' : 'h'}` : '—'} accent="#22d3ee" icon={<Clock size={15} />} drill="/roster?tab=ot" sub={ar ? 'مُصحّح · TRUE_OT' : 'corrected · TRUE_OT'}
          source={{ endpoint: 'GET /api/v1/attendance-recon/roster-v2', table: 'roster_days',
            definition: 'ROUND(SUM(TRUE_OT)/60) where TRUE_OT = ot_min + offday_ot_min + holiday_ot_min — the 3 disjoint OT buckets (BR-OT-001); this page queries a fixed window',
            definitionAr: 'مجموع TRUE_OT ÷ 60 حيث TRUE_OT = ot_min + offday_ot_min + holiday_ot_min — فئات الأوفرتايم الثلاث المنفصلة (BR-OT-001)؛ هذه الصفحة تستعلم عن نافذة ثابتة',
            period: '2026-06-01 → 2026-06-20' } satisfies KpiSource} />
      </KpiRow>

      {/* ── COVERAGE RISK + PRESENCE MIX ── */}
      <div className="grid lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 rounded-2xl p-4" style={panel}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><AlertTriangle size={15} style={{ color: '#f59e0b' }} /><h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'تغطية الأقسام اليوم — حسب الخطر' : 'Coverage by function — by risk'}</h3></div>
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{d.cov?.date}</span>
          </div>
          <div className="space-y-2">
            {riskRows.slice(0, 8).map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-32 truncate text-[11px]" style={{ color: 'var(--text-2)' }}>{r.fn}</span>
                <div className="flex-1"><BarRow label="" value={r.present} max={maxPlanned} color={riskColor(r.risk)} delay={i * 40} /></div>
                <span className="w-24 text-end text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>{r.present}/{r.planned} · <b style={{ color: riskColor(r.risk) }}>{r.coverage}%</b></span>
              </div>
            ))}
            {riskRows.length === 0 && <p className="text-xs py-4 text-center" style={{ color: 'var(--text-3)' }}>{ar ? 'لا بيانات تغطية' : 'no coverage data'}</p>}
          </div>
        </div>
        <div className="rounded-2xl p-4" style={panel}>
          <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-1)' }}>{ar ? 'تركيبة الحضور' : 'Presence mix'}</h3>
          {presSegs.length > 0 ? <Donut segments={presSegs} centerNum={(office || 0) + (wfh || 0)} centerLabel={ar ? 'مداوم' : 'working'} size={150} /> : <p className="text-xs" style={{ color: 'var(--text-3)' }}>—</p>}
        </div>
      </div>

      {/* ── quick links to the proof pages ── */}
      <div className="flex flex-wrap gap-2">
        {[
          { l: ar ? 'توليد الجدول' : 'Generate schedule', to: '/analytics?tab=generate', c: '#6366f1' },
          { l: ar ? 'عدالة الشفتات' : 'Shift fairness', to: '/analytics?tab=fairness', c: '#22c55e' },
          { l: ar ? 'تحليلات بالساعة' : 'Hourly analytics', to: '/analytics?tab=hourly', c: '#0ea5e9' },
          { l: ar ? 'النظرة التنفيذية' : 'WFM Overview', to: '/wfm-overview', c: '#8b5cf6' },
          { l: ar ? 'الرئيس' : 'The Chief', to: '/chief', c: '#eab308' },
        ].map((q, i) => (
          <button key={i} onClick={() => nav(q.to)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold" style={{ background: `${q.c}14`, color: q.c, border: `1px solid ${q.c}33` }}>{q.l} <ArrowRight size={13} /></button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]" style={{ color: 'var(--text-3)' }}>
        <span className="inline-flex items-center gap-1"><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#06b6d4', display: 'inline-block' }} />{ar ? 'لايف = لحظي من النظام (حضور اليوم/الطلبات)' : 'live = real-time from the system (today’s attendance/requests)'}</span>
        <span className="inline-flex items-center gap-1"><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />{ar ? 'مُصحّح = من التسوية المعتمدة roster_days (إذن/OT/تغطية)' : 'corrected = from the validated reconciliation roster_days (permission/OT/coverage)'}</span>
        {/* The verification claim now carries the window it applies to. "All numbers
            verified" over an unstated period is only half a claim — and this footer
            used to sit under a roster slice frozen at June 1–20. */}
        <span>{ar ? '· كل الأرقام متحقّقة، لا بيانات تجريبية.' : '· all numbers verified, no demo data.'}</span>
        {rosterWindow && (
          <span className="inline-flex items-center gap-1" style={{ color: 'var(--text-2)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#8b5cf6', display: 'inline-block' }} />
            {/* "roster window" is the window for the CORRECTED tiles only. It never
                covered the fairness gauges (year-to-date) or coverage (a single day),
                which now state their own span, so this says which tiles it governs. */}
            {ar ? `نافذة الروستر (للأرقام المُصحّحة): ${rosterWindow.from} → ${rosterWindow.to}`
                : `roster window (corrected figures): ${rosterWindow.from} → ${rosterWindow.to}`}
          </span>
        )}
      </div>
    </div>
  );
}
