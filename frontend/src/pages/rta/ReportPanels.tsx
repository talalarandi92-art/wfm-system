import {
  useState, useEffect, useMemo,
} from 'react';
import {
  RefreshCw, Loader2, TrendingUp, BarChart3, Activity, Shield, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { tp, ts as tsColor } from '@/components/ds';
import {
  DailyReport, ContactForecast, AdherenceReport, IntradayData, ViolationsReport,
  fmtMin, fmtTime,
} from './types';

// Theme-aware neutral tokens (recipe of dd234d7) — semantic status colors stay fixed
const tok = (dark: boolean) => ({
  panel:   dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
  bdr:     dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.10)',
  overlay: dark ? 'rgba(0,0,0,0.75)'       : 'rgba(15,23,42,0.45)',
  faint:   dark ? '#475569'                : '#94a3b8',
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  DAILY REPORT + FORECAST PANEL                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function downloadCsv(path: string, filename: string) {
  try {
    const { data } = await apiClient.get(path, { responseType: 'blob' });
    const url = URL.createObjectURL(data as Blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  } catch { /* non-fatal */ }
}

const fmtSec = (s: string | number | null) => {
  const n = s == null ? null : +s;
  if (n == null || isNaN(n) || n <= 0) return '—';
  if (n < 60) return `${Math.round(n)}s`;
  return `${Math.floor(n / 60)}m ${Math.round(n % 60)}s`;
};

export function DailyReportPanel({ report, forecast, ar, from, to, onRange, onRefresh, refreshing }: {
  report: DailyReport | null; forecast: ContactForecast | null; ar: boolean;
  from: string; to: string;
  onRange: (from: string, to: string) => void;
  onRefresh: () => void; refreshing: boolean;
}) {
  const { dark } = useUiStore();
  const T = tok(dark);
  const rows = report?.rows ?? [];
  const dates = useMemo(() => [...new Set(rows.map(r => String(r.stat_date).slice(0, 10)))], [rows]);
  const maxFc = Math.max(1, ...(forecast?.forecast.map(f => f.predictedContacts) ?? [1]),
                            ...(forecast?.history.map(h => h.contacts) ?? [1]));

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold" style={{ color: tsColor(dark) }}>
          {ar ? 'الفترة' : 'Range'}
        </span>
        <input type="date" value={from} onChange={e => onRange(e.target.value, to)}
          className="rounded-lg text-[11px] px-2 py-1 outline-none"
          style={{ background: T.panel, border: `1px solid ${T.bdr}`, color: tp(dark), colorScheme: dark ? 'dark' : 'light' }} />
        <span style={{ color: T.faint }}>→</span>
        <input type="date" value={to} onChange={e => onRange(from, e.target.value)}
          className="rounded-lg text-[11px] px-2 py-1 outline-none"
          style={{ background: T.panel, border: `1px solid ${T.bdr}`, color: tp(dark), colorScheme: dark ? 'dark' : 'light' }} />
        <button onClick={onRefresh} disabled={refreshing}
          className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold"
          style={{ background: 'rgba(99,102,241,0.18)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', opacity: refreshing ? .6 : 1 }}>
          {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          {ar ? 'إعادة احتساب' : 'Recompute'}
        </button>
        <button onClick={() => downloadCsv(
            `/integrations/sprinklr/agent-daily?from=${from}&to=${to}&format=csv`,
            `agent_daily_${from}_${to}.csv`)}
          className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold"
          style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.28)' }}>
          ⬇ {ar ? 'تصدير Excel' : 'Export Excel'}
        </button>
      </div>

      {/* Forecast strip */}
      <div className="rounded-2xl p-3.5" style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: tp(dark) }}>
            <TrendingUp size={13} style={{ color: '#34d399' }} />
            {ar ? 'توقع حجم الكونتاكتات (7 أيام)' : 'Contact Volume Forecast (7 days)'}
          </span>
          <span className="text-[9px] px-2 py-0.5 rounded-full font-bold"
            style={{
              background: forecast?.confidence === 'insufficient-data' ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)',
              color:      forecast?.confidence === 'insufficient-data' ? '#fbbf24' : '#4ade80',
            }}>
            {forecast?.confidence === 'insufficient-data' ? (ar ? 'بيانات غير كافية' : 'Insufficient data')
              : forecast?.confidence === 'low' ? (ar ? 'ثقة منخفضة' : 'Low confidence')
              : (ar ? 'ثقة متوسطة' : 'Medium confidence')}
          </span>
        </div>
        {forecast?.note && (
          <p className="text-[10px] mb-2" style={{ color: tsColor(dark) }}>
            {ar ? 'يحتاج 7 أيام على الأقل من البيانات — التوقع يتحسن تلقائياً مع تراكم البيانات اليومية.' : forecast.note}
          </p>
        )}
        <div className="flex items-end gap-1.5" style={{ height: 70 }}>
          {(forecast?.history ?? []).slice(-7).map(h => (
            <div key={h.date} className="flex-1 flex flex-col items-center gap-0.5" title={`${h.date}: ${h.contacts}`}>
              <span className="text-[8px] tabular-nums" style={{ color: tsColor(dark) }}>{h.contacts || ''}</span>
              <div className="w-full rounded-t" style={{ height: Math.max(3, (h.contacts / maxFc) * 48), background: 'rgba(99,102,241,0.45)' }} />
              <span className="text-[8px]" style={{ color: T.faint }}>{h.date.slice(5)}</span>
            </div>
          ))}
          {(forecast?.forecast ?? []).map(f => (
            <div key={f.date} className="flex-1 flex flex-col items-center gap-0.5" title={`${f.date}: ~${f.predictedContacts} (${f.method})`}>
              <span className="text-[8px] tabular-nums" style={{ color: '#34d399' }}>{f.predictedContacts || ''}</span>
              <div className="w-full rounded-t" style={{
                height: Math.max(3, (f.predictedContacts / maxFc) * 48),
                background: 'rgba(52,211,153,0.3)', border: '1px dashed rgba(52,211,153,0.5)',
              }} />
              <span className="text-[8px]" style={{ color: T.faint }}>{f.date.slice(5)}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-[9px] flex items-center gap-1" style={{ color: tsColor(dark) }}>
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(99,102,241,0.45)' }} />
            {ar ? 'فعلي' : 'Actual'}
          </span>
          <span className="text-[9px] flex items-center gap-1" style={{ color: tsColor(dark) }}>
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(52,211,153,0.3)', border: '1px dashed rgba(52,211,153,0.5)' }} />
            {ar ? 'متوقع' : 'Forecast'}
          </span>
        </div>
      </div>

      {/* Per-day tables */}
      {!rows.length ? (
        <div className="flex flex-col items-center justify-center py-12">
          <BarChart3 size={30} className="mb-2" style={{ color: T.faint }} />
          <p className="text-xs font-semibold" style={{ color: tsColor(dark) }}>
            {ar ? 'لا توجد بيانات لهذه الفترة' : 'No data for this range'}
          </p>
          <p className="text-[10px] mt-1" style={{ color: T.faint }}>
            {ar ? 'البيانات تتجمع تلقائياً كل 5 دقائق من سبرينكلر' : 'Data accumulates automatically every 5 min from Sprinklr'}
          </p>
        </div>
      ) : dates.map(d => {
        const dayRows = rows.filter(r => String(r.stat_date).slice(0, 10) === d);
        const tot = report?.days?.[d];
        return (
          <div key={d} className="rounded-2xl overflow-hidden" style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
            <div className="flex items-center justify-between px-3.5 py-2" style={{ background: 'rgba(99,102,241,0.07)', borderBottom: `1px solid ${T.bdr}` }}>
              <span className="text-xs font-bold tabular-nums" style={{ color: tp(dark) }}>{d}</span>
              <div className="flex items-center gap-3 text-[10px]" style={{ color: tsColor(dark) }}>
                <span>👥 {tot?.agents ?? dayRows.length}</span>
                <span>⏱ {fmtMin(tot?.workingMinutes ?? 0)}</span>
                <span>📨 {tot?.contacts || '—'}</span>
                <span title={ar ? 'متوسط زمن المعالجة لليوم' : 'Daily avg handle time'}>
                  AHT <b style={{ color: tot?.avgAhtSec ? '#fbbf24' : T.faint }}>{fmtSec(tot?.avgAhtSec ?? null)}</b>
                </span>
                <span title={ar ? 'متوسط زمن أول رد لليوم' : 'Daily avg first response'}>
                  FRT <b style={{ color: tot?.avgFrtSec ? '#34d399' : T.faint }}>{fmtSec(tot?.avgFrtSec ?? null)}</b>
                </span>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 920 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.bdr}` }}>
                    {[
                      ar ? 'الموظف' : 'Agent',
                      ar ? 'رقم الموظف' : 'Emp #',
                      ar ? 'أول دخول' : 'First Login',
                      ar ? 'آخر خروج' : 'Last Logout',
                      ar ? 'ساعات العمل' : 'Working',
                      ar ? 'خامل بدون كيس' : 'Idle (no case)',
                      ar ? 'خامل مع كيس' : 'Idle (w/ case)',
                      ar ? 'مشغول' : 'Busy',
                      ar ? 'استراحة' : 'Break',
                      'AHT',
                      ar ? 'وقت الرد' : 'Response',
                      ar ? 'كونتاكتات' : 'Contacts',
                    ].map(h => (
                      <th key={h} className="text-[9px] font-bold px-2.5 py-1.5 whitespace-nowrap"
                        style={{ color: tsColor(dark), textAlign: 'start' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map(r => (
                    <tr key={r.sprinklr_agent_id} style={{ borderBottom: `1px solid ${T.bdr}` }}>
                      <td className="px-2.5 py-1.5">
                        <div className="text-[11px] font-semibold" style={{ color: tp(dark) }}>
                          {r.employee_name || r.agent_name}
                        </div>
                        {r.agent_email && (
                          <div className="text-[9px]" style={{ color: r.employee_id ? '#4ade80' : tsColor(dark) }}>
                            {r.agent_email} {r.employee_id ? '✓' : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: tsColor(dark) }}>{r.employee_no || '—'}</td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: tsColor(dark) }}>{fmtTime(r.first_login)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: tsColor(dark) }}>{fmtTime(r.last_logout)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] font-bold tabular-nums" style={{ color: '#34d399' }}>{fmtMin(r.total_working_minutes)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: '#a3e635' }}>{fmtMin(r.idle_no_case_minutes)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: '#fbbf24' }}>{fmtMin(r.idle_with_case_minutes)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: '#f59e0b' }}>{fmtMin(r.busy_minutes)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums"
                        style={{ color: (r.break_breakdown?.total_break ?? r.break_minutes) > 60 ? '#f87171' : '#818cf8', fontWeight: (r.break_breakdown?.total_break ?? r.break_minutes) > 60 ? 700 : 400 }}
                        title={r.break_breakdown ? `Tea ${r.break_breakdown.tea_break ?? 0}${ar ? 'د' : 'm'} · Lunch ${r.break_breakdown.lunch_break ?? 0}${ar ? 'د' : 'm'} · Bio ${r.break_breakdown.bio_break ?? 0}${ar ? 'د' : 'm'} · Prayer ${r.break_breakdown.prayer_break ?? 0}${ar ? 'د' : 'm'}` : undefined}>
                        {fmtMin(r.break_breakdown?.total_break ?? r.break_minutes)}
                        {(r.break_breakdown?.total_break ?? r.break_minutes) > 60 ? ' ⚠' : ''}
                      </td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: tsColor(dark) }}>{fmtSec(r.aht_seconds)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] tabular-nums" style={{ color: tsColor(dark) }}>{fmtSec(r.avg_response_seconds)}</td>
                      <td className="px-2.5 py-1.5 text-[10px] font-bold tabular-nums" style={{ color: tp(dark) }}>{r.contacts_received ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  ADHERENCE PANEL — scheduled vs actual                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */
const adhColor = (p: number | null) =>
  p == null ? '#475569' : p >= 90 ? '#22c55e' : p >= 80 ? '#a3e635' : p >= 65 ? '#f59e0b' : '#ef4444';

export function AdherencePanel({ report, intraday, ar, from, to, onRange, onRefresh, refreshing }: {
  report: AdherenceReport | null; intraday: IntradayData | null; ar: boolean;
  from: string; to: string;
  onRange: (f: string, t: string) => void;
  onRefresh: () => void; refreshing: boolean;
}) {
  const { dark } = useUiStore();
  const T = tok(dark);
  const s = report?.summary;
  const activeIntervals = (intraday?.intervals ?? []).filter(i => i.scheduled > 0 || (i.actual ?? 0) > 0);
  const maxHc = Math.max(1, ...activeIntervals.map(i => Math.max(i.scheduled, i.actual ?? 0)));

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <Activity size={14} style={{ color: '#34d399' }} />
        <span className="text-[11px] font-bold" style={{ color: tp(dark) }}>
          {ar ? 'الالتزام بالجدول' : 'Schedule Adherence'}
        </span>
        <input type="date" value={from} onChange={e => onRange(e.target.value, to)}
          className="rounded-lg text-[11px] px-2 py-1 outline-none"
          style={{ background: T.panel, border: `1px solid ${T.bdr}`, color: tp(dark), colorScheme: dark ? 'dark' : 'light' }} />
        <span style={{ color: T.faint }}>→</span>
        <input type="date" value={to} onChange={e => onRange(from, e.target.value)}
          className="rounded-lg text-[11px] px-2 py-1 outline-none"
          style={{ background: T.panel, border: `1px solid ${T.bdr}`, color: tp(dark), colorScheme: dark ? 'dark' : 'light' }} />
        <button onClick={onRefresh} disabled={refreshing}
          className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold"
          style={{ background: 'rgba(99,102,241,0.18)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', opacity: refreshing ? .6 : 1 }}>
          {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          {ar ? 'إعادة احتساب' : 'Recompute'}
        </button>
        <button onClick={() => downloadCsv(
            `/integrations/sprinklr/adherence?from=${from}&to=${to}&format=csv`,
            `adherence_${from}_${to}.csv`)}
          className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold"
          style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.28)' }}>
          ⬇ {ar ? 'تصدير Excel' : 'Export Excel'}
        </button>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {[
          { lbl: ar ? 'متوسط الالتزام' : 'Avg Adherence',   val: s?.avgAdherence != null ? `${s.avgAdherence}%` : '—', color: adhColor(s?.avgAdherence ?? null) },
          { lbl: ar ? 'متوسط الإنجاز'  : 'Avg Conformance', val: s?.avgConformance != null ? `${s.avgConformance}%` : '—', color: '#818cf8' },
          { lbl: ar ? 'مجدولين'        : 'Scheduled',       val: s?.employees ?? '—', color: '#94a3b8' },
          { lbl: ar ? 'مُتتبَّعين'      : 'Measured',        val: s?.measured ?? '—', color: '#06b6d4' },
          { lbl: ar ? 'تحت 85%'        : 'Below 85%',       val: s?.below85 ?? '—', color: (s?.below85 ?? 0) > 0 ? '#ef4444' : '#22c55e' },
        ].map(k => (
          <div key={k.lbl} className="rounded-2xl p-3 text-center"
            style={{ background: `${k.color}0a`, border: `1px solid ${k.color}26` }}>
            <div className="text-xl font-black tabular-nums leading-none" style={{ color: k.color }}>{k.val}</div>
            <div className="text-[9px] mt-1.5 font-semibold" style={{ color: tsColor(dark) }}>{k.lbl}</div>
          </div>
        ))}
      </div>

      {(s?.unmatched ?? 0) > 0 && (
        <div className="text-[10px] px-3 py-1.5 rounded-xl" style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24' }}>
          ⚠ {s!.unmatched} {ar ? 'موظف مجدول غير مرتبط بسبرينكلر بعد — ادمج التكرارات في صفحة Employee Merge أو انتظر تجميع الإيميلات'
                              : 'scheduled employees not yet linked to Sprinklr — merge duplicates in Employee Merge or wait for email harvest'}
        </div>
      )}

      {/* Intraday: scheduled vs actual HC */}
      {activeIntervals.length > 0 && (
        <div className="rounded-2xl p-3.5" style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: tp(dark) }}>
              <BarChart3 size={13} style={{ color: '#818cf8' }} />
              {ar ? 'اليوم لحظة بلحظة — مجدول vs فعلي (كل ٣٠ دقيقة)' : 'Intraday — Scheduled vs Actual HC (30-min)'}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-[9px] flex items-center gap-1" style={{ color: tsColor(dark) }}>
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(129,140,248,0.45)' }} />{ar ? 'مجدول' : 'Scheduled'}
              </span>
              <span className="text-[9px] flex items-center gap-1" style={{ color: tsColor(dark) }}>
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(52,211,153,0.6)' }} />{ar ? 'فعلي' : 'Actual'}
              </span>
            </div>
          </div>
          <div className="flex items-end gap-0.5" style={{ height: 90, overflowX: 'auto' }}>
            {activeIntervals.map(iv => (
              <div key={iv.interval} className="flex flex-col items-center gap-0.5" style={{ minWidth: 26 }}
                title={`${iv.interval} — ${ar ? 'مجدول' : 'sched'} ${iv.scheduled} / ${ar ? 'فعلي' : 'actual'} ${iv.actual ?? '—'}`}>
                <div className="flex items-end gap-px" style={{ height: 64 }}>
                  <div className="rounded-t" style={{ width: 9, height: Math.max(2, (iv.scheduled / maxHc) * 64), background: 'rgba(129,140,248,0.45)' }} />
                  <div className="rounded-t" style={{
                    width: 9, height: Math.max(2, ((iv.actual ?? 0) / maxHc) * 64),
                    background: iv.actual == null ? 'rgba(71,85,105,0.3)'
                      : (iv.gap ?? 0) < 0 ? 'rgba(239,68,68,0.65)' : 'rgba(52,211,153,0.6)',
                  }} />
                </div>
                <span className="text-[7.5px] tabular-nums" style={{ color: T.faint }}>{iv.interval}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-agent table */}
      {!(report?.rows.length) ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Activity size={30} className="mb-2" style={{ color: T.faint }} />
          <p className="text-xs font-semibold" style={{ color: tsColor(dark) }}>
            {ar ? 'لا توجد بيانات التزام لهذه الفترة' : 'No adherence data for this range'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 880 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.bdr}`, background: T.panel }}>
                  {[ar ? 'التاريخ' : 'Date', ar ? 'الموظف' : 'Employee', ar ? 'الشفت' : 'Shift',
                    ar ? 'الالتزام' : 'Adherence', ar ? 'الإنجاز' : 'Conformance',
                    ar ? 'داخل الشفت' : 'In-Shift', ar ? 'بريك بالشفت' : 'Break',
                    ar ? 'أوفلاين بالشفت' : 'Offline', ar ? 'متتبَّع/مجدول' : 'Tracked/Sched'].map((h, i) => (
                    <th key={i} className="text-[9px] font-bold px-3 py-2 whitespace-nowrap" style={{ color: tsColor(dark), textAlign: 'start' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map(r => {
                  const pct = r.adherence_pct != null ? +r.adherence_pct : null;
                  const c = adhColor(pct);
                  return (
                    <tr key={`${r.stat_date}_${r.employee_id}`} style={{ borderBottom: `1px solid ${T.bdr}` }}>
                      <td className="px-3 py-2 text-[10px] tabular-nums whitespace-nowrap" style={{ color: tsColor(dark) }}>{String(r.stat_date).slice(0, 10)}</td>
                      <td className="px-3 py-2">
                        <div className="text-[11px] font-semibold" style={{ color: tp(dark) }}>{r.employee_name}</div>
                        <div className="text-[9px]" style={{ color: r.sprinklr_agent_id ? '#4ade80' : '#f59e0b' }}>
                          #{r.employee_no} {r.sprinklr_agent_id ? '✓' : (ar ? '· غير مرتبط' : '· unlinked')}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[10px] font-bold" style={{ color: tsColor(dark) }}>
                        {r.shift_code ?? '—'}
                        <div className="text-[8.5px] font-normal" style={{ color: T.faint }}>
                          {fmtTime(r.scheduled_start)}–{fmtTime(r.scheduled_end)}
                        </div>
                      </td>
                      <td className="px-3 py-2" style={{ minWidth: 120 }}>
                        {pct == null ? <span className="text-[10px]" style={{ color: T.faint }}>{ar ? 'لا تتبع' : 'no tracking'}</span> : (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: T.panel, minWidth: 60 }}>
                              <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: c, transition: 'width .5s' }} />
                            </div>
                            <span className="text-[11px] font-black tabular-nums" style={{ color: c }}>{pct}%</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11px] font-bold tabular-nums" style={{ color: '#818cf8' }}>
                        {r.conformance_pct != null ? `${r.conformance_pct}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-[10px] tabular-nums" style={{ color: '#34d399' }}>{fmtMin(r.in_adherence_minutes)}</td>
                      <td className="px-3 py-2 text-[10px] tabular-nums" style={{ color: '#818cf8' }}>{fmtMin(r.break_in_shift_minutes)}</td>
                      <td className="px-3 py-2 text-[10px] tabular-nums" style={{ color: r.offline_in_shift_minutes > 30 ? '#f87171' : tsColor(dark) }}>{fmtMin(r.offline_in_shift_minutes)}</td>
                      <td className="px-3 py-2 text-[10px] tabular-nums" style={{ color: tsColor(dark) }}>{fmtMin(r.tracked_minutes)} / {fmtMin(r.scheduled_minutes)}</td>
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

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  COMPLIANCE / VIOLATIONS PANEL                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */
const VIOLATION_META: Record<string, { ar: string; en: string; icon: string; color: string }> = {
  excess_break:             { ar: 'بريك زائد (+1 ساعة)',   en: 'Excess Break (>1h)',     icon: '☕', color: '#f59e0b' },
  late_login:               { ar: 'تأخير عن الشفت',        en: 'Late Login',             icon: '⏰', color: '#ef4444' },
  early_logout:             { ar: 'خروج مبكر',             en: 'Early Logout',           icon: '🚪', color: '#f97316' },
  off_schedule:             { ar: 'شغل خارج الجدول',       en: 'Off-Schedule Activity',  icon: '📅', color: '#a855f7' },
  unauthorized_meeting:     { ar: 'ميتنج بدون موافقة',     en: 'Unauthorized Meeting',   icon: '👥', color: '#06b6d4' },
  unauthorized_manual_dial: { ar: 'Manual Dial بدون إذن',  en: 'Unauthorized Dial',      icon: '📞', color: '#ec4899' },
};
const SEV_COLOR = { low: '#fbbf24', medium: '#fb923c', high: '#f87171' };
const SEV_AR    = { low: 'بسيطة',   medium: 'متوسطة',  high: 'جسيمة'  };

interface ComplianceConfig {
  breakLimitMin: number; lateGraceMin: number; earlyGraceMin: number;
  meetingMinFlag: number; dialMinFlag: number;
}
const CFG_LABELS: Record<keyof ComplianceConfig, { ar: string; en: string }> = {
  breakLimitMin:  { ar: 'حد البريك اليومي (دقيقة)',      en: 'Daily break limit (min)' },
  lateGraceMin:   { ar: 'سماح التأخير (دقيقة)',          en: 'Late grace (min)' },
  earlyGraceMin:  { ar: 'سماح الخروج المبكر (دقيقة)',    en: 'Early-out grace (min)' },
  meetingMinFlag: { ar: 'حد الميتنج للرصد (دقيقة)',      en: 'Meeting flag (min)' },
  dialMinFlag:    { ar: 'حد Manual Dial للرصد (دقيقة)',  en: 'Dial flag (min)' },
};

export function CompliancePanel({ report, ar, from, to, onRange, onReview }: {
  report: ViolationsReport | null; ar: boolean;
  from: string; to: string;
  onRange: (f: string, t: string) => void;
  onReview: (id: string, status: string) => void;
}) {
  const { dark } = useUiStore();
  const T = tok(dark);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [cfg, setCfg] = useState<ComplianceConfig | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgMsg, setCfgMsg] = useState('');

  useEffect(() => {
    apiClient.get<ComplianceConfig>('/integrations/sprinklr/compliance-config')
      .then(r => setCfg(r.data)).catch(() => undefined);
  }, []);

  const saveCfg = async () => {
    if (!cfg) return;
    setCfgSaving(true); setCfgMsg('');
    try {
      const { data } = await apiClient.put<ComplianceConfig>('/integrations/sprinklr/compliance-config', cfg);
      setCfg(data);
      setCfgMsg(ar ? '✅ حُفظت — تُطبق عند إعادة الاحتساب القادمة' : '✅ Saved — applies on next recompute');
    } catch {
      setCfgMsg(ar ? '✗ فشل الحفظ — تحتاج صلاحية settings.edit' : '✗ Save failed — needs settings.edit permission');
    }
    setCfgSaving(false);
    setTimeout(() => setCfgMsg(''), 5000);
  };

  const rows = (report?.rows ?? []).filter(r => !typeFilter || r.violation_type === typeFilter);

  return (
    <div className="flex flex-col gap-3">
      {/* Range controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <Shield size={14} style={{ color: '#818cf8' }} />
        <span className="text-[11px] font-bold" style={{ color: tp(dark) }}>
          {ar ? 'تقرير الالتزام' : 'Compliance Report'}
        </span>
        <input type="date" value={from} onChange={e => onRange(e.target.value, to)}
          className="rounded-lg text-[11px] px-2 py-1 outline-none"
          style={{ background: T.panel, border: `1px solid ${T.bdr}`, color: tp(dark), colorScheme: dark ? 'dark' : 'light' }} />
        <span style={{ color: T.faint }}>→</span>
        <input type="date" value={to} onChange={e => onRange(from, e.target.value)}
          className="rounded-lg text-[11px] px-2 py-1 outline-none"
          style={{ background: T.panel, border: `1px solid ${T.bdr}`, color: tp(dark), colorScheme: dark ? 'dark' : 'light' }} />
        {report && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
            style={{ background: report.summary.open ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
                     color: report.summary.open ? '#f87171' : '#4ade80' }}>
            {report.summary.open} {ar ? 'مفتوحة' : 'open'} / {report.summary.total}
          </span>
        )}
        <button onClick={() => downloadCsv(
            `/integrations/sprinklr/violations?from=${from}&to=${to}&format=csv`,
            `violations_${from}_${to}.csv`)}
          className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold"
          style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.28)' }}>
          ⬇ {ar ? 'تصدير Excel' : 'Export Excel'}
        </button>
        <button onClick={() => setCfgOpen(o => !o)}
          className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold"
          style={{
            background: cfgOpen ? 'rgba(148,163,184,0.18)' : 'rgba(148,163,184,0.08)',
            color: '#94a3b8', border: '1px solid rgba(148,163,184,0.25)',
          }}>
          ⚙ {ar ? 'العتبات' : 'Thresholds'}
        </button>
      </div>

      {/* Thresholds editor */}
      {cfgOpen && cfg && (
        <div className="rounded-2xl p-3.5" style={{ background: 'rgba(148,163,184,0.04)', border: '1px solid rgba(148,163,184,0.15)' }}>
          <div className="flex items-end gap-3 flex-wrap">
            {(Object.keys(CFG_LABELS) as (keyof ComplianceConfig)[]).map(k => (
              <label key={k} className="flex flex-col gap-1">
                <span className="text-[9px] font-bold" style={{ color: tsColor(dark) }}>
                  {ar ? CFG_LABELS[k].ar : CFG_LABELS[k].en}
                </span>
                <input type="number" min={0} max={480} value={cfg[k]}
                  onChange={e => setCfg({ ...cfg, [k]: +e.target.value })}
                  className="rounded-lg text-[12px] px-2 py-1 outline-none tabular-nums"
                  style={{ width: 90, background: T.panel, border: '1px solid rgba(255,255,255,0.12)', color: tp(dark) }} />
              </label>
            ))}
            <button onClick={saveCfg} disabled={cfgSaving}
              className="flex items-center gap-1 px-4 py-1.5 rounded-lg text-[11px] font-bold"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', opacity: cfgSaving ? .6 : 1 }}>
              {cfgSaving && <Loader2 size={11} className="animate-spin" />}
              {ar ? 'حفظ العتبات' : 'Save'}
            </button>
            {cfgMsg && <span className="text-[10px] font-bold" style={{ color: cfgMsg.startsWith('✅') ? '#4ade80' : '#f87171' }}>{cfgMsg}</span>}
          </div>
          <p className="text-[9px] mt-2" style={{ color: tsColor(dark) }}>
            {ar ? 'تُطبق العتبات الجديدة على الاحتساب التلقائي القادم (كل ٥ دقائق) أو عند الضغط على "إعادة احتساب" في التقرير اليومي.'
                : 'New thresholds apply on the next auto-compute (every 5 min) or when pressing Recompute in the Daily Report.'}
          </p>
        </div>
      )}

      {/* Violation type cards — clickable filters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
        {Object.entries(VIOLATION_META).map(([key, meta]) => {
          const n = report?.summary.byType[key] ?? 0;
          const active = typeFilter === key;
          return (
            <button key={key} onClick={() => setTypeFilter(active ? null : key)}
              className="rounded-2xl p-3 text-center transition-all"
              style={{
                background: active ? `${meta.color}1c` : n > 0 ? `${meta.color}0c` : T.panel,
                border: active ? `1.5px solid ${meta.color}66` : `1px solid ${n > 0 ? meta.color + '30' : T.bdr}`,
                cursor: 'pointer',
              }}>
              <div className="text-base mb-1">{meta.icon}</div>
              <div className="text-xl font-black tabular-nums leading-none"
                style={{ color: n > 0 ? meta.color : T.faint }}>{n}</div>
              <div className="text-[8.5px] mt-1.5 font-semibold leading-tight" style={{ color: n > 0 ? tsColor(dark) : T.faint }}>
                {ar ? meta.ar : meta.en}
              </div>
            </button>
          );
        })}
      </div>

      {/* Top offenders strip */}
      {(report?.topOffenders?.length ?? 0) > 0 && (
        <div className="rounded-2xl p-3" style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <div className="text-[10px] font-bold mb-2 flex items-center gap-1.5" style={{ color: '#f87171' }}>
            <AlertTriangle size={11} /> {ar ? 'الأكثر مخالفةً في الفترة' : 'Top offenders in range'}
          </div>
          <div className="flex gap-2 flex-wrap">
            {report!.topOffenders.slice(0, 6).map(o => (
              <span key={o.agentId} className="text-[10px] px-2.5 py-1 rounded-full font-semibold"
                style={{ background: T.panel, border: '1px solid rgba(239,68,68,0.2)', color: tp(dark) }}>
                {o.name} <b style={{ color: '#f87171' }}>×{o.count}</b>
                {o.totalMinutes > 0 && <span style={{ color: tsColor(dark) }}> · {fmtMin(o.totalMinutes)}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Violations table */}
      {!rows.length ? (
        <div className="flex flex-col items-center justify-center py-14">
          <CheckCircle2 size={32} className="mb-2" style={{ color: '#16a34a' }} />
          <p className="text-xs font-bold" style={{ color: '#4ade80' }}>
            {typeFilter
              ? (ar ? 'لا مخالفات من هذا النوع' : 'No violations of this type')
              : (ar ? 'لا توجد مخالفات في هذه الفترة 🎉' : 'No violations in this range 🎉')}
          </p>
          <p className="text-[10px] mt-1" style={{ color: T.faint }}>
            {ar ? 'تُحتسب المخالفات تلقائياً كل ٥ دقائق من بيانات سبرينكلر والجدول' : 'Violations auto-computed every 5 min from Sprinklr + schedule data'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.bdr}`, background: T.panel }}>
                  {[ar ? 'التاريخ' : 'Date', ar ? 'الموظف' : 'Agent', ar ? 'المخالفة' : 'Violation',
                    ar ? 'الخطورة' : 'Severity', ar ? 'الدقائق' : 'Minutes',
                    ar ? 'التفاصيل' : 'Details', ar ? 'الحالة' : 'Status', ''].map((h, i) => (
                    <th key={i} className="text-[9px] font-bold px-3 py-2 whitespace-nowrap" style={{ color: tsColor(dark), textAlign: 'start' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const meta = VIOLATION_META[r.violation_type] ?? { ar: r.violation_type, en: r.violation_type, icon: '⚠', color: '#64748b' };
                  const det  = typeof r.details === 'object' ? r.details : {};
                  let detTxt = '';
                  if (r.violation_type === 'excess_break' && det.breakdown) {
                    const b = det.breakdown;
                    detTxt = `${ar ? 'إجمالي' : 'Total'} ${fmtMin(det.totalBreakMinutes)} — ☕${b.tea ?? 0} 🍽${b.lunch ?? 0} 🚻${b.bio ?? 0} 🕌${b.prayer ?? 0}`;
                  } else if (r.violation_type === 'late_login') {
                    detTxt = `${ar ? 'الشفت' : 'Shift'} ${fmtTime(r.shift_start)} → ${ar ? 'دخل' : 'in'} ${fmtTime(r.actual_at)}`;
                  } else if (r.violation_type === 'early_logout') {
                    detTxt = `${ar ? 'النهاية' : 'End'} ${fmtTime(r.shift_end)} → ${ar ? 'خرج' : 'out'} ${fmtTime(r.actual_at)}`;
                  } else if (r.violation_type === 'off_schedule') {
                    detTxt = det.reason === 'no_scheduled_shift'
                      ? (ar ? 'لا يوجد شفت مجدول' : 'No scheduled shift')
                      : (ar ? `مجدول ${det.shiftCode ?? 'OFF'}` : `Scheduled ${det.shiftCode ?? 'OFF'}`);
                  } else {
                    detTxt = `${fmtMin(r.minutes ?? 0)}`;
                  }
                  return (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${T.bdr}`, opacity: r.status !== 'open' ? .55 : 1 }}>
                      <td className="px-3 py-2 text-[10px] tabular-nums whitespace-nowrap" style={{ color: tsColor(dark) }}>
                        {String(r.violation_date).slice(0, 10)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-[11px] font-semibold" style={{ color: tp(dark) }}>{r.employee_name || r.agent_name}</div>
                        {r.employee_no && <div className="text-[9px]" style={{ color: tsColor(dark) }}>#{r.employee_no}</div>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: `${meta.color}14`, color: meta.color, border: `1px solid ${meta.color}30` }}>
                          {meta.icon} {ar ? meta.ar : meta.en}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: `${SEV_COLOR[r.severity]}14`, color: SEV_COLOR[r.severity] }}>
                          {ar ? SEV_AR[r.severity] : r.severity}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[11px] font-bold tabular-nums" style={{ color: meta.color }}>
                        {r.minutes != null ? fmtMin(r.minutes) : '—'}
                      </td>
                      <td className="px-3 py-2 text-[10px]" style={{ color: tsColor(dark), maxWidth: 230 }}>{detTxt}</td>
                      <td className="px-3 py-2">
                        <span className="text-[9px] font-bold" style={{
                          color: r.status === 'open' ? '#f87171' : r.status === 'justified' ? '#4ade80' : '#94a3b8',
                        }}>
                          {r.status === 'open' ? (ar ? 'مفتوحة' : 'Open')
                            : r.status === 'justified' ? (ar ? 'مبررة' : 'Justified')
                            : (ar ? 'تمت المراجعة' : 'Reviewed')}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.status === 'open' && (
                          <div className="flex gap-1">
                            <button onClick={() => onReview(r.id, 'reviewed')}
                              className="text-[9px] px-2 py-0.5 rounded-md font-bold"
                              style={{ background: 'rgba(148,163,184,0.12)', color: tsColor(dark), border: '1px solid rgba(148,163,184,0.25)' }}>
                              ✓ {ar ? 'مراجعة' : 'Review'}
                            </button>
                            <button onClick={() => onReview(r.id, 'justified')}
                              className="text-[9px] px-2 py-0.5 rounded-md font-bold"
                              style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)' }}>
                              {ar ? 'مبررة' : 'Justify'}
                            </button>
                          </div>
                        )}
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
