import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Trophy, Upload, ChevronDown, ChevronRight, Loader2,
  BarChart2, RefreshCw, Eye, Trash2, Gift,
  CheckCircle, X, Database, Star, TrendingUp, TrendingDown,
  User, Target, BookOpen, Download, Minus, LayoutDashboard,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { apiClient } from '@/api/client';
import { tp, useInjectDsStyles } from '@/components/ds';

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface DashboardData {
  totals: { totalEmployees: number; passing: number; failing: number; overallAvg: number; highest: number; lowest: number };
  functionAverages: { functionName: string; empCount: number; avgNetPoints: number; avgQualityPct: number; avgAhtMins: number; avgFcrPct: number; avgWdPct: number; belowZeroCount: number; passingCount: number }[];
  top3PerFunction: { employeeName: string; functionName: string; netPoints: number | null; podiumRank: number; loginId: string }[];
  coachingList: { employeeName: string; employeeNo: string; loginId: string; functionName: string; teamLeader: string; netPoints: number | null; qualityScore: number | null; ahtScore: number | null; fcrScore: number | null; quizScore: number | null; mistakesScore: number | null; functionRank: number | null }[];
}
interface TrendEntry { loginId: string; netPoints: number | null; prevNetPoints: number | null; delta: number | null }

interface Batch {
  id: string; periodName: string; periodYear: number; periodMonth: number;
  totalEmployees: number; uploadedAt: string; status: string;
  uploadedByName: string; finalCount: number; notes: string | null;
}
interface Preview {
  periodName: string; periodYear: number; periodMonth: number;
  totalEmployees: number; totalEntries: number;
  functions: string[]; sampleRows: any[];
}
interface Entry {
  employeeName: string; employeeNo: string; loginId: string;
  functionName: string; teamLeader: string; weekLabel: string;
  workingDaysPct: number | null; netPoints: number | null; functionRank: number | null;
  qualityActual: number | null;    qualityScore: number | null;
  ahtActual: number | null;        ahtScore: number | null;
  fcrActual: number | null;        fcrScore: number | null;
  productivityActual: number | null; productivityScore: number | null;
  ctrActual: number | null;        ctrScore: number | null;
  quizActual: number | null;       quizScore: number | null;
  mistakesActual: number | null;   mistakesScore: number | null;
  incidentsActual: number | null;  incidentsScore: number | null;
  rtActual: number | null;         rtScore: number | null;
  prrRate: number | null; prrPoints: number | null; prrBonus: number | null;
  responseRate: number | null; incentiveKd: number | null;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const pct  = (v: number | null) => v === null ? '—' : `${(v * 100).toFixed(0)}%`;
const mins = (v: number | null) => v === null ? '—' : `${Math.round(v * 1440)}m`;
const medal = (rank: number | null) => {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return null;
};

/* ─── Theme-aware neutral tokens ─────────────────────────────────────────────
   The ONE documented home for this page's near-black / near-white NEUTRALS.
   The dark branch is byte-identical to the original scattered literals; the light
   branch mirrors black-tint fills to slate-navy (rgba(15,23,42,…)) and keeps genuine
   white surfaces white (real light-theme card fills). Fed by ds tp() for hero text.
   NOT tokenized (stay inline, read on both themes): semantic status hues
   (green #22c55e / amber #f59e0b / red #ef4444 score bands, wd/scoreBg tints),
   brand accents (#818cf8 · #fbbf24 · fnColor), and mid-gray muted text
   (#475569 · #64748b · #94a3b8 · #334155 · #cbd5e1). Shared by every sub-component
   via `const T = nt(dark)` so residual neutral literals live here only. */
const nt = (dark: boolean) => ({
  // near-white / near-black TEXT
  txPri:   dark ? '#e2e8f0' : '#0f172a',    // primary value / heading text
  txPri2:  dark ? '#e2e8f0' : '#1e293b',    // primary text (softer light)
  txDash:  dark ? '#1e293b' : '#e2e8f0',    // intentionally faint em-dash placeholder
  // translucent neutral FILLS / BORDERS — light mirrors black → slate-navy
  n1:      dark ? 'rgba(255,255,255,0.01)'  : 'rgba(15,23,42,0.01)',
  n1b:     dark ? 'rgba(255,255,255,0.01)'  : 'rgba(15,23,42,0.02)',   // dropzone rest bg
  n15:     dark ? 'rgba(255,255,255,0.015)' : 'rgba(15,23,42,0.02)',   // expanded zebra
  n4:      dark ? 'rgba(255,255,255,0.04)'  : 'rgba(15,23,42,0.04)',
  n4b:     dark ? 'rgba(255,255,255,0.04)'  : 'rgba(15,23,42,0.03)',   // open-row bg
  n6:      dark ? 'rgba(255,255,255,0.06)'  : 'rgba(15,23,42,0.06)',
  n8c:     dark ? 'rgba(255,255,255,0.08)'  : 'rgba(15,23,42,0.06)',   // active tab chip
  n10c:    dark ? 'rgba(255,255,255,0.1)'   : 'rgba(15,23,42,0.08)',   // active filter pill
  b7:      dark ? 'rgba(255,255,255,0.07)'  : 'rgba(15,23,42,0.08)',   // card border
  b8:      dark ? 'rgba(255,255,255,0.08)'  : 'rgba(15,23,42,0.08)',
  b8d:     dark ? 'rgba(255,255,255,0.08)'  : 'rgba(15,23,42,0.1)',    // dropzone border
  b10:     dark ? 'rgba(255,255,255,0.1)'   : 'rgba(15,23,42,0.1)',
  rowBg:   dark ? 'rgba(255,255,255,0.02)'  : 'rgba(15,23,42,0.015)',  // perf table zebra row
  // genuine WHITE / opaque light surfaces (light stays white — real card fills)
  cardBg:  dark ? 'rgba(255,255,255,0.03)'  : '#ffffff',
  surface: dark ? 'rgba(255,255,255,0.03)'  : 'rgba(255,255,255,0.8)',
  glass:   dark ? 'rgba(255,255,255,0.02)'  : 'rgba(255,255,255,0.7)', // blurred expanded card
  innerBg: dark ? 'rgba(0,0,0,0.2)'         : 'rgba(255,255,255,0.5)', // inner metric tile
  sortBg:  dark ? 'rgba(255,255,255,0.08)'  : '#ffffff',              // active sort toggle
});

const scoreColor = (s: number | null) => {
  if (s === null) return undefined;
  if (s > 0)  return '#22c55e';
  if (s < 0)  return '#ef4444';
  return '#f59e0b';
};
const scoreBg = (s: number | null, dark: boolean) => {
  if (s === null) return nt(dark).n4;
  if (s > 0)  return 'rgba(34,197,94,0.12)';
  if (s < 0)  return 'rgba(239,68,68,0.12)';
  return 'rgba(245,158,11,0.12)';
};
const FN_COLORS: Record<string, string> = {
  'CH - WA':             '#818cf8',
  'Inbound':             '#34d399',
  'OMT':                 '#fbbf24',
  'Refund':              '#fb923c',
  'Social Media & Email':'#a78bfa',
  'Customer Care':       '#22d3ee',
  'Offline':             '#64748b',
};
const fnColor = (fn: string) => FN_COLORS[fn] ?? '#64748b';

const wdBadge = (v: number | null) => {
  if (v === null) return { bg: 'rgba(100,116,139,0.1)', color: '#64748b' };
  const p = v * 100;
  if (p >= 90) return { bg: 'rgba(34,197,94,0.12)', color: '#22c55e' };
  if (p >= 70) return { bg: 'rgba(251,191,36,0.12)', color: '#f59e0b' };
  return { bg: 'rgba(239,68,68,0.12)', color: '#ef4444' };
};

/* ─── Tiny KPI dot ─────────────────────────────────────────────────────── */
function KpiDot({ score }: { score: number | null }) {
  const c = scoreColor(score);
  return (
    <div className="w-2 h-2 rounded-full flex-shrink-0"
      style={{ background: c ?? '#475569', boxShadow: c ? `0 0 4px ${c}80` : undefined }} />
  );
}

/* ─── Score chip (expanded detail) ──────────────────────────────────────── */
function ScoreChip({ label, actual, score, dark }: { label: string; actual: string; score: number | null; dark: boolean }) {
  const T  = nt(dark);
  const c  = scoreColor(score);
  const bg = scoreBg(score, dark);
  return (
    <div className="flex flex-col items-center gap-1 min-w-[60px] rounded-xl p-2.5"
      style={{ background: bg, border: `1px solid ${c ? c + '25' : (T.n6)}` }}>
      <span className="text-[9px] uppercase tracking-wider font-bold"
        style={{ color: dark ? '#64748b' : '#94a3b8' }}>{label}</span>
      <span className="text-[10px] font-medium"
        style={{ color: dark ? '#94a3b8' : '#64748b' }}>{actual}</span>
      <span className="text-sm font-black" style={{ color: c ?? (dark ? '#475569' : '#94a3b8') }}>
        {score !== null ? (score > 0 ? `+${score}` : score) : '—'}
      </span>
    </div>
  );
}

/* ─── Podium card (top 3 per function) ──────────────────────────────────── */
function PodiumCard({ entry, dark }: { entry: Entry; dark: boolean }) {
  const T    = nt(dark);
  const rank = entry.functionRank ?? 0;
  const m    = medal(rank);
  const netC = scoreColor(entry.netPoints);
  const heights = { 1: 'h-20', 2: 'h-16', 3: 'h-12' };
  const sizes   = { 1: 'text-3xl', 2: 'text-2xl', 3: 'text-xl' };
  const orders  = { 1: 'order-2', 2: 'order-1', 3: 'order-3' };

  return (
    <div className={`flex flex-col items-center gap-2 ${orders[rank as 1|2|3] ?? ''}`}>
      <div className="text-2xl">{m}</div>
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold"
        style={{ background: T.n6,
                 border: `2px solid ${netC ?? '#475569'}40`,
                 color: T.txPri2 }}>
        {(entry.employeeName || '').split(' ')[0]?.[0]?.toUpperCase()}
        {(entry.employeeName || '').split(' ')[1]?.[0]?.toUpperCase()}
      </div>
      <div className="text-center">
        <div className="text-xs font-semibold max-w-[90px] truncate"
          style={{ color: T.txPri2 }}>
          {(entry.employeeName || '').split(' ').slice(0, 2).join(' ')}
        </div>
        <div className={`font-black tabular-nums ${sizes[rank as 1|2|3] ?? 'text-lg'}`}
          style={{ color: netC ?? (dark ? '#475569' : '#94a3b8') }}>
          {entry.netPoints ?? '—'}
        </div>
        {entry.incentiveKd ? (
          <div className="text-[10px] font-bold mt-0.5"
            style={{ color: '#fbbf24' }}>
            🎁 {entry.incentiveKd} KD
          </div>
        ) : null}
      </div>
      <div className={`w-full rounded-t-lg ${heights[rank as 1|2|3] ?? 'h-10'}`}
        style={{ background: `linear-gradient(to top, ${netC ?? '#475569'}30, transparent)` }} />
    </div>
  );
}

/* ─── Employee row ────────────────────────────────────────────────────────── */
function EmployeeRow({ e, ar, dark, trendDelta }: { e: Entry; ar: boolean; dark: boolean; trendDelta?: number | null }) {
  const T = nt(dark);
  const [open, setOpen] = useState(false);
  const netC = scoreColor(e.netPoints);
  const m    = medal(e.functionRank);
  const wd   = wdBadge(e.workingDaysPct);

  const rowBg = open
    ? (T.n4b)
    : undefined;
  const rowHover = dark ? 'hover:bg-white/[0.025]' : 'hover:bg-black/[0.02]';

  return (
    <>
      <tr
        onClick={() => setOpen(o => !o)}
        className={`cursor-pointer transition-colors ${rowHover}`}
        style={{ background: rowBg }}>

        {/* Rank */}
        <td className="py-2.5 px-3 text-center w-10">
          <span className="text-sm">{m ?? (
            <span className="text-xs tabular-nums" style={{ color: dark ? '#475569' : '#94a3b8' }}>
              {e.functionRank ?? '—'}
            </span>
          )}</span>
        </td>

        {/* Name + loginId */}
        <td className="py-2.5 px-3">
          <div className="text-sm font-semibold"
            style={{ color: T.txPri }}>
            {e.employeeName}
          </div>
          <div className="text-[10px]"
            style={{ color: dark ? '#475569' : '#94a3b8' }}>
            {e.loginId}{e.employeeNo ? ` · #${e.employeeNo}` : ''}
          </div>
        </td>

        {/* WD% */}
        <td className="py-2.5 px-3 text-center hidden md:table-cell">
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold tabular-nums"
            style={{ background: wd.bg, color: wd.color }}>
            {pct(e.workingDaysPct)}
          </span>
        </td>

        {/* Net Points */}
        <td className="py-2.5 px-3 text-center">
          <div className="inline-flex flex-col items-center gap-0.5">
            <span className="text-base font-black tabular-nums"
              style={{ color: netC ?? (dark ? '#475569' : '#94a3b8') }}>
              {e.netPoints !== null
                ? (e.netPoints > 0 ? `+${e.netPoints}` : e.netPoints)
                : '—'}
            </span>
            {trendDelta !== undefined && <TrendBadge delta={trendDelta ?? null} />}
          </div>
        </td>

        {/* KPI dots summary */}
        <td className="py-2.5 px-3 hidden lg:table-cell">
          <div className="flex items-center gap-1.5 justify-center">
            <KpiDot score={e.qualityScore} />
            <KpiDot score={e.ahtScore} />
            <KpiDot score={e.quizScore} />
            {e.rtScore !== null && <KpiDot score={e.rtScore} />}
          </div>
        </td>

        {/* Incentive */}
        <td className="py-2.5 px-3 text-center hidden lg:table-cell">
          {e.incentiveKd
            ? <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>
                {e.incentiveKd} KD
              </span>
            : <span style={{ color: T.txDash }}>—</span>}
        </td>

        {/* Expand */}
        <td className="py-2.5 px-2 text-center w-8">
          {open
            ? <ChevronDown size={13} style={{ color: dark ? '#475569' : '#94a3b8' }} />
            : <ChevronRight size={13} style={{ color: dark ? '#334155' : '#cbd5e1' }} />}
        </td>
      </tr>

      {/* Expanded KPI detail */}
      {open && (
        <tr style={{ background: T.n15 }}>
          <td colSpan={7} className="pb-4 px-4 pt-1">
            <div className="rounded-2xl p-4"
              style={{
                background: T.glass,
                border: `1px solid ${T.n6}`,
                backdropFilter: 'blur(8px)',
              }}>
              <div className="flex gap-4 text-xs mb-3" style={{ color: dark ? '#475569' : '#94a3b8' }}>
                {e.teamLeader && (
                  <span>TL: <span style={{ color: dark ? '#94a3b8' : '#64748b' }}>{e.teamLeader}</span></span>
                )}
                <span>{ar ? 'الأسبوع' : 'Week'}: <span style={{ color: dark ? '#94a3b8' : '#64748b' }}>{e.weekLabel}</span></span>
                {e.responseRate !== null && (
                  <span>{ar ? 'معدل الرد' : 'Response Rate'}: <span style={{ color: '#818cf8' }}>{pct(e.responseRate)}</span></span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <ScoreChip label="Quality"    actual={pct(e.qualityActual)}         score={e.qualityScore}      dark={dark} />
                <ScoreChip label="AHT"        actual={mins(e.ahtActual)}            score={e.ahtScore}          dark={dark} />
                <ScoreChip label="FCR"        actual={pct(e.fcrActual)}             score={e.fcrScore}          dark={dark} />
                <ScoreChip label="Product."   actual={pct(e.productivityActual)}    score={e.productivityScore} dark={dark} />
                <ScoreChip label="CTR"        actual={pct(e.ctrActual)}             score={e.ctrScore}          dark={dark} />
                <ScoreChip label="Quiz"       actual={pct(e.quizActual)}            score={e.quizScore}         dark={dark} />
                <ScoreChip label="Mistakes"   actual={String(e.mistakesActual ?? '—')} score={e.mistakesScore} dark={dark} />
                {e.rtScore !== null && (
                  <ScoreChip label="Resp.Time" actual={mins(e.rtActual)}            score={e.rtScore}           dark={dark} />
                )}
                {e.incidentsScore !== null && (
                  <ScoreChip label="Incidents" actual={String(e.incidentsActual ?? '—')} score={e.incidentsScore} dark={dark} />
                )}
                {e.prrBonus ? (
                  <ScoreChip label="PRR Bonus" actual={`${((e.prrRate ?? 0) * 100) | 0}%`} score={e.prrBonus} dark={dark} />
                ) : null}
              </div>
              {/* Net score bar */}
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 h-2 rounded-full overflow-hidden"
                  style={{ background: T.n6 }}>
                  <div className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, Math.max(0, ((e.netPoints ?? 0) + 50) / 2))}%`,
                      background: scoreColor(e.netPoints) ?? '#475569',
                    }} />
                </div>
                <span className="text-xs font-bold tabular-nums"
                  style={{ color: scoreColor(e.netPoints) ?? (dark ? '#475569' : '#94a3b8') }}>
                  {e.netPoints !== null ? (e.netPoints > 0 ? `+${e.netPoints}` : e.netPoints) : '—'} pts
                </span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ─── Agent Personal Score View ─────────────────────────────────────────── */
function AgentScoreView({
  entries, myEntry, dark, ar, batches, selectedBatch, onSelectBatch,
}: {
  entries: Entry[]; myEntry: Entry | null; dark: boolean; ar: boolean;
  batches: Batch[]; selectedBatch: Batch | null; onSelectBatch: (b: Batch) => void;
}) {
  const T    = nt(dark);
  const netC = scoreColor(myEntry?.netPoints ?? null);

  if (!myEntry) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-5">
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
          style={{
            background: dark ? 'rgba(129,140,248,0.1)' : 'rgba(129,140,248,0.08)',
            border: '1px solid rgba(129,140,248,0.2)',
          }}>
          <User size={32} style={{ color: '#818cf8' }} />
        </div>
        <div className="text-center">
          <div className="text-base font-semibold"
            style={{ color: dark ? '#475569' : '#94a3b8' }}>
            {ar ? 'لم يتم العثور على بياناتك بعد' : 'Your scorecard is not available yet'}
          </div>
          <div className="text-xs mt-1" style={{ color: dark ? '#334155' : '#cbd5e1' }}>
            {ar ? 'تأكد أن TL رفع بيانات الأداء' : 'Ask your TL to upload the performance scorecard'}
          </div>
        </div>
        {batches.length > 0 && (
          <div className="text-center">
            <div className="text-xs mb-2" style={{ color: dark ? '#475569' : '#94a3b8' }}>
              {ar ? 'الفترات المتاحة:' : 'Available periods:'}
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {batches.map(b => (
                <button key={b.id} onClick={() => onSelectBatch(b)}
                  className={`text-xs px-3 py-1.5 rounded-xl transition-all ${selectedBatch?.id === b.id ? 'ring-1 ring-indigo-500' : ''}`}
                  style={{
                    background: T.n6,
                    color: dark ? '#94a3b8' : '#64748b',
                  }}>
                  {b.periodName}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const kpis = [
    { label: 'Quality',      actual: pct(myEntry.qualityActual),      score: myEntry.qualityScore },
    { label: 'AHT',          actual: mins(myEntry.ahtActual),          score: myEntry.ahtScore },
    { label: 'CTR',          actual: pct(myEntry.ctrActual),           score: myEntry.ctrScore },
    { label: 'Productivity', actual: pct(myEntry.productivityActual),  score: myEntry.productivityScore },
    { label: 'Quiz',         actual: pct(myEntry.quizActual),          score: myEntry.quizScore },
    { label: 'Mistakes',     actual: String(myEntry.mistakesActual ?? '—'), score: myEntry.mistakesScore },
    ...(myEntry.rtScore !== null ? [{ label: 'Resp. Time', actual: mins(myEntry.rtActual), score: myEntry.rtScore }] : []),
    ...(myEntry.incidentsScore !== null ? [{ label: 'Incidents', actual: String(myEntry.incidentsActual ?? '—'), score: myEntry.incidentsScore }] : []),
    ...(myEntry.prrBonus ? [{ label: 'PRR Bonus', actual: `${((myEntry.prrRate ?? 0) * 100) | 0}%`, score: myEntry.prrBonus }] : []),
  ];

  const rankText = myEntry.functionRank !== null
    ? `#${myEntry.functionRank} ${ar ? 'في القسم' : 'in function'}`
    : null;

  const scoreBarWidth = Math.min(100, Math.max(0, ((myEntry.netPoints ?? 0) + 50) / 2));

  return (
    <div className="space-y-6">
      {/* Period selector */}
      {batches.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {batches.map(b => (
            <button key={b.id} onClick={() => onSelectBatch(b)}
              className="text-xs px-3 py-1.5 rounded-xl transition-all"
              style={{
                background: selectedBatch?.id === b.id
                  ? 'rgba(129,140,248,0.15)'
                  : (T.n4),
                color: selectedBatch?.id === b.id ? '#818cf8' : (dark ? '#475569' : '#94a3b8'),
                border: selectedBatch?.id === b.id ? '1px solid rgba(129,140,248,0.3)' : '1px solid transparent',
              }}>
              {b.periodName}
            </button>
          ))}
        </div>
      )}

      {/* Personal hero card */}
      <div className="rounded-3xl p-6 relative overflow-hidden"
        style={{
          background: dark
            ? `linear-gradient(135deg, rgba(15,21,39,0.95), rgba(30,41,59,0.9))`
            : `linear-gradient(135deg, rgba(248,250,252,0.95), rgba(241,245,249,0.9))`,
          border: `1px solid ${netC ? netC + '30' : (T.b8)}`,
          boxShadow: netC ? `0 8px 32px ${netC}20` : undefined,
        }}>
        {/* Decorative glow */}
        {netC && (
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-10 pointer-events-none"
            style={{ background: `radial-gradient(circle, ${netC}, transparent)`, transform: 'translate(30%, -30%)' }} />
        )}

        <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-6">
          {/* Avatar + name */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-black flex-shrink-0"
              style={{
                background: netC ? `${netC}20` : (T.n6),
                border: `2px solid ${netC ? netC + '40' : (T.b10)}`,
                color: netC ?? T.txPri,
              }}>
              {(myEntry.employeeName || '').split(' ').map(w => w[0]).slice(0, 2).join('')}
            </div>
            <div>
              <h2 className="text-lg font-bold"
                style={{ color: tp(dark) }}>
                {myEntry.employeeName}
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: `${fnColor(myEntry.functionName)}18`, color: fnColor(myEntry.functionName) }}>
                  {myEntry.functionName}
                </span>
                {myEntry.teamLeader && (
                  <span className="text-xs" style={{ color: dark ? '#475569' : '#94a3b8' }}>
                    TL: {myEntry.teamLeader}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Score + rank */}
          <div className="flex gap-6 sm:ms-auto">
            <div className="text-center">
              <div className="text-4xl font-black tabular-nums"
                style={{ color: netC ?? (dark ? '#475569' : '#94a3b8') }}>
                {myEntry.netPoints !== null
                  ? (myEntry.netPoints > 0 ? `+${myEntry.netPoints}` : myEntry.netPoints)
                  : '—'}
              </div>
              <div className="text-xs mt-0.5" style={{ color: dark ? '#475569' : '#94a3b8' }}>
                {ar ? 'مجموع النقاط' : 'Net Points'}
              </div>
            </div>
            {myEntry.functionRank !== null && (
              <div className="text-center">
                <div className="text-4xl font-black"
                  style={{ color: T.txPri }}>
                  {medal(myEntry.functionRank) ?? `#${myEntry.functionRank}`}
                </div>
                <div className="text-xs mt-0.5" style={{ color: dark ? '#475569' : '#94a3b8' }}>
                  {ar ? 'ترتيبك في القسم' : 'Function rank'}
                </div>
              </div>
            )}
            {myEntry.incentiveKd ? (
              <div className="text-center">
                <div className="text-2xl font-black" style={{ color: '#fbbf24' }}>
                  🎁 {myEntry.incentiveKd}
                </div>
                <div className="text-xs mt-0.5" style={{ color: dark ? '#475569' : '#94a3b8' }}>KD</div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Score bar */}
        <div className="mt-5 flex items-center gap-3">
          <div className="text-xs" style={{ color: dark ? '#334155' : '#cbd5e1' }}>0</div>
          <div className="flex-1 h-2.5 rounded-full overflow-hidden"
            style={{ background: T.n6 }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${scoreBarWidth}%`,
                background: netC
                  ? `linear-gradient(to right, ${netC}80, ${netC})`
                  : '#475569',
              }} />
          </div>
          <div className="text-xs" style={{ color: dark ? '#334155' : '#cbd5e1' }}>100</div>
        </div>

        <div className="mt-4 flex gap-4 text-xs" style={{ color: dark ? '#475569' : '#94a3b8' }}>
          <span>{ar ? 'أيام العمل:' : 'Working Days:'} <span className="font-semibold" style={{ color: wdBadge(myEntry.workingDaysPct).color }}>{pct(myEntry.workingDaysPct)}</span></span>
          {rankText && <span>{rankText}</span>}
          {selectedBatch && <span>{selectedBatch.periodName}</span>}
        </div>
      </div>

      {/* KPI grid */}
      <div>
        <h3 className="text-sm font-bold mb-3" style={{ color: dark ? '#64748b' : '#94a3b8' }}>
          {ar ? 'تفاصيل مؤشرات الأداء' : 'KPI Breakdown'}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {kpis.map(kpi => {
            const c  = scoreColor(kpi.score);
            const bg = scoreBg(kpi.score, dark);
            return (
              <div key={kpi.label} className="rounded-2xl p-4 flex flex-col gap-2"
                style={{
                  background: bg,
                  border: `1px solid ${c ? c + '25' : (T.n6)}`,
                }}>
                <div className="text-[10px] uppercase tracking-wider font-bold"
                  style={{ color: dark ? '#64748b' : '#94a3b8' }}>
                  {kpi.label}
                </div>
                <div className="text-sm font-medium" style={{ color: dark ? '#94a3b8' : '#64748b' }}>
                  {kpi.actual}
                </div>
                <div className="text-xl font-black"
                  style={{ color: c ?? (dark ? '#475569' : '#94a3b8') }}>
                  {kpi.score !== null ? (kpi.score > 0 ? `+${kpi.score}` : kpi.score) : '—'}
                  <span className="text-xs font-normal ms-1" style={{ color: dark ? '#334155' : '#cbd5e1' }}>pts</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Function leaderboard mini (where do I stand) */}
      {entries.filter(e => e.functionName === myEntry.functionName).length > 1 && (
        <div>
          <h3 className="text-sm font-bold mb-3" style={{ color: dark ? '#64748b' : '#94a3b8' }}>
            {ar ? 'ترتيبك في القسم' : 'Your standing in function'}
          </h3>
          <div className="rounded-2xl overflow-hidden"
            style={{ border: `1px solid ${T.n6}` }}>
            {entries
              .filter(e => e.functionName === myEntry.functionName)
              .slice(0, 8)
              .map((e, i) => {
                const isSelf = e.loginId === myEntry.loginId || e.employeeNo === myEntry.employeeNo;
                const ec = scoreColor(e.netPoints);
                return (
                  <div key={i}
                    className="flex items-center gap-3 px-4 py-2.5"
                    style={{
                      background: isSelf
                        ? (dark ? 'rgba(129,140,248,0.08)' : 'rgba(129,140,248,0.06)')
                        : (i % 2 === 0 ? 'transparent' : (T.n1)),
                      borderBottom: i < 7 ? `1px solid ${T.n4}` : undefined,
                      borderInlineStart: isSelf ? '3px solid #818cf8' : '3px solid transparent',
                    }}>
                    <span className="text-xs w-6 text-center">{medal(e.functionRank) ?? e.functionRank}</span>
                    <span className="flex-1 text-sm font-medium truncate"
                      style={{ color: isSelf ? '#818cf8' : (dark ? '#cbd5e1' : '#334155') }}>
                      {isSelf ? `${ar ? 'أنت' : 'You'} — ${e.employeeName}` : e.employeeName}
                    </span>
                    <span className="text-sm font-black tabular-nums"
                      style={{ color: ec ?? (dark ? '#475569' : '#94a3b8') }}>
                      {e.netPoints !== null ? (e.netPoints > 0 ? `+${e.netPoints}` : e.netPoints) : '—'}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Trend badge ─────────────────────────────────────────────────────────── */
function TrendBadge({ delta }: { delta: number | null }) {
  const { dark } = useUiStore();
  const T = nt(dark);
  if (delta === null) return null;
  if (delta > 0) return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
      <TrendingUp size={7} />+{delta}
    </span>
  );
  if (delta < 0) return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
      <TrendingDown size={7} />{delta}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ background: T.n6, color: '#64748b' }}>
      <Minus size={7} />0
    </span>
  );
}

/* ─── Dashboard Tab ──────────────────────────────────────────────────────── */
function DashboardTab({ batchId, dark, ar }: { batchId: string; dark: boolean; ar: boolean }) {
  const [data, setData]       = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient.get(`/scorecard/batches/${batchId}/dashboard`)
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [batchId]);

  const T         = nt(dark);
  const surface   = T.surface;
  const border    = T.b7;
  const textPri   = T.txPri;
  const textSec   = dark ? '#475569' : '#94a3b8';

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={24} className="animate-spin" style={{ color: textSec }} />
    </div>
  );
  if (!data) return (
    <div className="text-center py-16 text-sm" style={{ color: textSec }}>
      {ar ? 'لا توجد بيانات' : 'No data available'}
    </div>
  );

  const { totals, functionAverages, top3PerFunction, coachingList } = data;
  const passingPct = totals.totalEmployees > 0 ? Math.round(totals.passing / totals.totalEmployees * 100) : 0;
  const passColor  = passingPct >= 70 ? '#22c55e' : passingPct >= 50 ? '#f59e0b' : '#ef4444';

  // Group top3 by function
  const top3ByFn: Record<string, typeof top3PerFunction> = {};
  for (const e of top3PerFunction) {
    const k = e.functionName ?? 'Unknown';
    (top3ByFn[k] = top3ByFn[k] ?? []).push(e);
  }
  const podiumColor: Record<number, string>  = { 1: '#fbbf24', 2: '#94a3b8', 3: '#fb923c' };
  const podiumHeight: Record<number, string> = { 1: '72px', 2: '52px', 3: '40px' };
  const podiumOrder: Record<number, number>  = { 1: 2, 2: 1, 3: 3 };

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: ar ? 'موظفين' : 'Employees',         value: totals.totalEmployees, color: '#818cf8' },
          { label: ar ? 'ناجحون' : 'Passing',            value: totals.passing,        color: '#22c55e' },
          { label: ar ? 'يحتاجون تدريب' : 'Coaching',   value: totals.failing,        color: '#ef4444' },
          { label: ar ? 'متوسط' : 'Avg Pts',             value: (totals.overallAvg > 0 ? '+' : '') + (totals.overallAvg?.toFixed?.(1) ?? 0), color: scoreColor(totals.overallAvg) ?? textSec },
          { label: ar ? 'الأعلى' : 'Highest',            value: (totals.highest > 0 ? '+' : '') + totals.highest, color: '#22c55e' },
          { label: ar ? 'الأدنى' : 'Lowest',             value: totals.lowest,         color: '#ef4444' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-2xl p-4 flex flex-col gap-1"
            style={{ background: `${color}0a`, border: `1px solid ${color}20` }}>
            <span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: textSec }}>{label}</span>
            <span className="text-2xl font-black tabular-nums" style={{ color }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Pass rate bar */}
      <div className="rounded-2xl p-4" style={{ background: surface, border: `1px solid ${border}` }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold" style={{ color: textSec }}>
            {ar ? 'نسبة النجاح العامة' : 'Overall Pass Rate'}
          </span>
          <span className="text-sm font-bold" style={{ color: passColor }}>{passingPct}%</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden" style={{ background: T.n6 }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${passingPct}%`, background: `linear-gradient(90deg, ${passColor}99, ${passColor})` }} />
        </div>
        <div className="flex justify-between mt-1.5 text-[10px]" style={{ color: textSec }}>
          <span>{totals.passing} {ar ? 'ناجح' : 'passing'}</span>
          <span>{totals.failing} {ar ? 'يحتاج تدريب' : 'need coaching'}</span>
        </div>
      </div>

      {/* Function comparison */}
      {functionAverages.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: textSec }}>
            {ar ? 'مقارنة الأقسام' : 'Function Comparison'}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {functionAverages.map(fn => {
              const fc = fnColor(fn.functionName);
              const fnPassPct = fn.empCount > 0 ? Math.round(fn.passingCount / fn.empCount * 100) : 0;
              return (
                <div key={fn.functionName} className="rounded-2xl p-4 space-y-3"
                  style={{ background: `${fc}08`, border: `1px solid ${fc}20` }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold" style={{ color: fc }}>{fn.functionName}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${fc}15`, color: fc }}>
                      {fn.empCount} {ar ? 'موظف' : 'emp'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Avg Pts', value: (fn.avgNetPoints > 0 ? '+' : '') + (fn.avgNetPoints ?? 0), color: scoreColor(fn.avgNetPoints) ?? textSec },
                      { label: 'Quality', value: `${fn.avgQualityPct ?? 0}%`, color: '#818cf8' },
                      { label: 'Avg AHT', value: `${fn.avgAhtMins ?? 0}m`,    color: '#fbbf24' },
                      { label: 'FCR',     value: `${fn.avgFcrPct ?? 0}%`,     color: '#34d399' },
                    ].map(m => (
                      <div key={m.label} className="rounded-xl p-2 text-center"
                        style={{ background: T.innerBg }}>
                        <div className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: textSec }}>{m.label}</div>
                        <div className="text-sm font-bold tabular-nums" style={{ color: m.color }}>{m.value}</div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="flex justify-between text-[9px] mb-1" style={{ color: textSec }}>
                      <span>{ar ? 'نسبة النجاح' : 'Pass rate'}</span>
                      <span style={{ color: fnPassPct >= 70 ? '#22c55e' : '#f59e0b' }}>{fnPassPct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: T.n6 }}>
                      <div className="h-full rounded-full" style={{ width: `${fnPassPct}%`, background: fc }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top 3 podium per function */}
      {Object.keys(top3ByFn).length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: textSec }}>
            {ar ? 'المتصدرون' : 'Top Performers by Function'}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(top3ByFn).map(([fn, performers]) => {
              const fc = fnColor(fn);
              return (
                <div key={fn} className="rounded-2xl p-4" style={{ background: surface, border: `1px solid ${fc}20` }}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full" style={{ background: fc }} />
                    <span className="text-xs font-bold" style={{ color: fc }}>{fn}</span>
                  </div>
                  <div className="flex items-end justify-center gap-2">
                    {[1,2,3].map(rank => {
                      const order = podiumOrder[rank];
                      const p = performers.find(x => x.podiumRank === rank);
                      if (!p) return null;
                      return (
                        <div key={rank} className="flex flex-col items-center gap-1 flex-1"
                          style={{ order }}>
                          <div className="text-center">
                            <div className="text-[10px] font-semibold truncate w-full max-w-[70px] text-center"
                              style={{ color: textPri }}>
                              {p.employeeName?.split(' ').slice(0,2).join(' ')}
                            </div>
                            <div className="text-sm font-black" style={{ color: podiumColor[rank] }}>
                              {p.netPoints !== null ? (p.netPoints > 0 ? `+${p.netPoints}` : p.netPoints) : '—'}
                            </div>
                          </div>
                          <div className="w-full rounded-t-xl flex items-center justify-center text-lg"
                            style={{ height: podiumHeight[rank], background: `${podiumColor[rank]}20`, border: `1px solid ${podiumColor[rank]}30` }}>
                            {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Coaching list */}
      {coachingList.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={14} style={{ color: '#ef4444' }} />
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#ef4444' }}>
              {ar ? 'يحتاجون تدريب' : 'Coaching Needed'} ({coachingList.length})
            </span>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(239,68,68,0.2)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid rgba(239,68,68,0.12)' }}>
                  {[ar ? 'الموظف' : 'Employee', ar ? 'القسم' : 'Function', 'TL', ar ? 'الترتيب' : 'Rank', ar ? 'النقاط' : 'Net Pts', ar ? 'KPIs المنخفضة' : 'Low KPIs'].map((h, i) => (
                    <th key={i} className="py-2 px-3 text-start font-semibold" style={{ color: textSec }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coachingList.map((c, i) => {
                  const fc = fnColor(c.functionName ?? '');
                  const lowKpis = [
                    c.qualityScore !== null && c.qualityScore < 0 && 'Quality',
                    c.ahtScore     !== null && c.ahtScore     < 0 && 'AHT',
                    c.fcrScore     !== null && c.fcrScore     < 0 && 'FCR',
                    c.quizScore    !== null && c.quizScore    < 0 && 'Quiz',
                    c.mistakesScore !== null && c.mistakesScore < 0 && 'Mistakes',
                  ].filter(Boolean) as string[];
                  return (
                    <tr key={i} style={{ borderBottom: i < coachingList.length - 1 ? `1px solid ${border}` : undefined }}>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold" style={{ color: textPri }}>{c.employeeName}</div>
                        <div className="text-[10px]" style={{ color: textSec }}>{c.loginId}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${fc}15`, color: fc }}>
                          {c.functionName}
                        </span>
                      </td>
                      <td className="py-2.5 px-3" style={{ color: textSec }}>{c.teamLeader || '—'}</td>
                      <td className="py-2.5 px-3 text-center" style={{ color: textSec }}>{c.functionRank ?? '—'}</td>
                      <td className="py-2.5 px-3 text-center font-bold" style={{ color: '#ef4444' }}>
                        {c.netPoints !== null ? c.netPoints : '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {lowKpis.length > 0
                            ? lowKpis.map(k => (
                                <span key={k} className="text-[9px] px-1.5 py-0.5 rounded"
                                  style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{k}</span>
                              ))
                            : <span style={{ color: textSec }}>—</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Upload zone ────────────────────────────────────────────────────────── */
function UploadZone({ onPreview, dark, ar }: { onPreview: (file: File) => void; dark: boolean; ar: boolean }) {
  const T = nt(dark);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onPreview(f); }}
      onClick={() => fileRef.current?.click()}
      className="cursor-pointer rounded-3xl border-2 border-dashed p-12 flex flex-col items-center justify-center gap-4 transition-all"
      style={{
        borderColor: drag ? '#818cf8' : (T.b8d),
        background: drag
          ? 'rgba(129,140,248,0.06)'
          : (T.n1b),
      }}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onPreview(f); }} />
      <div className="w-16 h-16 rounded-3xl flex items-center justify-center"
        style={{ background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.2)' }}>
        <Upload size={28} style={{ color: '#818cf8' }} />
      </div>
      <div className="text-center">
        <div className="text-sm font-semibold" style={{ color: T.txPri2 }}>
          {ar ? 'اسحب وأفلت ملف السكوركارد هنا' : 'Drop Scorecard Excel here'}
        </div>
        <div className="text-xs mt-1" style={{ color: dark ? '#475569' : '#94a3b8' }}>
          {ar ? 'يدعم: Feb SC 26 و Feb 26 و Results · ‎.xlsx / .xls' : 'Supports: Feb SC 26, Feb 26, Results · .xlsx / .xls'}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main Page
═══════════════════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════════
   PERFORMANCE ANALYZE — cumulative cross-month: trend, gaps, coaching, interns
════════════════════════════════════════════════════════════════════════ */
function Sparkline({ data, dark }: { data: (number | null)[]; dark: boolean }) {
  const pts = data.filter((v): v is number => v != null);
  if (pts.length < 2) return <span style={{ color: dark ? '#475569' : '#cbd5e1', fontSize: 11 }}>—</span>;
  const min = Math.min(...pts, 0), max = Math.max(...pts, 1), rng = max - min || 1;
  const W = 84, H = 26;
  const step = W / (pts.length - 1);
  const path = pts.map((v, i) => `${i * step},${H - ((v - min) / rng) * H}`).join(' ');
  const up = pts[pts.length - 1] >= pts[0];
  const col = up ? '#10b981' : '#f43f5e';
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <polyline points={path} fill="none" stroke={col} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={(pts.length - 1) * step} cy={H - ((pts[pts.length - 1] - min) / rng) * H} r={2.5} fill={col} />
    </svg>
  );
}

function PerformanceTab({ dark, ar }: { dark: boolean; ar: boolean }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<'trend' | 'latest'>('trend');
  useEffect(() => {
    setLoading(true);
    apiClient.get('/scorecard/analyze')
      .then(({ data }) => setData(data))
      .catch(() => setData({ months: [], employees: [], interns: [], insights: {} }))
      .finally(() => setLoading(false));
  }, []);

  const T = nt(dark);
  const textPri = T.txPri2;
  const textSec = dark ? '#94a3b8' : '#64748b';
  const cardBg = T.cardBg;
  const border = `1px solid ${T.b7}`;
  const rowBg = T.rowBg;

  if (loading) return <div className="text-center py-20" style={{ color: textSec }}>{ar ? 'جارٍ التحليل…' : 'Analyzing…'}</div>;
  const ins = data?.insights || {};
  const months: any[] = data?.months || [];
  if (!months.length) return (
    <div className="text-center py-20 rounded-2xl" style={{ background: cardBg, border }}>
      <TrendingUp size={28} style={{ color: textSec, margin: '0 auto 12px' }} />
      <div style={{ color: textPri, fontWeight: 600 }}>{ar ? 'لا توجد بيانات بعد' : 'No data yet'}</div>
      <div style={{ color: textSec, fontSize: 13, marginTop: 4 }}>{ar ? 'ارفع سكوركارد شهر أو أكثر لرؤية التحليل التراكمي' : 'Upload one or more monthly scorecards to see cumulative analysis'}</div>
    </div>
  );

  const frontline = (data.employees || []).filter((e: any) => !e.intern);
  const sorted = [...frontline].sort((a, b) => sort === 'trend' ? b.trend - a.trend : (b.latestNet ?? -999) - (a.latestNet ?? -999));
  const interns: any[] = data.interns || [];

  const Stat = ({ label, value, color, sub }: any) => (
    <div className="rounded-2xl p-4" style={{ background: cardBg, border }}>
      <div style={{ fontSize: 12, color: textSec, marginBottom: 6 }}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: 26, fontWeight: 800, color: color || textPri, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: textSec, marginTop: 4 }}>{sub}</div>}
    </div>
  );
  const recColor = (r: string) => r === 'Keep' ? '#10b981' : r === 'Let go' ? '#f43f5e' : '#f59e0b';

  return (
    <div className="space-y-5">
      {/* insights */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
        <Stat label={ar ? 'موظفين' : 'Frontline'} value={ins.frontline ?? 0} sub={`${months.length} ${ar ? 'شهر' : 'months'}`} />
        <Stat label={ar ? 'يتحسّنون' : 'Improving'} value={ins.improving ?? 0} color="#10b981" />
        <Stat label={ar ? 'يتراجعون' : 'Declining'} value={ins.declining ?? 0} color="#f43f5e" />
        <Stat label={ar ? 'محتاج كوتشينج' : 'Need coaching'} value={ins.needCoaching ?? 0} color="#f59e0b" />
        <Stat label={ar ? 'انترن للاستغناء' : 'Interns: let go'} value={ins.internLetGo ?? 0} color="#f43f5e" sub={`${ins.internCount ?? 0} ${ar ? 'انترن' : 'interns'}`} />
      </div>

      {/* top movers */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
        {[{ t: ar ? 'الأكثر تحسّناً' : 'Top improvers', d: ins.topImprovers || [], c: '#10b981', up: true },
          { t: ar ? 'الأكثر تراجعاً' : 'Top decliners', d: ins.topDecliners || [], c: '#f43f5e', up: false }].map((blk, i) => (
          <div key={i} className="rounded-2xl p-4" style={{ background: cardBg, border }}>
            <div className="flex items-center gap-1.5 mb-3" style={{ color: blk.c, fontWeight: 700, fontSize: 13 }}>
              {blk.up ? <TrendingUp size={15} /> : <TrendingDown size={15} />}{blk.t}
            </div>
            {blk.d.length ? blk.d.map((e: any, j: number) => (
              <div key={j} className="flex items-center justify-between py-1.5" style={{ borderTop: j ? border : 'none' }}>
                <div><div style={{ color: textPri, fontSize: 13, fontWeight: 600 }}>{e.name}</div><div style={{ color: textSec, fontSize: 11 }}>{e.func}</div></div>
                <span className="tabular-nums" style={{ color: blk.c, fontWeight: 800, fontSize: 14 }}>{e.trend > 0 ? '+' : ''}{e.trend}</span>
              </div>
            )) : <div style={{ color: textSec, fontSize: 12 }}>—</div>}
          </div>
        ))}
      </div>

      {/* employee performance table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: cardBg, border }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: border }}>
          <div style={{ color: textPri, fontWeight: 700 }}>{ar ? 'أداء الموظفين عبر الأشهر' : 'Employee performance across months'}</div>
          <div className="flex gap-1 rounded-lg p-0.5" style={{ background: rowBg }}>
            {[['trend', ar ? 'الاتجاه' : 'Trend'], ['latest', ar ? 'الأحدث' : 'Latest']].map(([k, l]) => (
              <button key={k} onClick={() => setSort(k as any)} className="text-xs px-2.5 py-1 rounded-md"
                style={{ background: sort === k ? (T.sortBg) : 'transparent', color: sort === k ? textPri : textSec, fontWeight: 600 }}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ color: textSec, fontSize: 11, textAlign: ar ? 'right' : 'left' }}>
              <th className="px-4 py-2 font-semibold">{ar ? 'الموظف' : 'Agent'}</th>
              <th className="px-3 py-2 font-semibold">{ar ? 'الاتجاه' : 'Trend'}</th>
              <th className="px-3 py-2 font-semibold text-center">{ar ? 'الأحدث' : 'Latest'}</th>
              <th className="px-3 py-2 font-semibold text-center">{ar ? 'التغيّر' : 'Δ'}</th>
              <th className="px-3 py-2 font-semibold">{ar ? 'نقاط ضعف' : 'Weak KPIs'}</th>
            </tr></thead>
            <tbody>
              {sorted.map((e: any, i: number) => (
                <tr key={i} style={{ borderTop: border, background: e.needsCoaching ? (dark ? 'rgba(245,158,11,0.05)' : 'rgba(245,158,11,0.04)') : 'transparent' }}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span style={{ color: textPri, fontWeight: 600 }}>{e.name}</span>
                      {e.needsCoaching && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontWeight: 600 }}>{ar ? 'كوتشينج' : 'coach'}</span>}
                    </div>
                    <div style={{ color: textSec, fontSize: 11 }}>{e.func}</div>
                  </td>
                  <td className="px-3 py-2.5"><Sparkline data={e.months} dark={dark} /></td>
                  <td className="px-3 py-2.5 text-center tabular-nums" style={{ fontWeight: 800, color: (e.latestNet ?? 0) > 0 ? textPri : '#f43f5e' }}>{e.latestNet ?? '—'}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="tabular-nums" style={{ fontWeight: 700, color: e.trend > 0 ? '#10b981' : e.trend < 0 ? '#f43f5e' : textSec }}>
                      {e.trend > 0 ? '▲ +' : e.trend < 0 ? '▼ ' : '– '}{e.trend !== 0 ? e.trend : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {e.weakKpis?.length ? e.weakKpis.map((k: string) => (
                        <span key={k} className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(244,63,94,0.12)', color: '#f43f5e' }}>{k}</span>
                      )) : <CheckCircle size={14} style={{ color: '#10b981' }} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* coaching plans */}
      {(() => {
        const need = frontline.filter((e: any) => e.needsCoaching);
        if (!need.length) return null;
        return (
          <div className="rounded-2xl p-4" style={{ background: cardBg, border }}>
            <div className="flex items-center gap-1.5 mb-3" style={{ color: '#f59e0b', fontWeight: 700 }}>
              <Star size={15} />{ar ? 'خطط الكوتشينج' : 'Coaching plans'}
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>{need.length}</span>
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
              {need.slice(0, 30).map((e: any, i: number) => (
                <div key={i} className="rounded-xl p-3" style={{ background: rowBg, borderInlineStart: '3px solid #f59e0b' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span style={{ color: textPri, fontWeight: 600, fontSize: 13 }}>{e.name}</span>
                    <span style={{ color: textSec, fontSize: 11 }}>{e.func} · {ar ? 'آخر' : 'latest'} {e.latestNet ?? '—'}</span>
                  </div>
                  {(e.coaching || []).map((c: any, j: number) => (
                    <div key={j} className="mb-2" style={{ paddingInlineStart: 8, borderInlineStart: '2px solid rgba(244,63,94,0.3)' }}>
                      <div style={{ color: '#f43f5e', fontWeight: 600, fontSize: 12 }}>{c.kpi} — {c.issue}</div>
                      <div style={{ color: textPri, fontSize: 12, marginTop: 2 }}>{c.action}</div>
                      <div style={{ color: '#10b981', fontSize: 11, marginTop: 2 }}>🎯 {c.target}</div>
                    </div>
                  ))}
                  {!e.coaching?.length && <div style={{ color: textSec, fontSize: 12 }}>{ar ? 'Net منخفض — مراجعة عامة مع TL' : 'Low Net — general review with TL'}</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* intern review */}
      {interns.length > 0 && (
        <div className="rounded-2xl p-4" style={{ background: cardBg, border }}>
          <div className="flex items-center gap-1.5 mb-3" style={{ color: '#a855f7', fontWeight: 700 }}>
            <Star size={15} />{ar ? 'تقييم الانترن (حضور + سكور)' : 'Intern review (attendance + score)'}
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
            {interns.map((e: any, i: number) => (
              <div key={i} className="rounded-xl p-3" style={{ background: rowBg, borderInlineStart: `3px solid ${recColor(e.recommendation)}` }}>
                <div className="flex items-center justify-between">
                  <span style={{ color: textPri, fontWeight: 600, fontSize: 13 }}>{e.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: recColor(e.recommendation) + '22', color: recColor(e.recommendation), fontWeight: 700 }}>
                    {e.recommendation === 'Keep' ? (ar ? 'إبقاء' : 'Keep') : e.recommendation === 'Let go' ? (ar ? 'استغناء' : 'Let go') : (ar ? 'مراجعة' : 'Review')}
                  </span>
                </div>
                <div style={{ color: textSec, fontSize: 11, marginTop: 4 }}>{e.func}</div>
                <div style={{ color: textSec, fontSize: 11, marginTop: 2 }}>{e.why}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScorecardPage() {
  const { lang, dark } = useUiStore();
  const { user, hasPermission } = useAuthStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const canImport    = hasPermission('scorecard.import');
  // Only evaluate after user is loaded (user !== null prevents false-positive on first render)
  const isAgentView = !!user && !canImport
    && !user.roles.some(r => ['wfm', 'admin', 'platform_admin', 'operations_manager', 'rta', 'team_leader'].includes(r));

  const [tab, setTab] = useState<'batches' | 'upload' | 'results' | 'kpisource' | 'mine' | 'dashboard' | 'performance'>('batches');
  const [batches, setBatches]     = useState<Batch[]>([]);
  const [bLoading, setBLoading]   = useState(false);

  const [previewFile, setPreviewFile]       = useState<File | null>(null);
  const [preview, setPreview]               = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [committing, setCommitting]         = useState(false);
  const [commitDone, setCommitDone]         = useState(false);

  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [entries, setEntries]             = useState<Entry[]>([]);
  const [eLoading, setELoading]           = useState(false);
  const [fnFilter, setFnFilter]           = useState('');
  const [weekFilter, setWeekFilter]       = useState('Final');

  const loadBatches = useCallback(async () => {
    setBLoading(true);
    try {
      const { data } = await apiClient.get('/scorecard/batches');
      setBatches(Array.isArray(data) ? data : []);
    } catch { setBatches([]); }
    setBLoading(false);
  }, []);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  // Once user is confirmed as agent, switch to 'mine' tab and auto-load latest batch
  useEffect(() => {
    if (isAgentView) setTab('mine');
  }, [isAgentView]);

  useEffect(() => {
    if (isAgentView && batches.length > 0 && !selectedBatch) {
      const latest = batches[0];
      setSelectedBatch(latest);
      loadResults(latest, 'Final', '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAgentView, batches]);

  const handlePreview = async (file: File) => {
    setPreviewFile(file); setPreviewLoading(true); setPreview(null);
    const form = new FormData(); form.append('file', file);
    try {
      const { data } = await apiClient.post('/scorecard/upload/preview', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(data); setTab('upload');
    } catch (err: any) { alert(err?.response?.data?.message ?? (ar ? 'فشل التحليل' : 'Parse failed')); }
    setPreviewLoading(false);
  };

  const handleCommit = async () => {
    if (!previewFile) return;
    setCommitting(true);
    const form = new FormData(); form.append('file', previewFile);
    try {
      await apiClient.post('/scorecard/upload/commit', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setCommitDone(true); setPreview(null); setPreviewFile(null);
      await loadBatches();
      setTimeout(() => { setCommitDone(false); setTab('batches'); }, 2000);
    } catch (err: any) { alert(err?.response?.data?.message ?? (ar ? 'فشل الحفظ' : 'Commit failed')); }
    setCommitting(false);
  };

  const loadResults = async (batch: Batch, week = 'Final', fn = '') => {
    setELoading(true); setSelectedBatch(batch); setWeekFilter(week); setFnFilter(fn);
    try {
      const params: any = { week }; if (fn) params.function = fn;
      const { data } = await apiClient.get(`/scorecard/batches/${batch.id}/rankings`, { params });
      setEntries(Array.isArray(data) ? data : []);
      if (!isAgentView) setTab('results');
    } catch { setEntries([]); }
    setELoading(false);
    loadTrends(batch.id, week);
  };

  const deleteBatch = async (b: Batch) => {
    if (!confirm(ar ? `حذف سكوركارد ${b.periodName}؟` : `Delete ${b.periodName} scorecard?`)) return;
    await apiClient.delete(`/scorecard/batches/${b.id}`);
    loadBatches();
    if (selectedBatch?.id === b.id) { setSelectedBatch(null); setEntries([]); setTab('batches'); }
  };

  /* ─── Trend state ────────────────────────────────────────────────────── */
  const [trendMap, setTrendMap] = useState<Record<string, TrendEntry>>({});

  const loadTrends = async (batchId: string, week: string) => {
    if (week !== 'Final') return;
    try {
      const { data } = await apiClient.get(`/scorecard/batches/${batchId}/trends`, { params: { week } });
      const map: Record<string, TrendEntry> = {};
      for (const e of (data.entries ?? [])) { map[e.loginId] = e; }
      setTrendMap(map);
    } catch { setTrendMap({}); }
  };

  const handleExport = async (batch: Batch, week: string) => {
    try {
      const token = localStorage.getItem('accessToken');
      const resp = await fetch(
        `/api/v1/scorecard/batches/${batch.id}/export?week=${encodeURIComponent(week)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!resp.ok) { alert(ar ? 'فشل التصدير' : 'Export failed'); return; }
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `scorecard_${batch.periodName}_${week}.xlsx`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch { alert(ar ? 'فشل التصدير' : 'Export failed'); }
  };

  // KPI Source state
  const [kpiFile, setKpiFile]                     = useState<File | null>(null);
  const [kpiPreview, setKpiPreview]               = useState<any | null>(null);
  const [kpiPreviewLoading, setKpiPreviewLoading] = useState(false);
  const [kpiCommitting, setKpiCommitting]         = useState(false);
  const [kpiDone, setKpiDone]                     = useState(false);
  const [kpiBatches, setKpiBatches]               = useState<any[]>([]);
  const [kpiBLoading, setKpiBLoading]             = useState(false);
  const [kpiViewBatch, setKpiViewBatch]           = useState<any | null>(null);
  const [kpiSummaries, setKpiSummaries]           = useState<any[]>([]);
  const [kpiWeekFilter, setKpiWeekFilter]         = useState('Final');

  const loadKpiBatches = useCallback(async () => {
    setKpiBLoading(true);
    try { const { data } = await apiClient.get('/kpi-source/batches'); setKpiBatches(Array.isArray(data) ? data : []); }
    catch { setKpiBatches([]); }
    setKpiBLoading(false);
  }, []);

  useEffect(() => { loadKpiBatches(); }, [loadKpiBatches]);

  const handleKpiPreview = async (file: File) => {
    setKpiFile(file); setKpiPreviewLoading(true); setKpiPreview(null);
    const form = new FormData(); form.append('file', file);
    try {
      const { data } = await apiClient.post('/kpi-source/upload/preview', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setKpiPreview(data);
    } catch (err: any) { alert(err?.response?.data?.message ?? (ar ? 'فشل التحليل' : 'Parse failed')); }
    setKpiPreviewLoading(false);
  };

  const handleKpiCommit = async () => {
    if (!kpiFile) return;
    setKpiCommitting(true);
    const form = new FormData(); form.append('file', kpiFile);
    try {
      await apiClient.post('/kpi-source/upload/commit', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setKpiDone(true); setKpiPreview(null); setKpiFile(null);
      await loadKpiBatches();
      setTimeout(() => setKpiDone(false), 3000);
    } catch (err: any) { alert(err?.response?.data?.message ?? (ar ? 'فشل الحفظ' : 'Commit failed')); }
    setKpiCommitting(false);
  };

  const loadKpiSummaries = async (batch: any, week = 'Final') => {
    setKpiViewBatch(batch); setKpiWeekFilter(week);
    try {
      const { data } = await apiClient.get(`/kpi-source/batches/${batch.id}/summaries`, { params: { week } });
      setKpiSummaries(Array.isArray(data) ? data : []);
    } catch { setKpiSummaries([]); }
  };

  /* ─── Derived ─────────────────────────────────────────────────────────── */
  const allFunctions = [...new Set(entries.map(e => e.functionName).filter(Boolean))];
  const filtered     = fnFilter ? entries.filter(e => e.functionName === fnFilter) : entries;
  const byFn: Record<string, Entry[]> = {};
  for (const e of filtered) { const k = e.functionName ?? 'Unknown'; (byFn[k] = byFn[k] ?? []).push(e); }

  // Agent self-identification
  const myEntry = isAgentView
    ? entries.find(e =>
        e.loginId === user?.email ||
        e.employeeNo === user?.employee?.employeeNo ||
        e.loginId?.toLowerCase() === user?.email?.toLowerCase(),
      ) ?? null
    : null;

  /* ─── Stats overview ─────────────────────────────────────────────────── */
  const avgPts = entries.length
    ? Math.round(entries.filter(e => e.netPoints !== null).reduce((s, e) => s + (e.netPoints ?? 0), 0)
        / Math.max(1, entries.filter(e => e.netPoints !== null).length))
    : null;
  const topPts  = entries.length ? Math.max(...entries.map(e => e.netPoints ?? -999)) : null;
  const withInc = entries.filter(e => e.incentiveKd).length;

  /* ─── Theming helpers ─────────────────────────────────────────────────── */
  const T         = nt(dark);
  const surface   = T.surface;
  const border    = T.b7;
  const textPri   = T.txPri;
  const textSec   = dark ? '#475569' : '#94a3b8';
  const textMuted = dark ? '#334155' : '#cbd5e1';
  const tabActive = T.n8c;
  const tabText   = T.txPri2;
  const tabMuted  = dark ? '#475569' : '#94a3b8';
  const filterBg  = T.n4;

  /* ─── Tabs definition ─────────────────────────────────────────────────── */
  const tabs: Array<{ id: string; label: string; icon: any }> = [
    ...(isAgentView ? [{ id: 'mine', label: ar ? 'أدائي' : 'My Score', icon: Star }] : []),
    ...(!isAgentView ? [{ id: 'batches', label: ar ? 'الفترات' : 'Periods', icon: BarChart2 }] : []),
    ...(canImport    ? [{ id: 'upload',  label: ar ? 'رفع ملف' : 'Upload',  icon: Upload    }] : []),
    ...(canImport    ? [{ id: 'kpisource', label: ar ? 'بيانات KPI' : 'KPI Source', icon: Database }] : []),
    ...(selectedBatch && !isAgentView ? [{ id: 'dashboard', label: ar ? 'الملخص' : 'Dashboard', icon: LayoutDashboard }] : []),
    ...(selectedBatch && !isAgentView ? [{ id: 'results',   label: ar ? 'النتائج' : 'Results',   icon: Trophy          }] : []),
    ...(!isAgentView ? [{ id: 'performance', label: ar ? 'تحليل الأداء' : 'Performance', icon: TrendingUp }] : []),
  ];

  /* ════════════════════════════════════════════════════════════════════════
     Render
  ════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.2)' }}>
            <Trophy size={18} style={{ color: '#fbbf24' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: textPri }}>
              {ar ? 'لوحة الأداء' : 'Scorecard'}
            </h1>
            <div className="text-[11px]" style={{ color: textMuted }}>
              {ar ? 'السكوركارد الرسمي — نقاط صافية (من الجداول المعتمدة)' : 'Official scorecard — Net Points (scorecard_monthly + batch entries)'}
            </div>
            {selectedBatch && (tab === 'results' || tab === 'mine') && (
              <div className="text-xs" style={{ color: textSec }}>
                {selectedBatch.periodName}
                {fnFilter && <span style={{ color: fnColor(fnFilter) }}> · {fnFilter}</span>}
                <span style={{ color: textMuted }}> · {weekFilter}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectedBatch && (tab === 'results' || tab === 'dashboard') && (
            <button
              onClick={() => handleExport(selectedBatch, weekFilter)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
              style={{ background: 'rgba(129,140,248,0.1)', color: '#818cf8', border: '1px solid rgba(129,140,248,0.2)' }}>
              <Download size={12} />{ar ? 'تصدير' : 'Export'}
            </button>
          )}
          <div className="flex gap-1 rounded-xl p-1" style={{ background: filterBg }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id as any)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
                style={{
                  background: tab === t.id ? tabActive : 'transparent',
                  color: tab === t.id ? tabText : tabMuted,
                }}>
                <t.icon size={12} />{t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ══ DASHBOARD ════════════════════════════════════════════════════ */}
      {tab === 'dashboard' && selectedBatch && (
        <DashboardTab batchId={selectedBatch.id} dark={dark} ar={ar} />
      )}

      {/* ══ PERFORMANCE ANALYZE (cumulative across months) ════════════════ */}
      {tab === 'performance' && (
        <PerformanceTab dark={dark} ar={ar} />
      )}

      {/* ══ MY SCORE (agent self-view) ════════════════════════════════════ */}
      {tab === 'mine' && (
        <div>
          {eLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 size={24} className="animate-spin" style={{ color: textSec }} />
            </div>
          ) : (
            <AgentScoreView
              entries={entries}
              myEntry={myEntry}
              dark={dark}
              ar={ar}
              batches={batches}
              selectedBatch={selectedBatch}
              onSelectBatch={b => { setSelectedBatch(b); loadResults(b, 'Final', ''); }}
            />
          )}
        </div>
      )}

      {/* ══ BATCHES ══════════════════════════════════════════════════════ */}
      {tab === 'batches' && (
        <div>
          {bLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 size={24} className="animate-spin" style={{ color: textSec }} />
            </div>
          ) : batches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-5">
              <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
                style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.12)' }}>
                <Trophy size={32} style={{ color: 'rgba(251,191,36,0.35)' }} />
              </div>
              <div className="text-center">
                <div className="text-base font-semibold" style={{ color: textSec }}>
                  {ar ? 'لا توجد فترات مرفوعة بعد' : 'No scorecard periods yet'}
                </div>
                <div className="text-xs mt-1" style={{ color: textMuted }}>
                  {ar ? 'ارفع ملف الاكسل لتبدأ' : 'Upload your Excel workbook to get started'}
                </div>
              </div>
              {canImport && (
                <button onClick={() => setTab('upload')}
                  className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl font-medium transition-all hover:scale-[1.02]"
                  style={{ background: 'rgba(129,140,248,0.12)', border: '1px solid rgba(129,140,248,0.2)', color: '#818cf8' }}>
                  <Upload size={14} /> {ar ? 'رفع ملف' : 'Upload Scorecard'}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {batches.map(b => (
                  <div key={b.id} className="rounded-2xl p-5 flex flex-col gap-3"
                    style={{ background: surface, border: `1px solid ${border}` }}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-base font-bold" style={{ color: textPri }}>{b.periodName}</div>
                        <div className="text-[10px] mt-0.5" style={{ color: textSec }}>
                          {new Date(b.uploadedAt).toLocaleDateString()} · {b.uploadedByName ?? 'system'}
                        </div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0"
                        style={{ background: 'rgba(52,211,153,0.1)', color: '#34d399' }}>{b.status}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: ar ? 'موظف' : 'Employees',          value: b.totalEmployees, color: '#818cf8' },
                        { label: ar ? 'نتيجة نهائية' : 'Final Entries', value: b.finalCount,    color: '#fbbf24' },
                      ].map(s => (
                        <div key={s.label} className="rounded-xl p-2.5 text-center"
                          style={{ background: `${s.color}0c` }}>
                          <div className="text-lg font-black" style={{ color: s.color }}>{s.value}</div>
                          <div className="text-[9px] uppercase tracking-wide" style={{ color: textSec }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => loadResults(b, 'Final', '')}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl font-medium transition-all hover:scale-[1.01]"
                        style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.15)', color: '#fbbf24' }}>
                        <Eye size={12} /> {ar ? 'عرض' : 'View Results'}
                      </button>
                      {canImport && (
                        <button onClick={() => deleteBatch(b)}
                          className="p-2 rounded-xl transition-all hover:bg-red-500/10" style={{ color: textSec }}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {canImport && <div className="mt-6"><UploadZone onPreview={handlePreview} dark={dark} ar={ar} /></div>}
            </>
          )}
        </div>
      )}

      {/* ══ UPLOAD ═══════════════════════════════════════════════════════ */}
      {tab === 'upload' && (
        <div className="max-w-2xl mx-auto">
          {commitDone ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
                style={{ background: 'rgba(52,211,153,0.12)' }}>
                <CheckCircle size={36} style={{ color: '#34d399' }} />
              </div>
              <div className="text-lg font-bold" style={{ color: '#34d399' }}>
                {ar ? 'تم الرفع بنجاح' : 'Uploaded successfully!'}
              </div>
            </div>
          ) : preview ? (
            <div className="rounded-3xl p-6 space-y-5"
              style={{ background: surface, border: '1px solid rgba(129,140,248,0.2)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold" style={{ color: textPri }}>{preview.periodName}</h2>
                  <p className="text-xs mt-1" style={{ color: textSec }}>
                    {preview.totalEmployees} {ar ? 'موظف' : 'employees'} · {preview.totalEntries} {ar ? 'صف' : 'rows'}
                  </p>
                </div>
                <button onClick={() => { setPreview(null); setPreviewFile(null); }}
                  className="p-1.5 rounded-lg" style={{ color: textSec }}>
                  <X size={14} />
                </button>
              </div>
              <div>
                <div className="text-xs font-semibold mb-2" style={{ color: textSec }}>
                  {ar ? 'الأقسام المكتشفة' : 'Functions detected'}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {preview.functions.map(f => (
                    <span key={f} className="text-xs px-2.5 py-0.5 rounded-full"
                      style={{ background: `${fnColor(f)}15`, color: fnColor(f) }}>{f}</span>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold mb-2" style={{ color: textSec }}>
                  {ar ? 'عينة' : 'Sample'} ({Math.min(5, preview.sampleRows.length)})
                </div>
                <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${border}` }}>
                  {preview.sampleRows.slice(0, 5).map((r: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2"
                      style={{ borderBottom: i < 4 ? `1px solid ${border}` : undefined }}>
                      <span className="text-xs font-semibold w-28 truncate" style={{ color: textPri }}>{r.employeeName}</span>
                      <span className="text-[10px] w-20 truncate" style={{ color: fnColor(r.functionName) }}>{r.functionName}</span>
                      <span className="text-[10px] w-10" style={{ color: textSec }}>{r.weekLabel}</span>
                      <span className="text-xs font-bold tabular-nums ms-auto"
                        style={{ color: scoreColor(r.netPoints) ?? textSec }}>{r.netPoints ?? '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={handleCommit} disabled={committing}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all hover:scale-[1.01]"
                  style={{ background: 'rgba(129,140,248,0.15)', border: '1px solid rgba(129,140,248,0.3)', color: '#818cf8' }}>
                  {committing
                    ? <><Loader2 size={14} className="animate-spin" />{ar ? 'جاري الحفظ...' : 'Saving...'}</>
                    : <><CheckCircle size={14} />{ar ? 'تأكيد وحفظ' : 'Confirm & Save'}</>}
                </button>
                <button onClick={() => { setPreview(null); setPreviewFile(null); }}
                  className="px-4 py-3 rounded-2xl text-sm" style={{ color: textSec }}>
                  {ar ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </div>
          ) : previewLoading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <Loader2 size={32} className="animate-spin" style={{ color: '#818cf8' }} />
              <div className="text-sm" style={{ color: textSec }}>
                {ar ? 'جاري التحليل...' : 'Parsing scorecard...'}
              </div>
            </div>
          ) : (
            <>
              <UploadZone onPreview={handlePreview} dark={dark} ar={ar} />
              <div className="mt-5 rounded-2xl p-4 space-y-2"
                style={{ background: surface, border: `1px solid ${border}` }}>
                <div className="text-xs font-semibold" style={{ color: textSec }}>{ar ? 'صيغ الأوراق المدعومة' : 'Supported sheet formats'}</div>
                {[
                  ['Feb SC 26', ar ? 'الورقة الرئيسية (العناوين في الصف 13)' : 'Main sheet (headers at row 13)'],
                  ['Feb 26 / Results', ar ? 'عرض مبسّط (العناوين في الصف 1)' : 'Simplified view (headers at row 1)'],
                  ['Any month name', ar ? 'يُكتشف الشهر تلقائياً' : 'Auto-detected period'],
                ].map(([n, d]) => (
                  <div key={n} className="flex items-start gap-2">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                      style={{ background: 'rgba(129,140,248,0.1)', color: '#818cf8' }}>{n}</span>
                    <span className="text-[10px]" style={{ color: textSec }}>{d}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ══ KPI SOURCE ══════════════════════════════════════════════════ */}
      {tab === 'kpisource' && (
        <div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left: upload */}
            <div className="lg:col-span-5 space-y-4">
              <div className="rounded-3xl p-5 space-y-4"
                style={{ background: surface, border: `1px solid ${border}` }}>
                <div>
                  <h2 className="text-base font-bold" style={{ color: textPri }}>
                    {ar ? 'رفع بيانات الأداء' : 'Upload Agent Performance Data'}
                  </h2>
                  <p className="text-xs mt-1" style={{ color: textSec }}>
                    {ar
                      ? 'رفع ملف يحتوي على تاريخ، اسم الموظف، AHT، Response Time، عدد الكونتاكت'
                      : 'Upload a file containing: date, agent name, AHT, response time, contact count.'}
                  </p>
                </div>

                {kpiDone ? (
                  <div className="flex flex-col items-center py-10 gap-3">
                    <div className="w-16 h-16 rounded-3xl flex items-center justify-center"
                      style={{ background: 'rgba(52,211,153,0.12)' }}>
                      <CheckCircle size={28} style={{ color: '#34d399' }} />
                    </div>
                    <div className="text-sm font-bold" style={{ color: '#34d399' }}>
                      {ar ? 'تم الحفظ بنجاح' : 'Saved successfully!'}
                    </div>
                  </div>
                ) : kpiPreview ? (
                  <div className="space-y-3">
                    <div className="rounded-2xl p-3 space-y-2"
                      style={{ background: 'rgba(129,140,248,0.06)', border: '1px solid rgba(129,140,248,0.15)' }}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold" style={{ color: textPri }}>{kpiPreview.periodName}</span>
                        <button onClick={() => { setKpiPreview(null); setKpiFile(null); }}
                          className="p-1 rounded" style={{ color: textSec }}>
                          <X size={13} />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs" style={{ color: textSec }}>
                        <span>{kpiPreview.totalRows} {ar ? 'صف' : 'rows'}</span>
                        <span>{kpiPreview.totalAgents} {ar ? 'موظف' : 'agents'}</span>
                        <span className="px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24' }}>
                          {kpiPreview.channelType}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {kpiPreview.functions?.map((f: string) => (
                          <span key={f} className="text-[10px] px-2 py-0.5 rounded-full"
                            style={{ background: `${fnColor(f)}15`, color: fnColor(f) }}>{f}</span>
                        ))}
                      </div>
                    </div>

                    {kpiPreview.sampleRows?.length > 0 && (
                      <div className="rounded-xl overflow-hidden text-xs"
                        style={{ border: `1px solid ${border}` }}>
                        <div className="grid grid-cols-4 px-3 py-1.5 text-[9px] uppercase tracking-wide font-semibold"
                          style={{ color: textSec, borderBottom: `1px solid ${border}` }}>
                          <span>{ar ? 'الموظف' : 'Agent'}</span><span>{ar ? 'الأسبوع' : 'Week'}</span><span>{ar ? 'التواصلات' : 'Contacts'}</span><span>{ar ? 'متوسط AHT' : 'Avg AHT'}</span>
                        </div>
                        {kpiPreview.sampleRows.slice(0, 6).map((r: any, i: number) => (
                          <div key={i} className="grid grid-cols-4 px-3 py-2"
                            style={{ borderBottom: i < 5 ? `1px solid ${border}` : undefined }}>
                            <span className="truncate font-medium" style={{ color: textPri }}>{r.agentName || r.agentLogin || '—'}</span>
                            <span style={{ color: '#fbbf24' }}>{r.weekLabel}</span>
                            <span style={{ color: dark ? '#94a3b8' : '#64748b' }}>{r.totalContacts ?? '—'}</span>
                            <span style={{ color: '#34d399' }}>
                              {r.avgAhtSeconds ? `${Math.round(r.avgAhtSeconds)}s` : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <button onClick={handleKpiCommit} disabled={kpiCommitting}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all"
                      style={{ background: 'rgba(129,140,248,0.15)', border: '1px solid rgba(129,140,248,0.3)', color: '#818cf8' }}>
                      {kpiCommitting
                        ? <><Loader2 size={14} className="animate-spin" />{ar ? 'جاري الحفظ...' : 'Saving...'}</>
                        : <><CheckCircle size={14} />{ar ? 'تأكيد وحفظ' : 'Confirm & Save'}</>}
                    </button>
                  </div>
                ) : kpiPreviewLoading ? (
                  <div className="flex flex-col items-center py-12 gap-3">
                    <Loader2 size={28} className="animate-spin" style={{ color: '#818cf8' }} />
                    <div className="text-sm" style={{ color: textSec }}>
                      {ar ? 'جاري التحليل...' : 'Detecting columns & aggregating weeks...'}
                    </div>
                  </div>
                ) : (
                  <div
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleKpiPreview(f); }}
                    onClick={() => document.getElementById('kpi-file-input')?.click()}
                    className="cursor-pointer rounded-3xl border-2 border-dashed p-10 flex flex-col items-center gap-3 transition-all"
                    style={{
                      borderColor: T.b8d,
                      background: T.n1b,
                    }}>
                    <input id="kpi-file-input" type="file" accept=".xlsx,.xls,.csv" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleKpiPreview(f); }} />
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                      style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)' }}>
                      <Database size={24} style={{ color: '#34d399' }} />
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-semibold" style={{ color: textPri }}>
                        {ar ? 'اسحب وأفلت ملف الأداء' : 'Drop agent performance file here'}
                      </div>
                      <div className="text-xs mt-1" style={{ color: textSec }}>
                        {ar ? '‎.xlsx / .xls — يكتشف تلقائياً: التاريخ، الموظف، AHT، وقت الرد' : '.xlsx / .xls — Auto-detects: date, agent, AHT, response time'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: existing batches + summaries */}
            <div className="lg:col-span-7 space-y-4">
              <div className="rounded-2xl p-4" style={{ background: surface, border: `1px solid ${border}` }}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: textSec }}>
                    {ar ? 'الملفات المرفوعة' : 'Uploaded Batches'}
                  </span>
                  <button onClick={loadKpiBatches} className="p-1 rounded" style={{ color: textSec }}>
                    <RefreshCw size={12} className={kpiBLoading ? 'animate-spin' : ''} />
                  </button>
                </div>

                {kpiBLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 size={20} className="animate-spin" style={{ color: textSec }} />
                  </div>
                ) : kpiBatches.length === 0 ? (
                  <div className="text-center py-8 text-sm" style={{ color: textMuted }}>
                    {ar ? 'لا توجد بيانات مرفوعة بعد' : 'No uploads yet'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {kpiBatches.map((b: any) => (
                      <div key={b.id} className="rounded-xl px-3 py-2.5 flex items-center gap-3"
                        style={{
                          background: kpiViewBatch?.id === b.id ? 'rgba(52,211,153,0.06)' : surface,
                          border: `1px solid ${kpiViewBatch?.id === b.id ? 'rgba(52,211,153,0.2)' : border}`,
                        }}>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate" style={{ color: textPri }}>{b.period_name}</div>
                          <div className="text-[10px]" style={{ color: textSec }}>
                            {b.total_agents} agents · {b.total_rows} rows · {b.channel_type}
                            {' · '}{new Date(b.uploaded_at).toLocaleDateString()}
                          </div>
                        </div>
                        <button onClick={() => loadKpiSummaries(b, 'Final')}
                          className="text-xs px-2.5 py-1 rounded-lg flex items-center gap-1 transition-all"
                          style={{ background: 'rgba(52,211,153,0.1)', color: '#34d399', border: '1px solid rgba(52,211,153,0.2)' }}>
                          <Eye size={11} /> {ar ? 'عرض' : 'View'}
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(ar ? `حذف ${b.period_name}؟` : `Delete ${b.period_name}?`)) return;
                            await apiClient.delete(`/kpi-source/batches/${b.id}`);
                            loadKpiBatches();
                            if (kpiViewBatch?.id === b.id) { setKpiViewBatch(null); setKpiSummaries([]); }
                          }}
                          className="p-1.5 rounded-lg hover:bg-red-500/10" style={{ color: textSec }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {kpiViewBatch && (
                <div className="rounded-2xl p-4"
                  style={{ background: surface, border: '1px solid rgba(52,211,153,0.15)' }}>
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <span className="text-sm font-semibold" style={{ color: '#34d399' }}>
                      {kpiViewBatch.period_name}
                    </span>
                    <div className="flex gap-1">
                      {['W1','W2','W3','W4','Final'].map(w => (
                        <button key={w} onClick={() => loadKpiSummaries(kpiViewBatch, w)}
                          className="text-xs px-2.5 py-1 rounded-lg transition-all"
                          style={{
                            background: kpiWeekFilter === w ? 'rgba(52,211,153,0.15)' : filterBg,
                            color: kpiWeekFilter === w ? '#34d399' : textSec,
                          }}>
                          {w}
                        </button>
                      ))}
                    </div>
                  </div>

                  {kpiSummaries.length === 0 ? (
                    <div className="text-center py-8 text-sm" style={{ color: textMuted }}>{ar ? 'لا توجد بيانات' : 'No data'}</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${border}` }}>
                            {[ar ? 'الموظف' : 'Agent', ar ? 'القسم' : 'Function', ar ? 'أيام' : 'Days', ar ? 'تواصلات' : 'Contacts', ar ? 'تسجيل (س)' : 'Login (h)', ar ? 'متوسط AHT' : 'Avg AHT', ar ? 'متوسط RT' : 'Avg RT'].map(h => (
                              <th key={h} className="px-2 py-2 text-start font-semibold" style={{ color: textSec }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {kpiSummaries.map((r: any, i: number) => (
                            <tr key={i} style={{ borderBottom: `1px solid ${border}` }}>
                              <td className="px-2 py-2 font-medium max-w-[120px] truncate" style={{ color: textPri }}>
                                {r.agent_name || r.agent_login}
                              </td>
                              <td className="px-2 py-2 max-w-[100px] truncate" style={{ color: fnColor(r.function_name) }}>
                                {r.function_name || '—'}
                              </td>
                              <td className="px-2 py-2 text-center" style={{ color: dark ? '#94a3b8' : '#64748b' }}>{r.working_days}</td>
                              <td className="px-2 py-2 text-center font-semibold" style={{ color: '#818cf8' }}>
                                {r.total_contacts?.toLocaleString() ?? '—'}
                              </td>
                              <td className="px-2 py-2 text-center" style={{ color: dark ? '#94a3b8' : '#64748b' }}>
                                {r.total_login_minutes ? `${Math.round(r.total_login_minutes / 60)}h` : '—'}
                              </td>
                              <td className="px-2 py-2 text-center font-mono" style={{ color: '#34d399' }}>
                                {r.avg_aht_seconds ? `${Math.round(r.avg_aht_seconds)}s` : '—'}
                              </td>
                              <td className="px-2 py-2 text-center font-mono" style={{ color: '#fbbf24' }}>
                                {r.avg_response_seconds ? `${Math.round(r.avg_response_seconds)}s` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ RESULTS ══════════════════════════════════════════════════════ */}
      {tab === 'results' && selectedBatch && (
        <div>
          {/* Stats overview */}
          {entries.length > 0 && !eLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {[
                { label: ar ? 'موظفين' : 'Employees',     value: filtered.length,         icon: User,       color: '#818cf8' },
                { label: ar ? 'متوسط النقاط' : 'Avg Score', value: avgPts !== null ? (avgPts > 0 ? `+${avgPts}` : avgPts) : '—', icon: Target, color: scoreColor(avgPts) ?? '#475569' },
                { label: ar ? 'أعلى نقطة' : 'Top Score',   value: topPts !== null ? (topPts > 0 ? `+${topPts}` : topPts) : '—', icon: TrendingUp, color: '#22c55e' },
                { label: ar ? 'حاصلين على مكافأة' : 'Earning Incentive', value: withInc, icon: Gift, color: '#fbbf24' },
              ].map(s => (
                <div key={s.label} className="rounded-2xl p-4 flex items-center gap-3"
                  style={{ background: surface, border: `1px solid ${border}` }}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${s.color}15` }}>
                    <s.icon size={16} style={{ color: s.color }} />
                  </div>
                  <div>
                    <div className="text-lg font-black tabular-nums" style={{ color: s.color }}>{s.value}</div>
                    <div className="text-[10px]" style={{ color: textSec }}>{s.label}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Filter bar */}
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <div className="flex flex-wrap gap-1.5">
              {['', ...allFunctions].map(fn => (
                <button key={fn || '__all__'}
                  onClick={() => loadResults(selectedBatch, weekFilter, fn)}
                  className="text-xs px-3 py-1.5 rounded-full transition-all"
                  style={{
                    background: fnFilter === fn
                      ? (fn ? `${fnColor(fn)}18` : (T.n10c))
                      : filterBg,
                    color: fnFilter === fn ? (fn ? fnColor(fn) : textPri) : textSec,
                    border: `1px solid ${fnFilter === fn ? (fn ? fnColor(fn) + '40' : border) : 'transparent'}`,
                  }}>
                  {fn || (ar ? 'الكل' : 'All')}
                </button>
              ))}
            </div>
            <div className="ms-auto flex gap-1">
              {['W1','W2','W3','W4','Final'].map(w => (
                <button key={w} onClick={() => loadResults(selectedBatch, w, fnFilter)}
                  className="text-xs px-2.5 py-1 rounded-lg transition-all"
                  style={{
                    background: weekFilter === w ? 'rgba(251,191,36,0.15)' : filterBg,
                    color: weekFilter === w ? '#fbbf24' : textSec,
                  }}>
                  {w}
                </button>
              ))}
            </div>
            <button onClick={() => loadResults(selectedBatch, weekFilter, fnFilter)}
              className="p-1.5 rounded-lg" style={{ color: textSec }}>
              <RefreshCw size={13} />
            </button>
          </div>

          {eLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin" style={{ color: textSec }} />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-16 text-sm" style={{ color: textMuted }}>
              {ar ? 'لا توجد بيانات' : 'No data for selected filters'}
            </div>
          ) : (
            <div className="space-y-8">
              {Object.entries(byFn).map(([fn, fnEntries]) => {
                const fc      = fnColor(fn);
                const top3    = fnEntries.filter(e => e.functionRank !== null && e.functionRank <= 3 && weekFilter === 'Final' && (e.netPoints ?? 0) > 0);
                const fnTotal = fnEntries.length;
                const fnAvg   = fnEntries.filter(e => e.netPoints !== null).length
                  ? Math.round(fnEntries.reduce((s, e) => s + (e.netPoints ?? 0), 0) / Math.max(1, fnEntries.filter(e => e.netPoints !== null).length))
                  : null;

                return (
                  <div key={fn}>
                    {/* Function header */}
                    <div className="flex items-center gap-3 mb-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: fc, boxShadow: `0 0 6px ${fc}60` }} />
                        <span className="text-base font-bold" style={{ color: fc }}>{fn}</span>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: `${fc}10`, color: fc }}>
                        {fnTotal} {ar ? 'موظف' : 'employees'}
                      </span>
                      {fnAvg !== null && (
                        <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: scoreBg(fnAvg, dark), color: scoreColor(fnAvg) ?? textSec }}>
                          {ar ? 'المتوسط' : 'avg'}: {fnAvg > 0 ? `+${fnAvg}` : fnAvg}
                        </span>
                      )}
                    </div>

                    {/* Podium — only Final week, only if top 3 exist */}
                    {top3.length >= 2 && (
                      <div className="mb-4 rounded-2xl p-5 flex justify-center gap-6"
                        style={{
                          background: dark
                            ? `linear-gradient(135deg, rgba(15,21,39,0.6), ${fc}08)`
                            : `linear-gradient(135deg, rgba(248,250,252,0.8), ${fc}06)`,
                          border: `1px solid ${fc}18`,
                        }}>
                        {top3
                          .sort((a, b) => (a.functionRank ?? 99) - (b.functionRank ?? 99))
                          .map(e => <PodiumCard key={e.loginId} entry={e} dark={dark} />)}
                      </div>
                    )}

                    {/* Table */}
                    <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${fc}18` }}>
                      <table className="w-full">
                        <thead>
                          <tr style={{ background: `${fc}08`, borderBottom: `1px solid ${fc}12` }}>
                            {[
                              { label: ar ? 'ترتيب' : '#',          cls: 'text-center w-10' },
                              { label: ar ? 'الموظف' : 'Employee',  cls: '' },
                              { label: 'WD%',                        cls: 'text-center hidden md:table-cell' },
                              { label: ar ? 'النقاط' : 'Net Pts',   cls: 'text-center' },
                              { label: 'KPIs',                       cls: 'text-center hidden lg:table-cell' },
                              { label: ar ? 'جائزة' : 'Incentive',  cls: 'text-center hidden lg:table-cell' },
                              { label: '',                            cls: 'w-8' },
                            ].map((h, i) => (
                              <th key={i}
                                className={`py-2 px-3 text-[10px] uppercase tracking-wide font-semibold ${h.cls}`}
                                style={{ color: textSec }}>
                                {h.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody style={{ borderTop: `1px solid ${fc}08` }}>
                          {fnEntries.map((e, i) => (
                            <EmployeeRow
                              key={`${e.loginId}-${e.weekLabel}-${i}`}
                              e={e} ar={ar} dark={dark}
                              trendDelta={trendMap[e.loginId ?? '']?.delta}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
