/**
 * STAFFING ENGINE — the enterprise capacity planner (/capacity?tab=staffing).
 *
 * Stage-1B redesign: a buyer-demo story that reads top → down —
 *   ★ Executive strip  — 6 provenance <Kpi> tiles: the whole verdict at a glance
 *   ① Demand           — per-function volume curves + measured AHT + orders lever
 *   ② Requirement      — the function×24h heatmap the generator consumes,
 *                        click any cell → the full 7-step Erlang math
 *   ③ Scenarios        — base/surge/quiet/OT side-by-side (graceful-hides
 *                        until /staffing/scenario-compare lands)
 *   ④ Hiring verdict   — needs / can-field / hire / surplus + binding constraint
 *   ⑤ Insights         — the engine's severity-colored reading (graceful-hides
 *                        until /staffing/insights lands)
 *   ⑥ Tuning & data    — params editor + event Excel flow + learned floor,
 *                        tucked behind one disclosure
 *
 * Verified-data-only: every number traces to a live endpoint; missing engines
 * show an explicit awaiting state, never a fake 0. Theme-aware via CSS vars
 * (all 3 themes), AR/EN inline, RTL via dir.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Sigma, RefreshCw, Loader2, Inbox, Grid3X3, UserPlus } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import {
  Section, Awaiting, useMaybe, nfmt, PAL,
  type StaffParams, type ReqResp, type HiringResp,
} from './capacity/kit';
import ExecutiveStrip from './capacity/ExecutiveStrip';
import DemandSection from './capacity/DemandSection';
import RequirementSection from './capacity/RequirementSection';
import ScenarioSection, { normalizeScenarios } from './capacity/ScenarioSection';
import InsightsSection, { normalizeInsights } from './capacity/InsightsSection';
import TuningSection from './capacity/TuningSection';
import HiringBody from './capacity/HiringSection';

const AR_DIGITS = ['١', '٢', '٣', '٤', '٥', '٦', '٧'];
const DOWS_AR = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
const DOWS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function StaffingEnginePage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';

  /* ── Core data ─────────────────────────────────────────────────────────── */
  const [params, setParams] = useState<StaffParams[]>([]);
  const [req, setReq] = useState<ReqResp | null>(null);
  const [from, setFrom] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [viewDate, setViewDate] = useState<string | null>(null);
  const [ordersScale, setOrdersScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState<Record<string, Partial<StaffParams>>>({});
  const [saving, setSaving] = useState(false);
  const [otPct, setOtPct] = useState(0);
  const [hiring, setHiring] = useState<HiringResp | null>(null);
  const [learned, setLearned] = useState<{ cells?: number; total_samples?: number; channels?: Record<string, { cells: number; grid: (number | null)[][] }> } | null>(null);

  const f = from, t = to >= from ? to : from;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, r] = await Promise.all([
        apiClient.get('/capacity/staffing/params'),
        apiClient.get('/capacity/staffing/requirement', { params: { from: f, to: t, ordersScale } }),
      ]);
      setParams(p.data); setReq(r.data);
      setViewDate(v => (v && r.data.days.some((d: { date: string }) => d.date === v)) ? v : r.data.days[0]?.date ?? null);
    } catch { /* keep last */ }
    setLoading(false);
  }, [f, t, ordersScale]);
  useEffect(() => { load(); }, [load]);

  // hiring verdict (re-computed when the range / requirement / OT lever changes)
  useEffect(() => {
    apiClient.get('/capacity/staffing/hiring-now', { params: { from: f, to: t, otPct } })
      .then(r => setHiring(r.data)).catch(() => setHiring(null));
  }, [f, t, req, otPct]);

  // learned floor (feeds the exec tile + the Tuning grid)
  const reloadLearned = useCallback(async () => {
    const r = await apiClient.get('/capacity/staffing/learned').catch(() => null);
    if (r) setLearned(r.data);
  }, []);
  useEffect(() => { reloadLearned(); }, [reloadLearned]);

  /* ── Optional engines (parallel backend agent — graceful until they land) ─ */
  const fa = useMaybe(`/capacity/staffing/forecast-accuracy?days=28`);
  const scen = useMaybe(`/capacity/staffing/scenario-compare?from=${f}&to=${t}`);
  const ins = useMaybe(`/capacity/staffing/insights?from=${f}&to=${t}`);

  /* ── Params editing ────────────────────────────────────────────────────── */
  const saveDirty = async () => {
    setSaving(true);
    try {
      for (const [fn, patch] of Object.entries(dirty)) {
        await apiClient.patch(`/capacity/staffing/params/${encodeURIComponent(fn)}`, patch);
      }
      setDirty({});
      await load();
    } catch { /* surface via reload */ }
    setSaving(false);
  };
  const edit = (fn: string, key: keyof StaffParams, val: unknown) => {
    setParams(ps => ps.map(p => p.functionKey === fn ? { ...p, [key]: val } : p));
    setDirty(d => ({ ...d, [fn]: { ...(d[fn] ?? {}), [key]: val } }));
  };

  /* ── Derived ───────────────────────────────────────────────────────────── */
  const day = useMemo(() => req?.days?.find(d => d.date === viewDate) ?? req?.days?.[0], [req, viewDate]);

  // sequential section numbering that stays clean when optional sections hide
  const showScen = scen.status === 'live' && normalizeScenarios(scen.data).length > 0;
  const showIns = ins.status === 'live' && normalizeInsights(ins.data).length > 0;
  const ids = ['demand', 'req', ...(showScen ? ['scen'] : []), 'hire', ...(showIns ? ['ins'] : []), 'tuning'];
  const no = (id: string) => { const i = ids.indexOf(id); return ar ? AR_DIGITS[i] : String(i + 1); };

  const soft = 'var(--surface-2)';

  return (
    <div className="space-y-4" dir={ar ? 'rtl' : 'ltr'}>
      {/* ── Header: the chain + the range + the day chips ─────────────────── */}
      <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-11 h-11 rounded-2xl grid place-items-center flex-shrink-0"
            style={{ background: `${PAL.require}1c`, border: `1px solid ${PAL.require}33` }}>
            <Sigma size={20} style={{ color: PAL.require }} />
          </div>
          <div className="min-w-0" style={{ minWidth: 220 }}>
            <div className="font-black text-base" style={{ color: 'var(--text-1)', letterSpacing: '-.02em' }}>
              {ar ? 'محرك التوظيف — من التوقع إلى الجدول' : 'Staffing Engine — forecast to schedule'}
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              {ar
                ? 'فوليوم × AHT فعّال (كلام+هولد+ACW) → Erlang-C عند هدف الـSL وسقف الإشغال → ÷ إنتاجية → ÷ (1−شرينكج) = المطلوب جدولته — هذا ما يستهلكه مولّد الجدول'
                : 'volume × effective AHT (talk+hold+ACW) → Erlang-C @ SL & occupancy cap → ÷ productivity → ÷ (1−shrinkage) = scheduled requirement — exactly what the generator consumes'}
            </div>
          </div>
          <div className="ms-auto flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>{ar ? 'من' : 'From'}</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="text-xs rounded-lg px-2 py-1.5"
              style={{ background: soft, color: 'var(--text-1)', border: '1px solid var(--border)', colorScheme: dark ? 'dark' : 'light' }} />
            <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>{ar ? 'إلى' : 'To'}</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="text-xs rounded-lg px-2 py-1.5"
              style={{ background: soft, color: 'var(--text-1)', border: '1px solid var(--border)', colorScheme: dark ? 'dark' : 'light' }} />
            <button onClick={load} className="p-1.5 rounded-lg" title={ar ? 'تحديث' : 'Refresh'}
              style={{ background: soft }}>
              {loading
                ? <Loader2 size={14} className="animate-spin" style={{ color: PAL.require }} />
                : <RefreshCw size={14} style={{ color: 'var(--text-3)' }} />}
            </button>
          </div>
        </div>

        {/* day chips across the range — drive sections ① and ② */}
        {(req?.days?.length ?? 0) > 1 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {req!.days.map(d => {
              const active = d.date === day?.date;
              const dow = d.dow ?? new Date(d.date).getDay();
              return (
                <button key={d.date} onClick={() => setViewDate(d.date)}
                  className="text-[9px] font-bold px-2 py-1 rounded-lg tabular-nums"
                  style={{
                    background: active ? PAL.require : soft,
                    color: active ? '#fff' : 'var(--text-3)',
                    boxShadow: active ? `0 2px 10px ${PAL.require}55` : 'none',
                  }}>
                  {d.date.slice(5)} · {ar ? DOWS_AR[dow] : DOWS_EN[dow]}
                  <span className="ms-1" style={{ opacity: 0.7 }}>({Math.max(...d.totalCurve48)})</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── ★ Executive strip — one glance = the whole story ──────────────── */}
      <ExecutiveStrip ar={ar} req={req} hiring={hiring} fa={fa} learned={learned} />

      {/* ── ① Demand forecast ─────────────────────────────────────────────── */}
      <Section no={no('demand')} icon={Inbox} color={PAL.demand}
        title={ar ? `توقع الطلب — ${day?.date ?? ''}` : `Demand forecast — ${day?.date ?? ''}`}
        desc={ar ? 'كم شغل جاي: منحنى الفوليوم لكل فنكشن (نفس يوم الأسبوع، آخر 28 يوم × البروفايل اليومي) + AHT المقاس + رافعة سيناريو الطلبات'
                 : 'how much work is coming: per-function volume curves (same-weekday 28d × intraday profile) + measured AHT + the orders scenario lever'}>
        <DemandSection ar={ar} req={req} day={day} ordersScale={ordersScale} onOrdersScale={setOrdersScale} />
      </Section>

      {/* ── ② Requirement heatmap ─────────────────────────────────────────── */}
      <Section no={no('req')} icon={Grid3X3} color={PAL.require}
        title={ar ? `المطلوب جدولته — فنكشن × ساعة — ${day?.date ?? ''}` : `Scheduled requirement — function × hour — ${day?.date ?? ''}`}
        desc={ar ? 'خرج المحرك الذي يستهلكه مولّد الجدول حرفيًا — اضغط أي خلية لتشوف الحساب السبع خطوات كاملاً'
                 : "the engine's output the schedule generator literally consumes — click any cell for the full 7-step math"}>
        <RequirementSection ar={ar} day={day} loading={loading} />
      </Section>

      {/* ── ③ Scenarios (graceful-hides until the compare endpoint lands) ─── */}
      <ScenarioSection ar={ar} no={no('scen')} scen={scen} />

      {/* ── ④ Hiring verdict ──────────────────────────────────────────────── */}
      <Section no={no('hire')} icon={UserPlus}
        color={hiring && hiring.totalInternsToHire > 0 ? PAL.risk : PAL.ok}
        title={ar ? 'قرار التوظيف' : 'Hiring verdict'}
        desc={ar ? 'الجواب المباشر: كم إنترن لازم توظف لهالفترة، وأي فنكشن هو القيد الملزم'
                 : 'the direct answer: how many interns to hire for this range, and which function is the binding constraint'}>
        {hiring ? (
          <HiringBody ar={ar} hiring={hiring} otPct={otPct} onOtPct={setOtPct} />
        ) : (
          <Awaiting ar={ar}
            text="Computing the hiring verdict for this range…"
            textAr="جاري حساب قرار التوظيف لهذه الفترة…" />
        )}
      </Section>

      {/* ── ⑤ Insights (graceful-hides until the insights endpoint lands) ─── */}
      <InsightsSection ar={ar} no={no('ins')} ins={ins} />

      {/* ── ⑥ Tuning & data (admin drawer) ────────────────────────────────── */}
      <TuningSection ar={ar} no={no('tuning')} params={params} edit={edit}
        dirtyCount={Object.keys(dirty).length} saveDirty={saveDirty} saving={saving}
        learned={learned} reloadLearned={reloadLearned} />

      {/* footer provenance line */}
      <div className="text-[9px] text-center pb-2" style={{ color: 'var(--text-3)' }}>
        {ar
          ? `كل الأرقام محسوبة حيًا من /capacity/staffing/* · الفترة ${req?.from ?? f} → ${req?.to ?? t} · سيناريو الطلبات ×${ordersScale.toFixed(2)}${req?.ordersPeriod ? ` · آخر طلبات ${req.ordersPeriod.period_label}: ${nfmt(req.ordersPeriod.count)}` : ''}`
          : `All numbers computed live from /capacity/staffing/* · range ${req?.from ?? f} → ${req?.to ?? t} · orders scenario ×${ordersScale.toFixed(2)}${req?.ordersPeriod ? ` · last orders ${req.ordersPeriod.period_label}: ${nfmt(req.ordersPeriod.count)}` : ''}`}
      </div>
    </div>
  );
}
