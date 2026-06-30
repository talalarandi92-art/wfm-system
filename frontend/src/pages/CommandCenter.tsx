import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Crown, Users, ShieldCheck, Scale, UserMinus, Clock, FileText, CalendarClock,
  Activity, AlertTriangle, ArrowRight, Building2, Home, CheckCircle2,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { StatTile, Gauge, Donut, BarRow, Sparkline } from '@/components/dazzle';

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
  useEffect(() => {
    Promise.allSettled([
      apiClient.get('/dashboard/summary'),
      apiClient.get('/attendance-recon/roster-v2/coverage-impact'),
      apiClient.get('/attendance-recon/roster-v2/fairness'),
      apiClient.get('/attrition'),
      apiClient.get('/attendance-recon/roster-v2?from=2026-06-01&to=2026-06-20&limit=1'),
      apiClient.get(`/chief/briefing?lang=${ar ? 'ar' : 'en'}`),
    ]).then((res: any[]) => {
      const g = (i: number) => res[i].status === 'fulfilled' ? res[i].value.data : null;
      setD({ sum: g(0), cov: g(1), fair: g(2), attr: g(3), ros: g(4), chief: g(5) });
      setLoading(false);
    });
  }, [ar]);

  const sev: Record<string, { c: string; ar: string; en: string }> = {
    risk: { c: '#ef4444', ar: 'خطر', en: 'Risk' }, caution: { c: '#f59e0b', ar: 'انتباه', en: 'Caution' },
    ok: { c: '#22c55e', ar: 'مستقرّ', en: 'Stable' }, info: { c: '#64748b', ar: 'معلومة', en: 'Info' },
  };
  const adhC = (v: number) => v >= 95 ? '#22c55e' : v >= 85 ? '#06b6d4' : v >= 70 ? '#f59e0b' : '#f43f5e';
  // tiny source/time-basis tag so a live-ops number is never read as a corrected-roster number
  const srcTag = (txt: string, c: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: c, boxShadow: `0 0 5px ${c}` }} />{txt}
    </span>
  );

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
  const attrTrend = [...(d.attr?.byMonth ?? [])].sort((a: any, b: any) => String(a.key).localeCompare(String(b.key))).map((m: any) => m.total);
  const presentTrend = (d.sum?.trend ?? []).map((x: any) => x.present);
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

      {/* ── HERO GAUGES (4) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { v: coverage, l: ar ? 'التغطية' : 'Coverage', sub: ar ? 'حاضر/مخطّط' : 'present/planned', c: coverage == null ? '#64748b' : coverage >= 90 ? '#22c55e' : coverage >= 75 ? '#f59e0b' : '#ef4444' },
          { v: conf, l: ar ? 'الكونفورمانس' : 'Conformance', sub: ar ? 'التزام الفترة' : 'period adherence', c: adhC(conf || 0) },
          { v: fair, l: ar ? 'عدالة الشفتات' : 'Shift Fairness', sub: ar ? 'توزيع الليل' : 'night load', c: (fair || 0) >= 80 ? '#22c55e' : (fair || 0) >= 60 ? '#f59e0b' : '#ef4444' },
          { v: weekendFair, l: ar ? 'عدالة أوف الويك-اند' : 'Weekend-OFF Fairness', sub: ar ? 'توزيع الراحة' : 'rest equity', c: (weekendFair || 0) >= 80 ? '#22c55e' : (weekendFair || 0) >= 60 ? '#f59e0b' : '#ef4444' },
        ].map((g, i) => (
          <div key={i} className="rounded-2xl p-4 flex items-center justify-center" style={panel}>
            {g.v == null ? <span className="text-sm" style={{ color: 'var(--text-3)' }}>—</span>
              : <Gauge value={Number(g.v)} label={g.l} color={g.c} size={150} sub={g.sub} />}
          </div>
        ))}
      </div>

      {/* ── KPI TILES (count-up, with trends) ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <StatTile icon={Users} label={ar ? 'القوى العاملة' : 'Headcount'} num={headcount ?? undefined} value={headcount == null ? '—' : undefined} color="#6366f1" delay={0} sub={srcTag(ar ? 'لايف' : 'live', '#06b6d4')} />
        <StatTile icon={CheckCircle2} label={ar ? 'مجدول اليوم' : 'Scheduled today'} num={present ?? undefined} value={present == null ? '—' : undefined} color="#22c55e" delay={60} trend={presentTrend.length > 1 ? presentTrend : undefined} sub={srcTag(ar ? 'لايف · اليوم' : 'live · today', '#06b6d4')} />
        <StatTile icon={FileText} label={ar ? 'على إذن' : 'On permission'} num={onPerm ?? undefined} value={onPerm == null ? '—' : undefined} color="#8b5cf6" delay={120} sub={srcTag(ar ? 'مُصحّح' : 'corrected', '#22c55e')} />
        <StatTile icon={CalendarClock} label={ar ? 'طلبات معلّقة' : 'Pending requests'} num={pending ?? undefined} value={pending == null ? '—' : undefined} color="#f59e0b" delay={180} onClick={() => nav('/requests')} sub={srcTag(ar ? 'لايف' : 'live', '#06b6d4')} />
        <StatTile icon={UserMinus} label={ar ? 'التسرّب السنوي' : 'Annual attrition'} num={attrRate ?? undefined} suffix="%" value={attrRate == null ? '—' : undefined} color={attrRate != null && attrRate >= 35 ? '#ef4444' : attrRate != null && attrRate >= 20 ? '#f59e0b' : '#22c55e'} delay={240} trend={attrTrend.length > 1 ? attrTrend : undefined} onClick={() => nav('/analytics?tab=attrition')} sub={srcTag(ar ? 'آخر 12 شهر' : 'last 12mo', '#a78bfa')} />
        <StatTile icon={Clock} label={ar ? 'ساعات OT (الفترة)' : 'OT hours (period)'} num={otHours ?? undefined} suffix={ar ? 'س' : 'h'} value={otHours == null ? '—' : undefined} color="#22d3ee" delay={300} onClick={() => nav('/ot-exceptions')} sub={srcTag(ar ? 'مُصحّح · الفترة' : 'corrected · period', '#22c55e')} />
      </div>

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
        <span>{ar ? '· كل الأرقام متحقّقة، لا بيانات تجريبية.' : '· all numbers verified, no demo data.'}</span>
      </div>
    </div>
  );
}
