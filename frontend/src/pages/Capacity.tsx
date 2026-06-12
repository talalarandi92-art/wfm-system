import { useState, useEffect, useCallback } from 'react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import {
  Phone, MessageSquare, Mail, Zap, Users, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle, BarChart3, RefreshCw, ChevronDown, ChevronUp,
  Info, Calculator, Target, Clock, Activity, Minus, ShoppingBag, ArrowRight,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
 *  TYPES
 * ────────────────────────────────────────────────────────────────────────────*/
interface Func {
  id: string; name: string; name_ar: string; channel_type: string; concurrency: number;
}

interface IntervalRow {
  intervalStart: string;
  volume: number;
  aht?: number;
}

interface CalcInterval {
  intervalStart: string; intervalEnd: string;
  volume: number; aht: number; workload: number;
  requiredHc: number; requiredHcWithShrinkage: number;
  scheduledHc: number; gap: number;
  occupancy: number; serviceLevel?: number;
  risk: 'ok' | 'warning' | 'critical';
}

interface CapacityResult {
  functionId: string; functionName: string; channelType: string; date: string;
  totalRequired: number; totalScheduled: number; totalGap: number;
  avgOccupancy: number; slaAtRisk: boolean;
  intervals: CalcInterval[];
  scenarios: {
    base: { required: number; gap: number };
    withOT: { required: number; gap: number };
    lean: { required: number; gap: number };
  };
}

interface HcOverviewRow {
  function_id: string; func_name: string; channel_type: string; concurrency: string;
  scheduled_hc: string; wfh_hc: string; office_hc: string;
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  HELPERS
 * ────────────────────────────────────────────────────────────────────────────*/
const CHANNEL_META: Record<string, { icon: React.ElementType; label: string; color: string; bgDark: string }> = {
  voice:    { icon: Phone,         label: 'Voice / Inbound', color: 'text-blue-400',   bgDark: 'bg-blue-500/10 border-blue-500/30' },
  chat:     { icon: MessageSquare, label: 'Live Chat',        color: 'text-emerald-400', bgDark: 'bg-emerald-500/10 border-emerald-500/30' },
  whatsapp: { icon: MessageSquare, label: 'WhatsApp',          color: 'text-green-400',   bgDark: 'bg-green-500/10 border-green-500/30' },
  email:    { icon: Mail,          label: 'Email Support',     color: 'text-purple-400',  bgDark: 'bg-purple-500/10 border-purple-500/30' },
};

function channelMeta(ct: string) {
  return CHANNEL_META[ct] ?? { icon: Activity, label: ct, color: 'text-slate-400', bgDark: 'bg-slate-500/10 border-slate-500/30' };
}

function generateIntervals(startH = 6, endH = 24, stepMin = 30): IntervalRow[] {
  const rows: IntervalRow[] = [];
  for (let h = startH; h < endH; h++) {
    for (let m = 0; m < 60; m += stepMin) {
      rows.push({
        intervalStart: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,
        volume: 0,
      });
    }
  }
  return rows;
}

function riskColor(risk: string, dark: boolean) {
  if (risk === 'critical') return dark ? 'bg-red-500/20 text-red-300' : 'bg-red-100 text-red-700';
  if (risk === 'warning')  return dark ? 'bg-yellow-500/20 text-yellow-300' : 'bg-yellow-100 text-yellow-700';
  return dark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700';
}

function gapBadge(gap: number, dark: boolean) {
  if (gap > 3)  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${dark ? 'bg-red-500/20 text-red-300' : 'bg-red-100 text-red-700'}`}>-{gap}</span>;
  if (gap > 0)  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${dark ? 'bg-yellow-500/20 text-yellow-300' : 'bg-yellow-100 text-yellow-700'}`}>-{gap}</span>;
  if (gap === 0) return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${dark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700'}`}>✓</span>;
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${dark ? 'bg-slate-600 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>+{Math.abs(gap)}</span>;
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  VOLUME GRID EDITOR
 * ────────────────────────────────────────────────────────────────────────────*/
function VolumeGrid({
  rows, onChange, dark, globalAht
}: {
  rows: IntervalRow[]; onChange: (rows: IntervalRow[]) => void;
  dark: boolean; globalAht: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 8);

  function update(idx: number, field: 'volume' | 'aht', val: number) {
    const next = [...rows];
    next[idx] = { ...next[idx], [field]: val };
    onChange(next);
  }

  function applyFlat(val: number) {
    onChange(rows.map(r => ({ ...r, volume: val })));
  }

  const totalVol = rows.reduce((s, r) => s + (r.volume || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-semibold ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
          VOLUME BY INTERVAL — Total: {totalVol.toLocaleString()}
        </span>
        <div className="flex gap-2 items-center">
          <input
            type="number" min={0} placeholder="Flat volume"
            className={`w-24 text-xs px-2 py-1 rounded border ${dark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
            onBlur={e => { if (e.target.value) applyFlat(+e.target.value); }}
          />
          <button
            onClick={() => applyFlat(0)}
            className={`text-xs px-2 py-1 rounded ${dark ? 'bg-slate-700 hover:bg-slate-600 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
          >
            Clear
          </button>
        </div>
      </div>

      <div className={`rounded-lg border overflow-hidden text-xs ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
        <table className="w-full">
          <thead>
            <tr className={dark ? 'bg-slate-800' : 'bg-slate-50'}>
              <th className="px-3 py-2 text-left font-medium">Interval</th>
              <th className="px-3 py-2 text-center font-medium">Volume</th>
              <th className="px-3 py-2 text-center font-medium">AHT (s)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {visible.map((row, i) => (
              <tr key={row.intervalStart} className={i % 2 === 0 ? (dark ? 'bg-slate-800/40' : 'bg-white') : (dark ? 'bg-slate-800/20' : 'bg-slate-50/50')}>
                <td className={`px-3 py-1.5 font-mono ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{row.intervalStart}</td>
                <td className="px-2 py-1">
                  <input
                    type="number" min={0} value={row.volume || ''}
                    onChange={e => update(i, 'volume', +e.target.value)}
                    placeholder="0"
                    className={`w-full text-center rounded border px-1 py-0.5 ${dark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number" min={1} value={row.aht || ''}
                    onChange={e => update(i, 'aht', +e.target.value)}
                    placeholder={String(globalAht)}
                    className={`w-full text-center rounded border px-1 py-0.5 ${dark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 8 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className={`mt-2 w-full text-xs py-1.5 rounded flex items-center justify-center gap-1 ${dark ? 'bg-slate-700 hover:bg-slate-600 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
        >
          {expanded ? <><ChevronUp size={12} /> Show Less</> : <><ChevronDown size={12} /> Show All {rows.length} Intervals</>}
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  RESULTS TABLE
 * ────────────────────────────────────────────────────────────────────────────*/
function ResultsTable({ result, dark }: { result: CapacityResult; dark: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const intervals = result.intervals.filter(i => i.volume > 0 || i.scheduledHc > 0);
  const visible = showAll ? intervals : intervals.slice(0, 12);

  const isVoice = result.channelType === 'voice';

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Total Required', value: result.totalRequired, icon: Target, color: 'blue' },
          { label: 'Scheduled', value: result.totalScheduled, icon: Users, color: 'slate' },
          { label: 'Gap', value: result.totalGap, icon: result.totalGap > 0 ? TrendingDown : TrendingUp, color: result.totalGap > 0 ? 'red' : 'emerald' },
          { label: 'Avg Occupancy', value: `${(result.avgOccupancy * 100).toFixed(0)}%`, icon: Activity, color: result.avgOccupancy > 0.9 ? 'red' : 'emerald' },
        ].map(card => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={`rounded-xl border p-3 ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{card.label}</span>
                <Icon size={14} className={dark ? 'text-slate-500' : 'text-slate-400'} />
              </div>
              <div className={`text-xl font-bold ${
                card.color === 'red' ? 'text-red-400' :
                card.color === 'emerald' ? 'text-emerald-400' :
                card.color === 'blue' ? (dark ? 'text-blue-300' : 'text-blue-600') :
                (dark ? 'text-white' : 'text-slate-800')
              }`}>
                {typeof card.value === 'number' && card.color === 'red' && card.value > 0 ? `-${card.value}` : card.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* SLA warning */}
      {result.slaAtRisk && (
        <div className={`mb-4 flex items-center gap-2 px-3 py-2 rounded-lg text-sm border ${dark ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <AlertTriangle size={14} />
          SLA target is at risk — increase staffing or approve OT
        </div>
      )}

      {/* Scenarios */}
      <div className={`rounded-xl border p-3 mb-4 ${dark ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
        <div className="text-xs font-semibold mb-3 flex items-center gap-1.5">
          <BarChart3 size={13} />
          Scenario Comparison
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          {[
            { key: 'base',   label: 'Base (Current Shrinkage)', sc: result.scenarios.base },
            { key: 'withOT', label: 'With OT Coverage (-10%)',  sc: result.scenarios.withOT },
            { key: 'lean',   label: 'Lean Plan (+15%)',         sc: result.scenarios.lean },
          ].map(({ key, label, sc }) => (
            <div key={key} className={`rounded-lg p-2 border text-center ${dark ? 'bg-slate-700/50 border-slate-600' : 'bg-white border-slate-200'}`}>
              <div className={`text-[10px] mb-1.5 font-medium ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{label}</div>
              <div className={`text-lg font-bold ${dark ? 'text-white' : 'text-slate-800'}`}>{sc.required}</div>
              <div className={`text-[10px] mt-0.5 ${sc.gap > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {sc.gap > 0 ? `${sc.gap} understaffed` : sc.gap < 0 ? `${Math.abs(sc.gap)} surplus` : 'Balanced'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Interval table */}
      <div className={`rounded-xl border overflow-hidden ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
        <table className="w-full text-xs">
          <thead>
            <tr className={dark ? 'bg-slate-800' : 'bg-slate-50'}>
              <th className="px-3 py-2.5 text-left font-semibold">Interval</th>
              <th className="px-3 py-2.5 text-center font-semibold">Volume</th>
              <th className="px-3 py-2.5 text-center font-semibold">Workload</th>
              <th className="px-3 py-2.5 text-center font-semibold">Required HC</th>
              <th className="px-3 py-2.5 text-center font-semibold">+Shrinkage</th>
              <th className="px-3 py-2.5 text-center font-semibold">Scheduled</th>
              <th className="px-3 py-2.5 text-center font-semibold">Gap</th>
              <th className="px-3 py-2.5 text-center font-semibold">Occupancy</th>
              {isVoice && <th className="px-3 py-2.5 text-center font-semibold">SL%</th>}
              <th className="px-3 py-2.5 text-center font-semibold">Risk</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${dark ? 'divide-slate-700/40' : 'divide-slate-100'}`}>
            {visible.map((row, idx) => (
              <tr
                key={row.intervalStart}
                className={`${
                  row.risk === 'critical' ? (dark ? 'bg-red-500/8' : 'bg-red-50') :
                  row.risk === 'warning'  ? (dark ? 'bg-yellow-500/5' : 'bg-yellow-50/60') : ''
                } ${idx % 2 === 0 ? '' : (dark ? 'bg-slate-800/20' : '')}`}
              >
                <td className={`px-3 py-2 font-mono font-medium ${dark ? 'text-slate-300' : 'text-slate-700'}`}>
                  {row.intervalStart}–{row.intervalEnd}
                </td>
                <td className={`px-3 py-2 text-center ${dark ? 'text-slate-400' : 'text-slate-600'}`}>{row.volume || '–'}</td>
                <td className={`px-3 py-2 text-center ${dark ? 'text-slate-400' : 'text-slate-600'}`}>{row.workload || '–'}</td>
                <td className={`px-3 py-2 text-center font-semibold ${dark ? 'text-blue-300' : 'text-blue-700'}`}>{row.requiredHc || '–'}</td>
                <td className={`px-3 py-2 text-center font-semibold ${dark ? 'text-indigo-300' : 'text-indigo-700'}`}>{row.requiredHcWithShrinkage || '–'}</td>
                <td className={`px-3 py-2 text-center ${dark ? 'text-slate-300' : 'text-slate-700'}`}>{row.scheduledHc}</td>
                <td className="px-3 py-2 text-center">{gapBadge(row.gap, dark)}</td>
                <td className={`px-3 py-2 text-center ${row.occupancy > 0.9 ? 'text-red-400 font-semibold' : row.occupancy > 0.8 ? 'text-yellow-400' : (dark ? 'text-emerald-400' : 'text-emerald-600')}`}>
                  {row.volume > 0 ? `${(row.occupancy * 100).toFixed(0)}%` : '–'}
                </td>
                {isVoice && (
                  <td className={`px-3 py-2 text-center ${
                    row.serviceLevel !== undefined
                      ? row.serviceLevel < 0.7 ? 'text-red-400 font-semibold' :
                        row.serviceLevel < 0.85 ? 'text-yellow-400' : 'text-emerald-400'
                      : (dark ? 'text-slate-500' : 'text-slate-400')
                  }`}>
                    {row.serviceLevel !== undefined && row.volume > 0 ? `${(row.serviceLevel * 100).toFixed(0)}%` : '–'}
                  </td>
                )}
                <td className="px-3 py-2 text-center">
                  {row.volume > 0 ? (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${riskColor(row.risk, dark)}`}>
                      {row.risk === 'critical' ? '⚠ Critical' : row.risk === 'warning' ? '! Warning' : '✓ OK'}
                    </span>
                  ) : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {intervals.length > 12 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className={`mt-2 w-full text-xs py-2 rounded flex items-center justify-center gap-1 ${dark ? 'bg-slate-700 hover:bg-slate-600 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
        >
          {showAll ? <><ChevronUp size={12} /> Show Less</> : <><ChevronDown size={12} /> Show All {intervals.length} Intervals</>}
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  MAIN PAGE
 * ────────────────────────────────────────────────────────────────────────────*/
export default function CapacityPage() {
  const { dark, lang } = useUiStore();
  const ar = lang === 'ar';

  /* ── State ────────────────────────────────────────────────────────────── */
  const [functions, setFunctions] = useState<Func[]>([]);
  const [overview, setOverview] = useState<HcOverviewRow[]>([]);
  const [selectedFunc, setSelectedFunc] = useState<Func | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Per-channel inputs
  const [targetSL, setTargetSL] = useState(80);
  const [targetAnswerSec, setTargetAnswerSec] = useState(20);
  const [defaultAht, setDefaultAht] = useState(300);
  const [shrinkage, setShrinkage] = useState(25);
  const [occupancyTarget, setOccupancyTarget] = useState(85);
  const [internFactor, setInternFactor] = useState(70);
  const [openingBacklog, setOpeningBacklog] = useState(0);
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [intervals, setIntervals] = useState<IntervalRow[]>(() => generateIntervals());

  const [result, setResult] = useState<CapacityResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState('');
  const [overviewLoading, setOverviewLoading] = useState(false);

  // CPO Forecaster
  const [cpoOrders, setCpoOrders] = useState<number>(0);
  const [cpoPct, setCpoPct] = useState<number>(15);
  const [cpoResult, setCpoResult] = useState<{ forecastedCalls: number } | null>(null);
  const [cpoLoading, setCpoLoading] = useState(false);

  // Live Plan — measured Erlang-C plan from Sprinklr workload
  const [livePlan, setLivePlan] = useState<any | null>(null);
  const [livePlanLoading, setLivePlanLoading] = useState(false);
  const [lpSaveMsg, setLpSaveMsg] = useState('');

  const loadLivePlan = useCallback(() => {
    setLivePlanLoading(true);
    apiClient.get(`/capacity/live-plan?date=${date}`)
      .then(r => setLivePlan(r.data))
      .catch(() => setLivePlan(null))
      .finally(() => setLivePlanLoading(false));
  }, [date]);

  useEffect(() => { loadLivePlan(); }, [loadLivePlan]);

  const saveLivePlanScenario = async () => {
    if (!livePlan) return;
    try {
      await apiClient.post('/capacity/scenarios', {
        name: `Live Plan ${livePlan.date}`,
        channel: 'omni',
        scenarioType: 'base',
        inputs: livePlan.assumptions,
        results: { summary: livePlan.summary, coverage: livePlan.coverage },
        notes: ar ? 'محفوظ من الخطة الحية' : 'Saved from live plan',
      });
      setLpSaveMsg(ar ? '✅ حُفظ السيناريو' : '✅ Scenario saved');
    } catch {
      setLpSaveMsg(ar ? '✗ فشل الحفظ' : '✗ Save failed');
    }
    setTimeout(() => setLpSaveMsg(''), 4000);
  };

  /* ── Load functions ────────────────────────────────────────────────────── */
  useEffect(() => {
    apiClient.get('/capacity/functions').then((r: { data: Func[] }) => {
      setFunctions(r.data ?? []);
    }).catch(() => {});
  }, []);

  /* ── Load HC overview ──────────────────────────────────────────────────── */
  const loadOverview = useCallback(() => {
    setOverviewLoading(true);
    apiClient.get(`/capacity/hc-overview?date=${date}`).then((r: { data: HcOverviewRow[] }) => {
      setOverview(r.data ?? []);
    }).catch(() => {}).finally(() => setOverviewLoading(false));
  }, [date]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  /* ── Regenerate intervals when interval minutes changes ─────────────────── */
  useEffect(() => {
    setIntervals(generateIntervals(6, 24, intervalMinutes));
    setResult(null);
  }, [intervalMinutes]);

  /* ── Select function ───────────────────────────────────────────────────── */
  function selectFunc(fn: Func) {
    setSelectedFunc(fn);
    setResult(null);
    setError('');
    // Update defaults based on channel type
    if (fn.channel_type === 'chat' || fn.channel_type === 'whatsapp') {
      setDefaultAht(420); // 7 min AHT for chat
      setOccupancyTarget(75);
    } else if (fn.channel_type === 'email') {
      setDefaultAht(600); // 10 min per email
      setOccupancyTarget(85);
    } else {
      setDefaultAht(300); // 5 min AHT for voice
      setOccupancyTarget(85);
    }
  }

  /* ── Calculate ─────────────────────────────────────────────────────────── */
  async function calculate() {
    if (!selectedFunc) return;
    setCalculating(true);
    setError('');
    setResult(null);

    try {
      const ct = selectedFunc.channel_type;
      let endpoint = '/capacity/erlang';
      let payload: Record<string, unknown> = {};

      const baseInputs = {
        intervalMinutes,
        defaultAht,
        shrinkage: shrinkage / 100,
        occupancyTarget: occupancyTarget / 100,
        internFactor: internFactor / 100,
        intervals: intervals.map(r => ({
          intervalStart: r.intervalStart,
          volume: r.volume || 0,
          ...(r.aht ? { aht: r.aht } : {}),
        })),
      };

      if (ct === 'voice') {
        endpoint = '/capacity/erlang';
        payload = {
          functionId: selectedFunc.id, date,
          inputs: { ...baseInputs, targetSL: targetSL / 100, targetAnswerSec },
        };
      } else if (ct === 'chat' || ct === 'whatsapp') {
        endpoint = '/capacity/concurrent';
        payload = {
          functionId: selectedFunc.id, date,
          inputs: { ...baseInputs, concurrency: selectedFunc.concurrency || 4, targetResponseSec: targetAnswerSec },
        };
      } else if (ct === 'email') {
        endpoint = '/capacity/email';
        payload = {
          functionId: selectedFunc.id, date,
          inputs: { ...baseInputs, slaHours: 24, openingBacklog },
        };
      }

      const r = await apiClient.post(endpoint, payload);
      setResult(r.data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Calculation failed';
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setCalculating(false);
    }
  }

  /* ── CPO Forecast ───────────────────────────────────────────────────────── */
  async function calcCpo() {
    if (!cpoOrders) return;
    setCpoLoading(true);
    try {
      const r = await apiClient.post('/kpi-source/cpo/forecast', {
        orders: cpoOrders,
        cpoPct: cpoPct / 100,
      });
      setCpoResult(r.data);
    } catch {
      const calls = Math.round(cpoOrders * (cpoPct / 100));
      setCpoResult({ forecastedCalls: calls });
    } finally {
      setCpoLoading(false);
    }
  }

  function pushCpoToIntervals() {
    if (!cpoResult) return;
    const totalCalls = cpoResult.forecastedCalls;
    const activeIntervals = intervals.filter(r => r.intervalStart >= '07:00' && r.intervalStart <= '22:00');
    const perInterval = Math.round(totalCalls / (activeIntervals.length || 1));
    setIntervals(prev => prev.map(r => {
      const inActive = r.intervalStart >= '07:00' && r.intervalStart <= '22:00';
      return { ...r, volume: inActive ? perInterval : r.volume };
    }));
  }

  /* ─────────────────────────────────────────────────────────────────────────
   *  RENDER
   * ────────────────────────────────────────────────────────────────────────*/
  return (
    <div className={`min-h-screen p-4 sm:p-6 ${dark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`} dir={ar ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className={`text-2xl font-bold flex items-center gap-2 ${dark ? 'text-white' : 'text-slate-800'}`}>
            <Calculator size={24} className="text-blue-400" />
            {ar ? 'تخطيط الطاقة الاستيعابية' : 'Capacity Planning'}
          </h1>
          <p className={`text-sm mt-1 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            {ar ? 'احتساب الهيدكاونت المطلوب باستخدام Erlang-C ونماذج التزامن' : 'Erlang-C · Concurrency · Email Backlog Models'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className={`text-sm px-3 py-2 rounded-lg border ${dark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'}`}
          />
          <button
            onClick={loadOverview}
            className={`p-2 rounded-lg border ${dark ? 'bg-slate-800 border-slate-700 hover:bg-slate-700' : 'bg-white border-slate-300 hover:bg-slate-50'}`}
          >
            <RefreshCw size={15} className={overviewLoading ? 'animate-spin text-blue-400' : (dark ? 'text-slate-400' : 'text-slate-500')} />
          </button>
        </div>
      </div>

      {/* HC Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {overview.length === 0 && (
          <div className={`col-span-full text-center py-4 text-sm ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
            No scheduled HC data for selected date
          </div>
        )}
        {overview.map(row => {
          const meta = channelMeta(row.channel_type);
          const Icon = meta.icon;
          return (
            <div
              key={row.function_id}
              onClick={() => {
                const fn = functions.find(f => f.id === row.function_id);
                if (fn) selectFunc(fn);
              }}
              className={`rounded-xl border p-3 cursor-pointer transition-all ${
                selectedFunc?.id === row.function_id
                  ? (dark ? 'border-blue-500 bg-blue-500/10' : 'border-blue-400 bg-blue-50')
                  : (dark ? `${meta.bgDark} hover:border-slate-500` : 'bg-white border-slate-200 hover:border-slate-300')
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <Icon size={16} className={meta.color} />
                <span className={`text-xs px-1.5 py-0.5 rounded uppercase font-mono ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>{row.channel_type}</span>
              </div>
              <div className={`font-semibold text-sm truncate mb-1 ${dark ? 'text-white' : 'text-slate-800'}`}>{row.func_name}</div>
              <div className="flex items-end justify-between">
                <div>
                  <div className={`text-2xl font-bold ${dark ? 'text-white' : 'text-slate-800'}`}>{row.scheduled_hc}</div>
                  <div className={`text-[10px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>scheduled today</div>
                </div>
                <div className="text-right">
                  <div className={`text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>WFH: {row.wfh_hc}</div>
                  <div className={`text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Office: {row.office_hc}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── LIVE PLAN — Erlang-C on measured Sprinklr workload ─────────────── */}
      <div className={`rounded-xl border p-4 mb-5 ${dark ? 'bg-slate-800/80 border-slate-700' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Activity size={16} className="text-emerald-400" />
          <span className={`text-sm font-semibold ${dark ? 'text-slate-200' : 'text-slate-700'}`}>
            {ar ? 'الخطة الحية — من الحمل المُقاس فعلياً' : 'Live Plan — from measured workload'}
          </span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${dark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'}`}>
            Erlang-C · {ar ? 'سبرينكلر' : 'Sprinklr'}
          </span>
          <button onClick={loadLivePlan} disabled={livePlanLoading}
            className={`ms-auto flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold ${dark ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            <RefreshCw size={12} className={livePlanLoading ? 'animate-spin' : ''} />
            {ar ? 'تحديث' : 'Refresh'}
          </button>
          <button onClick={saveLivePlanScenario} disabled={!livePlan}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
            {ar ? 'حفظ كسيناريو' : 'Save scenario'}
          </button>
          {lpSaveMsg && <span className="text-xs font-bold text-emerald-400">{lpSaveMsg}</span>}
        </div>

        {!livePlan ? (
          <p className={`text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
            {livePlanLoading ? (ar ? 'جاري الحساب…' : 'Computing…') : (ar ? 'لا توجد بيانات سبرينكلر لهذا اليوم' : 'No Sprinklr data for this date')}
          </p>
        ) : (
          <>
            {/* Summary KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
              {[
                { l: ar ? 'ذروة الحمل (إرلانج)' : 'Peak Erlangs', v: livePlan.summary.peakErlangs, c: 'text-indigo-400' },
                { l: ar ? 'ذروة المطلوب' : 'Peak Required HC', v: livePlan.summary.peakRequiredHc, c: 'text-amber-400' },
                { l: ar ? 'متوسط المطلوب' : 'Avg Required', v: livePlan.summary.avgRequiredHc, c: 'text-sky-400' },
                { l: ar ? 'متوسط المجدول' : 'Avg Scheduled', v: livePlan.summary.avgScheduledHc, c: 'text-slate-300' },
                { l: ar ? 'أسوأ عجز' : 'Worst Gap', v: livePlan.summary.worstGap, c: livePlan.summary.worstGap > 0 ? 'text-red-400' : 'text-emerald-400' },
              ].map(k => (
                <div key={k.l} className={`rounded-lg p-2.5 text-center ${dark ? 'bg-slate-900/60' : 'bg-slate-50'}`}>
                  <div className={`text-xl font-black tabular-nums ${k.c}`}>{k.v}</div>
                  <div className={`text-[10px] mt-0.5 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{k.l}</div>
                </div>
              ))}
            </div>

            {/* Interval bars: required vs scheduled */}
            <div className="flex items-end gap-0.5 overflow-x-auto pb-1" style={{ height: 110 }}>
              {livePlan.intervals.filter((x: any) => x.measured).map((iv: any) => {
                const maxV = Math.max(1, livePlan.summary.peakRequiredHc);
                return (
                  <div key={iv.interval} className="flex flex-col items-center gap-0.5" style={{ minWidth: 30 }}
                    title={`${iv.interval} — ${ar ? 'مطلوب' : 'req'} ${iv.requiredHc} / ${ar ? 'مجدول' : 'sched'} ${iv.scheduledHc} | ${iv.totalErlangs} Erlangs | ${iv.channels.map((c: any) => `${c.channel}:${c.erlangs}`).join(' ')}`}>
                    <div className="flex items-end gap-px" style={{ height: 80 }}>
                      <div className="rounded-t" style={{ width: 11, height: Math.max(2, (iv.requiredHc / maxV) * 80), background: iv.risk === 'critical' ? '#ef4444' : iv.risk === 'warning' ? '#f59e0b' : '#34d399' }} />
                      <div className="rounded-t" style={{ width: 11, height: Math.max(2, (iv.scheduledHc / maxV) * 80), background: 'rgba(129,140,248,0.5)' }} />
                    </div>
                    <span className={`text-[8px] tabular-nums ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{iv.interval}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-1">
              <span className={`text-[10px] flex items-center gap-1 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                <span className="w-2 h-2 rounded-sm inline-block bg-emerald-400" /> {ar ? 'مطلوب (Erlang-C + انكماش)' : 'Required (Erlang-C + shrinkage)'}
              </span>
              <span className={`text-[10px] flex items-center gap-1 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(129,140,248,0.6)' }} /> {ar ? 'مجدول' : 'Scheduled'}
              </span>
              <span className={`text-[10px] ms-auto ${dark ? 'text-slate-600' : 'text-slate-400'}`}>
                {livePlan.assumptions.method} · SL {Math.round(livePlan.assumptions.targetSL * 100)}%/{livePlan.assumptions.targetAnswerSec}s · {ar ? 'انكماش' : 'shrink'} {Math.round(livePlan.assumptions.shrinkage * 100)}% · {ar ? 'تزامن' : 'conc'} ×{livePlan.assumptions.concurrency}
              </span>
            </div>
          </>
        )}
      </div>

      {/* CPO Forecaster */}
      <div className={`rounded-xl border p-4 mb-5 ${dark ? 'bg-slate-800/80 border-slate-700' : 'bg-white border-slate-200'}`}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <ShoppingBag size={16} className="text-amber-400" />
            <span className={`text-sm font-semibold ${dark ? 'text-slate-200' : 'text-slate-700'}`}>
              CPO Forecaster
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${dark ? 'bg-amber-500/15 text-amber-300' : 'bg-amber-50 text-amber-600 border border-amber-200'}`}>
              Calls Per Order
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 flex-1">
            {/* Orders input */}
            <div className="flex items-center gap-2">
              <label className={`text-xs whitespace-nowrap ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                Daily Orders
              </label>
              <input
                type="number" min={0} value={cpoOrders || ''}
                onChange={e => { setCpoOrders(+e.target.value); setCpoResult(null); }}
                placeholder="e.g. 1000"
                className={`w-28 text-center px-2 py-1.5 rounded-lg border text-sm font-mono ${dark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
              />
            </div>

            {/* CPO% slider */}
            <div className="flex items-center gap-2">
              <label className={`text-xs whitespace-nowrap ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                CPO%
              </label>
              <input
                type="range" min={1} max={100} value={cpoPct}
                onChange={e => { setCpoPct(+e.target.value); setCpoResult(null); }}
                className="w-24 accent-amber-500"
              />
              <input
                type="number" min={1} max={100} value={cpoPct}
                onChange={e => { setCpoPct(+e.target.value); setCpoResult(null); }}
                className={`w-16 text-center px-2 py-1.5 rounded-lg border text-sm font-mono ${dark ? 'bg-slate-700 border-slate-600 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-700'}`}
              />
              <span className={`text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>%</span>
            </div>

            {/* Calculate button */}
            <button
              onClick={calcCpo}
              disabled={!cpoOrders || cpoLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                !cpoOrders
                  ? (dark ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-slate-100 text-slate-400 cursor-not-allowed')
                  : (dark ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30' : 'bg-amber-500 text-white hover:bg-amber-600')
              }`}
            >
              {cpoLoading ? <RefreshCw size={13} className="animate-spin" /> : <Calculator size={13} />}
              Forecast
            </button>

            {/* Result */}
            {cpoResult && (
              <div className="flex items-center gap-3">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border font-mono ${dark ? 'bg-slate-700 border-slate-600' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{cpoOrders.toLocaleString()} orders × {cpoPct}%</span>
                  <ArrowRight size={12} className={dark ? 'text-slate-500' : 'text-slate-400'} />
                  <span className={`text-base font-bold ${dark ? 'text-amber-300' : 'text-amber-600'}`}>
                    {cpoResult.forecastedCalls.toLocaleString()}
                  </span>
                  <span className={`text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>forecasted calls</span>
                </div>
                {selectedFunc && (
                  <button
                    onClick={pushCpoToIntervals}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      dark
                        ? 'bg-blue-500/15 border-blue-500/30 text-blue-300 hover:bg-blue-500/25'
                        : 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100'
                    }`}
                    title="Distribute forecasted calls evenly across 07:00–22:00 intervals"
                  >
                    <ArrowRight size={11} />
                    Push to intervals
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Formula tooltip */}
          <div className={`text-xs shrink-0 ${dark ? 'text-slate-500' : 'text-slate-400'}`} title="Expected Calls = Orders × CPO%">
            <Info size={13} />
          </div>
        </div>

        {cpoResult && (
          <div className={`mt-2 text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
            Formula: {cpoOrders.toLocaleString()} orders × {cpoPct}% CPO = <strong className={dark ? 'text-amber-300' : 'text-amber-600'}>{cpoResult.forecastedCalls.toLocaleString()} expected calls</strong>
            {selectedFunc && !result && <span className="ml-2 italic">— click "Push to intervals" to distribute across the volume grid, then Calculate</span>}
          </div>
        )}
      </div>

      {/* Main calculator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left panel — inputs */}
        <div className="lg:col-span-4 space-y-4">
          {/* Function selector (if not picked from overview) */}
          {functions.length > 0 && (
            <div className={`rounded-xl border p-4 ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              <div className={`text-xs font-semibold mb-3 uppercase tracking-wide ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                Select Function
              </div>
              <div className="grid grid-cols-2 gap-2">
                {functions.map(fn => {
                  const meta = channelMeta(fn.channel_type);
                  const Icon = meta.icon;
                  return (
                    <button
                      key={fn.id}
                      onClick={() => selectFunc(fn)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all text-left ${
                        selectedFunc?.id === fn.id
                          ? (dark ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-blue-400 bg-blue-50 text-blue-700')
                          : (dark ? 'border-slate-600 hover:border-slate-500 text-slate-300' : 'border-slate-200 hover:border-slate-300 text-slate-600')
                      }`}
                    >
                      <Icon size={14} className={meta.color} />
                      <span className="truncate font-medium">{fn.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Model parameters */}
          {selectedFunc && (
            <div className={`rounded-xl border p-4 ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              <div className={`text-xs font-semibold mb-3 uppercase tracking-wide flex items-center gap-1.5 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                <Zap size={12} />
                Model Parameters — {selectedFunc.name}
              </div>

              <div className="space-y-3 text-sm">
                {/* Interval */}
                <div className="flex items-center justify-between">
                  <label className={dark ? 'text-slate-400' : 'text-slate-500'}>Interval (min)</label>
                  <select
                    value={intervalMinutes}
                    onChange={e => setIntervalMinutes(+e.target.value)}
                    className={`w-24 px-2 py-1.5 rounded-lg border text-sm ${dark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
                  >
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                    <option value={60}>60 min</option>
                  </select>
                </div>

                {/* Default AHT */}
                <div className="flex items-center justify-between">
                  <label className={dark ? 'text-slate-400' : 'text-slate-500'}>
                    Default AHT (sec)
                    <span className={`ml-1 text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{Math.floor(defaultAht / 60)}m {defaultAht % 60}s</span>
                  </label>
                  <input
                    type="number" min={30} max={3600} value={defaultAht}
                    onChange={e => setDefaultAht(+e.target.value)}
                    className={`w-20 text-center px-2 py-1.5 rounded-lg border text-sm ${dark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
                  />
                </div>

                {/* Voice-specific: Target SL + Answer time */}
                {selectedFunc.channel_type === 'voice' && (
                  <>
                    <div className="flex items-center justify-between">
                      <label className={dark ? 'text-slate-400' : 'text-slate-500'}>
                        Target SL (%)
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="range" min={50} max={99} value={targetSL}
                          onChange={e => setTargetSL(+e.target.value)}
                          className="w-20"
                        />
                        <span className={`w-10 text-center text-sm font-mono ${dark ? 'text-blue-300' : 'text-blue-600'}`}>{targetSL}%</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className={dark ? 'text-slate-400' : 'text-slate-500'}>
                        Target Answer (sec)
                      </label>
                      <input
                        type="number" min={5} max={120} value={targetAnswerSec}
                        onChange={e => setTargetAnswerSec(+e.target.value)}
                        className={`w-20 text-center px-2 py-1.5 rounded-lg border text-sm ${dark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
                      />
                    </div>
                  </>
                )}

                {/* Chat/WA: Target response time */}
                {(selectedFunc.channel_type === 'chat' || selectedFunc.channel_type === 'whatsapp') && (
                  <>
                    <div className="flex items-center justify-between">
                      <label className={dark ? 'text-slate-400' : 'text-slate-500'}>Concurrency</label>
                      <span className={`text-sm font-bold ${dark ? 'text-emerald-300' : 'text-emerald-600'}`}>{selectedFunc.concurrency || 4}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className={dark ? 'text-slate-400' : 'text-slate-500'}>Target Response (sec)</label>
                      <input
                        type="number" min={30} max={600} value={targetAnswerSec}
                        onChange={e => setTargetAnswerSec(+e.target.value)}
                        className={`w-20 text-center px-2 py-1.5 rounded-lg border text-sm ${dark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
                      />
                    </div>
                  </>
                )}

                {/* Email: Opening backlog */}
                {selectedFunc.channel_type === 'email' && (
                  <div className="flex items-center justify-between">
                    <label className={dark ? 'text-slate-400' : 'text-slate-500'}>Opening Backlog</label>
                    <input
                      type="number" min={0} value={openingBacklog}
                      onChange={e => setOpeningBacklog(+e.target.value)}
                      className={`w-20 text-center px-2 py-1.5 rounded-lg border text-sm ${dark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300'}`}
                    />
                  </div>
                )}

                {/* Shrinkage */}
                <div className="flex items-center justify-between">
                  <label className={dark ? 'text-slate-400' : 'text-slate-500'}>Shrinkage (%)</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="range" min={0} max={50} value={shrinkage}
                      onChange={e => setShrinkage(+e.target.value)}
                      className="w-20"
                    />
                    <span className={`w-10 text-center text-sm font-mono ${dark ? 'text-yellow-300' : 'text-yellow-600'}`}>{shrinkage}%</span>
                  </div>
                </div>

                {/* Occupancy target */}
                <div className="flex items-center justify-between">
                  <label className={dark ? 'text-slate-400' : 'text-slate-500'}>Occupancy Target (%)</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="range" min={60} max={95} value={occupancyTarget}
                      onChange={e => setOccupancyTarget(+e.target.value)}
                      className="w-20"
                    />
                    <span className={`w-10 text-center text-sm font-mono ${dark ? 'text-orange-300' : 'text-orange-600'}`}>{occupancyTarget}%</span>
                  </div>
                </div>

                {/* Intern factor */}
                <div className="flex items-center justify-between">
                  <label className={`flex items-center gap-1 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Intern Productivity
                    <span title="Intern = 70% of full agent by default" className="cursor-help">
                      <Info size={11} className={dark ? 'text-slate-500' : 'text-slate-400'} />
                    </span>
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="range" min={40} max={100} value={internFactor}
                      onChange={e => setInternFactor(+e.target.value)}
                      className="w-20"
                    />
                    <span className={`w-10 text-center text-sm font-mono ${dark ? 'text-purple-300' : 'text-purple-600'}`}>{internFactor}%</span>
                  </div>
                </div>
              </div>

              {/* Assumptions info box */}
              <div className={`mt-3 rounded-lg p-2.5 text-xs border ${dark ? 'bg-slate-700/50 border-slate-600 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                <div className="flex items-center gap-1 mb-1 font-medium"><Info size={10} /> Model assumptions</div>
                <div>• Shrinkage applied as gross staffing factor</div>
                <div>• Erlang-C assumes steady-state, random arrivals</div>
                {(selectedFunc.channel_type === 'chat' || selectedFunc.channel_type === 'whatsapp') && (
                  <div>• Concurrency = {selectedFunc.concurrency || 4} simultaneous conversations per agent</div>
                )}
                <div>• Intern factor reduces effective productive time</div>
              </div>
            </div>
          )}
        </div>

        {/* Right panel — volume input + results */}
        <div className="lg:col-span-8 space-y-4">
          {!selectedFunc ? (
            <div className={`rounded-xl border p-12 flex flex-col items-center justify-center ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              <Calculator size={48} className={`mb-3 ${dark ? 'text-slate-600' : 'text-slate-300'}`} />
              <div className={`text-lg font-semibold mb-1 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                Select a function to start
              </div>
              <div className={`text-sm ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                Click one of the HC cards above or select from the function list
              </div>
            </div>
          ) : (
            <>
              {/* Volume input */}
              <div className={`rounded-xl border p-4 ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                    <Clock size={12} />
                    Volume Forecast — {selectedFunc.name}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                      {selectedFunc.channel_type === 'email' ? 'emails/interval' :
                       selectedFunc.channel_type === 'voice' ? 'calls/interval' : 'chats/interval'}
                    </span>
                  </div>
                </div>
                <VolumeGrid
                  rows={intervals}
                  onChange={setIntervals}
                  dark={dark}
                  globalAht={defaultAht}
                />
              </div>

              {/* Calculate button */}
              <button
                onClick={calculate}
                disabled={calculating}
                className={`w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all ${
                  calculating
                    ? (dark ? 'bg-blue-600/50 cursor-not-allowed text-blue-300' : 'bg-blue-300 cursor-not-allowed text-white')
                    : (dark ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/30' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200')
                }`}
              >
                {calculating ? (
                  <><RefreshCw size={16} className="animate-spin" /> Calculating…</>
                ) : (
                  <><Calculator size={16} /> Calculate Required HC</>
                )}
              </button>

              {error && (
                <div className={`rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${dark ? 'bg-red-500/10 border border-red-500/30 text-red-300' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                  <AlertTriangle size={14} />
                  {error}
                </div>
              )}

              {/* Results */}
              {result && (
                <div className={`rounded-xl border p-4 ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                      <BarChart3 size={12} />
                      Results — {result.functionName}
                      <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
                        {result.channelType}
                      </span>
                    </div>
                    <span className={`text-xs flex items-center gap-1 ${result.slaAtRisk ? 'text-red-400' : 'text-emerald-400'}`}>
                      {result.slaAtRisk ? <AlertTriangle size={12} /> : <CheckCircle size={12} />}
                      {result.slaAtRisk ? 'SLA at risk' : 'SLA safe'}
                    </span>
                  </div>
                  <ResultsTable result={result} dark={dark} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className={`mt-6 rounded-xl border p-3 flex flex-wrap gap-4 text-xs ${dark ? 'bg-slate-800/50 border-slate-700 text-slate-500' : 'bg-white border-slate-200 text-slate-400'}`}>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Required HC = pure staffing need (no shrinkage)</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" /> +Shrinkage = gross HC needed on roster</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Critical = gap &gt; 3 agents</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> Warning = gap 1–3 agents</span>
        <span className="flex items-center gap-1.5"><Minus size={10} /> Workload = Traffic Intensity (Erlangs) for voice; normalized concurrent load for chat</span>
      </div>
    </div>
  );
}
