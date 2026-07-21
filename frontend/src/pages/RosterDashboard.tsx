import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, ShieldCheck, Clock, Building2, Timer, TrendingUp, Search, UserX,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { Kpi, KpiRow } from '@/components/kpi';
import { DateRangeBar } from '@/components/DateRangeBar';
import { RPAL, nfmt, pct1, dur, hrs, toHrs, adhHue, BasisBadge, useMaybe } from './roster/kit';
import AttendancePanel from './roster/AttendancePanel';
import TardinessPanel from './roster/TardinessPanel';
import OvertimePanel from './roster/OvertimePanel';
import TrendsPanel from './roster/TrendsPanel';
import DataQualityPanel, { readDataQuality } from './roster/DataQualityPanel';
import DetailPanel from './roster/DetailPanel';

/**
 * ROSTER ANALYTICS DASHBOARD — the reconciliation output, told as a story.
 * Executive strip (worked / OT / conformance / tardiness / WFH / data-quality) →
 * ① attendance → ② tardiness & conformance → ③ overtime → ④ monthly trends →
 * ⑤ data quality → detailed per-person breakdown (expander). Same shared design
 * language as the Capacity + Schedule planners: numbered Section cards, <Kpi>
 * provenance, one-meaning-per-hue palette, AR/EN inline, all three themes, RTL.
 */
export default function RosterDashboardPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const nav = useNavigate();
  const h = ar ? 'س' : 'h';
  const [f, setF] = useState({ from: '2026-06-01', to: '2026-06-29', functionName: '', role: '', shift: '', teamManager: '', team: '', presence: '', day: '', search: '' });
  const [tog, setTog] = useState({ includeInactive: false, includeExcludedRoles: false });
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as any); q.set('limit', '10');
    if (tog.includeInactive) q.set('includeInactive', '1');
    if (tog.includeExcludedRoles) q.set('includeExcludedRoles', '1');
    apiClient.get(`/attendance-recon/roster-dashboard?${q}`).then((r: any) => setD(r.data)).catch(() => setD(null)).finally(() => setLoading(false));
  }, [f, tog]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  const s = d?.summary; const opt = d?.filterOptions;

  // Data-quality (parallel backend agent) — one fetch feeds BOTH the hero tile and §5.
  const dqRes = useMaybe<any>(`/attendance-recon/roster-v2/data-quality?from=${f.from}&to=${f.to}`);
  const dq = useMemo(() => (dqRes.status === 'live' ? readDataQuality(dqRes.data) : null), [dqRes]);

  // ── Provenance (every number → where it came from) ──
  const EP = 'GET /api/v1/attendance-recon/roster-dashboard';
  const pd = `${f.from} → ${f.to}`;
  const worked = Number(s?.worked || 0);
  const tardyPct = worked ? (Number(s?.late_days || 0) / worked) * 100 : null;
  const wfhPct = worked ? (Number(s?.wfh || 0) / worked) * 100 : null;

  const heroes = useMemo(() => s ? [
    {
      ic: Users, l: ar ? 'أيام عمل' : 'Worked days', v: nfmt(s.worked), c: RPAL.brand, drill: '/roster?tab=grid',
      sub: `${nfmt(s.office)} ${ar ? 'مكتب' : 'office'} · ${nfmt(s.wfh)} wfh`,
      def: "COUNT of roster days present at work (presence IN office/wfh) over the filtered range",
      defAr: "عدد أيام الروستر بحضور فعلي (office/wfh) في الفترة المفلترة",
    },
    {
      ic: Timer, l: ar ? 'إجمالي OT' : 'TRUE OT', v: hrs(s.ot_total), c: RPAL.ot, drill: '/roster?tab=ot',
      sub: `${ar ? 'قبل' : 'before'} ${hrs(s.ot_before)} · ${ar ? 'بعد' : 'after'} ${hrs(s.ot_after)}`,
      def: "SUM(TRUE_OT)/60 where TRUE_OT = ot_min + offday_ot_min + holiday_ot_min — 3 disjoint OT buckets (BR-OT-001)",
      defAr: "مجموع TRUE_OT بالساعات حيث TRUE_OT = عادي + يوم OFF + عطلة (فئات منفصلة — BR-OT-001)",
    },
    {
      ic: ShieldCheck, l: ar ? 'كونفورمانس' : 'Conformance', v: s.conformance != null ? pct1(s.conformance) : '—', c: adhHue(s.conformance), drill: '/attendance?tab=dashboard',
      sub: ar ? 'يحتسب الاستئذانات المعتمدة' : 'folds approved permissions',
      def: "ROUND(AVG(adherence_pct)) over filtered roster days — a permitted late/early still conforms",
      defAr: "متوسط adherence_pct على أيام الروستر المفلترة — التأخير المصرّح لا يخصم",
    },
    {
      ic: Clock, l: ar ? 'نسبة التأخير' : 'Tardiness %', v: tardyPct != null ? pct1(tardyPct) : '—', c: RPAL.warn, drill: '/roster?tab=ot',
      sub: `${nfmt(s.late_days)} ${ar ? 'يوم' : 'days'} · ${dur(s.late_min)}`,
      def: "Credited-tardy days (sys_late_min 7–240) ÷ worked days. ≤6 min tolerated; >4h cross-midnight excluded",
      defAr: "أيام التأخير المعتمد (7–240 دقيقة) ÷ أيام العمل. ≤6 دقائق متسامح و>4 ساعات مستثناة",
    },
    {
      ic: Building2, l: ar ? 'نسبة WFH' : 'WFH %', v: wfhPct != null ? pct1(wfhPct) : '—', c: RPAL.wfh, drill: '/roster?tab=grid',
      sub: `${nfmt(s.wfh)}/${nfmt(worked)} ${ar ? 'يوم عمل' : 'worked'}`,
      def: "WFH roster days ÷ worked days (office+wfh) over the filtered range",
      defAr: "أيام WFH ÷ أيام العمل (مكتب+WFH) في الفترة المفلترة",
    },
  ] : [], [s, ar, tardyPct, wfhPct, worked]);

  // Data-quality hero tile (separate endpoint, awaiting-state until live)
  const dqTile = useMemo(() => {
    const missing = dqRes.status !== 'live' || !dq || dq.cleanPct == null;
    const cp = dq?.cleanPct ?? null;
    return {
      ic: ShieldCheck, l: ar ? 'نظافة البيانات' : 'Data-quality',
      v: missing ? '—' : pct1(cp), drill: '/roster?tab=quality',
      c: missing ? RPAL.neutral : cp! >= 95 ? RPAL.ok : cp! >= 85 ? RPAL.warn : RPAL.risk,
      sub: missing ? (dqRes.status === 'loading' ? (ar ? 'جارٍ التحميل…' : 'loading…') : (ar ? 'بانتظار الواجهة' : 'awaiting endpoint'))
        : `${nfmt(dq!.flaggedDays)}/${nfmt(dq!.totalDays)} ${ar ? 'معلَّم' : 'flagged'}`,
      def: "Clean roster-days ÷ total (integrity checks passed) — from the roster-v2/data-quality analysis endpoint",
      defAr: "أيام الروستر النظيفة ÷ الإجمالي (اجتازت فحوص السلامة) — من واجهة roster-v2/data-quality",
    };
  }, [dqRes, dq, ar]);

  const inputStyle = { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' } as React.CSSProperties;
  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs outline-none';

  return (
    <div className="space-y-4 page-enter">
      {/* header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 6px 18px rgba(99,102,241,0.35)' }}><TrendingUp size={20} className="text-white" /></div>
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'داشبورد الروستر التفصيلي' : 'Roster Analytics Dashboard'}</h1>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>{ar ? 'ناتج مطابقة الحضور — فلتر بالتاريخ/الفنكشن/الشفت/التيم ليدر' : 'Attendance reconciliation output — filter by date / function / shift / team leader'}</p>
            <BasisBadge basis="live" ar={ar} />
            <BasisBadge basis="corrected" ar={ar} />
          </div>
        </div>
      </div>

      {/* filter bar */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <DateRangeBar from={f.from} to={f.to} onChange={(a, b) => setF(x => ({ ...x, from: a, to: b }))} fullRange={d?.range} />
        <div className="flex items-center gap-1.5 flex-1 min-w-[140px]"><Search size={14} style={{ color: 'var(--text-3)' }} />
          <input value={f.search} onChange={e => set('search', e.target.value)} placeholder={ar ? 'بحث بالاسم/الرقم' : 'Name / no'} className={`${inputCls} flex-1`} style={inputStyle} /></div>
        {([['functionName', 'functions', ar ? 'كل الفنكشن' : 'All functions'], ['role', 'roles', ar ? 'كل الأدوار' : 'All roles'], ['shift', 'shifts', ar ? 'كل الشفتات' : 'All shifts'], ['teamManager', 'teamManagers', ar ? 'كل التيم ليدرز' : 'All team leaders'], ['team', 'teams', ar ? 'كل الجروبات' : 'All teams'], ['day', 'days', ar ? 'كل الأيام' : 'All days']] as [string, string, string][]).map(([k, o, label]) => (
          <select key={k} value={(f as any)[k]} onChange={e => set(k, e.target.value)} className={inputCls} style={inputStyle}>
            <option value="">{label}</option>
            {(opt?.[o] || []).map((v: string) => <option key={v} value={v}>{v}</option>)}
          </select>
        ))}
        <select value={f.presence} onChange={e => set('presence', e.target.value)} className={inputCls} style={inputStyle}>
          <option value="">{ar ? 'كل الحالات' : 'All presence'}</option>
          {['office', 'wfh', 'off', 'leave', 'absent', 'sick'].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        {([['includeInactive', ar ? '+ غير النشطين' : '+ Inactive'], ['includeExcludedRoles', ar ? '+ أدوار 8 ساعات' : '+ 8h roles']] as [string, string][]).map(([k, label]) => (
          <label key={k} className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none px-2 py-1 rounded-lg" style={{ color: 'var(--text-2)', background: (tog as any)[k] ? `${RPAL.brand}22` : 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <input type="checkbox" checked={(tog as any)[k]} onChange={e => setTog(p => ({ ...p, [k]: e.target.checked }))} className="accent-indigo-500" />{label}
          </label>
        ))}
      </div>

      {/* team-leader verification banner */}
      {!loading && d?.teamLeaders?.some((t: any) => !t.verified) && (
        <div className="rounded-2xl p-3 flex items-start gap-2.5" style={{ background: `${RPAL.warn}14`, border: `1px solid ${RPAL.warn}44` }}>
          <UserX size={16} style={{ color: RPAL.warn, flexShrink: 0, marginTop: 2 }} />
          <div className="text-[11px]" style={{ color: 'var(--text-2)' }}>
            <span className="font-bold">{ar ? 'تنبيه جودة بيانات — تيم ليدرز غير حاليين: ' : 'Data-quality alert — non-current team leaders: '}</span>
            {d.teamLeaders.filter((t: any) => !t.verified).map((t: any) => `${t.name} (${t.status === 'left' ? (ar ? 'ترك العمل' : 'left') : (ar ? 'غير مؤكد' : 'unverified')}, ${ar ? 'آخر ظهور' : 'last'} ${t.lastSeen})`).join('  ·  ')}
            <span style={{ color: 'var(--text-3)' }}>{ar ? ' — مستبعدون من قائمة التيم ليدرز الحاليين.' : ' — excluded from the current team-leader list.'}</span>
          </div>
        </div>
      )}

      {loading && <p className="text-sm py-8 text-center" style={{ color: 'var(--text-3)' }}>{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>}
      {!loading && !d && <p className="text-sm py-8 text-center" style={{ color: RPAL.risk }}>{ar ? 'تعذّر التحميل' : 'Failed to load'}</p>}

      {!loading && d && s && (<>
        {/* ── Executive strip ── */}
        <KpiRow cols={6}>
          {heroes.map((x, i) => (
            <Kpi key={i} icon={<x.ic size={15} />} label={x.l} accent={x.c} sub={x.sub} drill={x.drill} value={x.v}
              source={{ endpoint: EP, table: 'roster_days', definition: x.def, definitionAr: x.defAr, period: pd }} />
          ))}
          <Kpi icon={<dqTile.ic size={15} />} label={dqTile.l} accent={dqTile.c} sub={dqTile.sub} drill={dqTile.drill} value={dqTile.v}
            source={{ endpoint: 'GET /api/v1/attendance-recon/roster-v2/data-quality', table: 'roster_days', definition: dqTile.def, definitionAr: dqTile.defAr, period: pd }} />
        </KpiRow>

        {/* ── Story sections ── */}
        <AttendancePanel d={d} ar={ar} />
        <TardinessPanel d={d} ar={ar} />
        <OvertimePanel from={f.from} to={f.to} functionName={f.functionName} teamManager={f.teamManager} ar={ar} h={h} />
        <TrendsPanel functionName={f.functionName} ar={ar} h={h} />
        <DataQualityPanel res={dqRes} ar={ar} />
        <DetailPanel d={d} ar={ar} />
      </>)}
    </div>
  );
}
