/**
 * EXECUTIVE STRIP — one glance = the whole staffing story.
 * Six <Kpi> hero tiles with full provenance (ⓘ endpoint/table/definition):
 * demand → peak requirement → team fieldable → hiring verdict →
 * forecast accuracy (awaiting until the accuracy endpoint lands) → learned floor.
 * Verified-data-only: every number traces to a live endpoint; anything not yet
 * measurable shows an explicit awaiting state — never a fake 0.
 */
import { useMemo } from 'react';
import { Flame, Users, UserPlus, Target, Zap, Inbox } from 'lucide-react';
import { Kpi, KpiRow } from '@/components/kpi';
import { nfmt, PAL, type ReqResp, type HiringResp, type Maybe } from './kit';

/* forecast-accuracy contract (parallel agent): per-channel WAPE/bias + per-day rows.
   Normalized defensively — shapes may drift until it lands. */
function extractWape(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const direct = ['overallWape', 'wape', 'overall_wape'].map(k => d[k]).find(v => typeof v === 'number');
  if (typeof direct === 'number') return direct;
  const arr = (Array.isArray(d.channels) ? d.channels : Array.isArray(d.perChannel) ? d.perChannel : null) as Record<string, unknown>[] | null;
  if (arr?.length) {
    const ws = arr.map(c => c.wape).filter((v): v is number => typeof v === 'number');
    if (ws.length) return ws.reduce((a, b) => a + b, 0) / ws.length;
  }
  return null;
}

export default function ExecutiveStrip({ ar, req, hiring, fa, learned }: {
  ar: boolean;
  req: ReqResp | null;
  hiring: HiringResp | null;
  fa: Maybe<unknown>;                 // GET /capacity/staffing/forecast-accuracy?days=28
  learned: { cells?: number; total_samples?: number; channels?: Record<string, unknown> } | null;
}) {
  const dailyPeaks = useMemo(() => (req?.days ?? []).map(d => Math.max(0, ...d.totalCurve48)), [req]);
  const peak = dailyPeaks.length ? Math.max(...dailyPeaks) : null;

  const dailyDemand = useMemo(
    () => (req?.days ?? []).map(d => d.functions.reduce((s, f) => s + (f.dayContacts || 0), 0)),
    [req]);
  const avgDemand = dailyDemand.length ? dailyDemand.reduce((a, b) => a + b, 0) / dailyDemand.length : null;

  const team = hiring ? hiring.perFunction.reduce((s, f) => s + (f.currentTeam || 0), 0) : null;
  const fieldable = hiring ? hiring.perFunction.reduce((s, f) => s + (f.fieldablePerDay ?? 0), 0) : null;
  const hire = hiring?.totalInternsToHire ?? null;
  const fnsNeeding = hiring ? hiring.perFunction.filter(f => f.internsToHire > 0).length : 0;

  const wape = fa.status === 'live' ? extractWape(fa.data) : null;
  const accuracy = wape != null ? Math.max(0, Math.min(100, 100 - wape * (wape <= 1 ? 100 : 1))) : null;

  const chCount = learned?.channels ? Object.keys(learned.channels).length : 0;
  const learnedPct = learned?.cells && chCount ? Math.round((learned.cells / (chCount * 168)) * 100) : null;

  const period = req ? `${req.from} → ${req.to}` : undefined;

  return (
    <KpiRow cols={6}>
      <Kpi
        label={ar ? 'الطلب / يوم' : 'Demand / day'}
        value={avgDemand != null ? nfmt(avgDemand) : '—'}
        sub={avgDemand != null ? (ar ? 'كونتاكت متوقع (متوسط الفترة)' : 'forecast contacts (period avg)') : (ar ? 'بانتظار التوقع' : 'awaiting forecast')}
        accent={PAL.demand}
        icon={<Inbox size={15} strokeWidth={2.2} />}
        spark={dailyDemand.length > 1 ? dailyDemand : undefined}
        source={{
          endpoint: 'GET /capacity/staffing/requirement',
          table: 'ops_contacts (28d same-weekday × intraday profile)',
          definition: 'Sum of forecast contacts across staffed functions, averaged per day of the selected range.',
          definitionAr: 'مجموع الكونتاكتس المتوقعة لكل الفنكشنز الموظفة — متوسط يومي للفترة المختارة.',
          period,
        }}
      />
      <Kpi
        label={ar ? 'ذروة المطلوب' : 'Required peak'}
        value={peak != null ? nfmt(peak) : '—'}
        sub={peak != null ? (ar ? 'HC متزامن بأثقل ساعة' : 'concurrent HC, heaviest hour') : (ar ? 'بانتظار الحساب' : 'awaiting computation')}
        accent={PAL.require}
        icon={<Flame size={15} strokeWidth={2.2} />}
        spark={dailyPeaks.length > 1 ? dailyPeaks : undefined}
        source={{
          endpoint: 'GET /capacity/staffing/requirement',
          table: 'staffing_params + ops_contacts',
          definition: 'Peak of the total generator curve: Erlang-C @ SL & occupancy cap ÷ productivity ÷ (1−shrinkage), max across all hours of the range.',
          definitionAr: 'ذروة منحنى المولّد الإجمالي: Erlang-C عند هدف الـSL وسقف الإشغال ÷ الإنتاجية ÷ (1−الشرينكج) — أقصى ساعة في الفترة.',
          period,
        }}
      />
      <Kpi
        label={ar ? 'الفريق: ينزّل/يوم' : 'Team fieldable'}
        value={fieldable != null ? nfmt(fieldable) : '—'}
        sub={team != null ? (ar ? `من فريق ${nfmt(team)} على الروستر` : `of ${nfmt(team)} on roster`) : (ar ? 'بانتظار البيانات' : 'awaiting data')}
        accent={PAL.team}
        icon={<Users size={15} strokeWidth={2.2} />}
        source={{
          endpoint: 'GET /capacity/staffing/hiring-now',
          table: 'employees (active per function)',
          definition: 'Bodies the current team can field per day = active team minus 2 OFF days/week, summed across functions.',
          definitionAr: 'أجسام يقدر الفريق ينزّلها يوميًا = الفريق النشط ناقص 2 OFF أسبوعيًا، مجموعة على الفنكشنز.',
          period: hiring ? `${hiring.from} → ${hiring.to}` : undefined,
        }}
      />
      <Kpi
        label={ar ? 'قرار التوظيف' : 'Hiring verdict'}
        value={hire == null ? '—' : hire > 0 ? `+${nfmt(hire)}` : '✓ 0'}
        sub={hire == null ? (ar ? 'بانتظار البيانات' : 'awaiting data')
          : hire > 0
            ? (ar ? `إنترن مطلوب · ${fnsNeeding} فنكشن ناقص` : `interns to hire · ${fnsNeeding} functions short`)
            : (ar ? 'الفريق الحالي كافي' : 'current team sufficient')}
        accent={hire != null && hire > 0 ? PAL.risk : PAL.ok}
        icon={<UserPlus size={15} strokeWidth={2.2} />}
        source={{
          endpoint: 'GET /capacity/staffing/hiring-now',
          table: 'staffing_params + ops_contacts + employees',
          definition: 'ceil(binding gap ÷ 0.70) per function — binding = max(peak gap, coverage team-gap incl. shrinkage/productivity/windows).',
          definitionAr: 'إنترن = ceil(الفجوة الملزمة ÷ 0.70) لكل فنكشن — الملزم = الأشد بين فجوة الذروة وفجوة التغطية.',
          period: hiring ? `${hiring.from} → ${hiring.to}` : undefined,
        }}
      />
      <Kpi
        label={ar ? 'دقة التوقع' : 'Forecast accuracy'}
        value={accuracy != null ? `${nfmt(accuracy)}%` : '—'}
        sub={accuracy != null
          ? (ar ? `WAPE ${nfmt(wape! * (wape! <= 1 ? 100 : 1))}% · آخر 28 يوم` : `WAPE ${nfmt(wape! * (wape! <= 1 ? 100 : 1))}% · last 28d`)
          : fa.status === 'loading' ? '…'
          : (ar ? 'بانتظار محرك الدقة' : 'awaiting accuracy engine')}
        accent={accuracy == null ? PAL.neutral : accuracy >= 85 ? PAL.ok : accuracy >= 70 ? PAL.warn : PAL.risk}
        icon={<Target size={15} strokeWidth={2.2} />}
        source={{
          endpoint: 'GET /capacity/staffing/forecast-accuracy?days=28',
          definition: '100 − WAPE of the daily forecast vs actual offered contacts, per channel, weighted over the last 28 days.',
          definitionAr: '100 − WAPE بين التوقع اليومي والكونتاكتس الفعلية لكل قناة على آخر 28 يوم.',
          period: ar ? 'آخر 28 يوم' : 'last 28 days',
        }}
      />
      <Kpi
        label={ar ? 'الأرضية المتعلمة' : 'Learned floor'}
        value={learnedPct != null ? `${learnedPct}%` : '—'}
        sub={learned?.cells
          ? (ar ? `${nfmt(learned.cells)} خلية · ${nfmt(learned.total_samples ?? 0)} عينة` : `${nfmt(learned.cells)} cells · ${nfmt(learned.total_samples ?? 0)} samples`)
          : (ar ? 'بانتظار قياسات سبرينكلر' : 'awaiting Sprinklr measurements')}
        accent={PAL.learn}
        icon={<Zap size={15} strokeWidth={2.2} />}
        source={{
          endpoint: 'GET /capacity/staffing/learned',
          table: 'staffing_observations (hourly Sprinklr rollup)',
          definition: 'Share of the weekday×hour grid (168 cells/channel) with a measured P90 concurrent-load floor — the engine never staffs below it.',
          definitionAr: 'نسبة خلايا شبكة يوم×ساعة (168/قناة) اللي لها أرضية P90 مقاسة — المحرك ما يوظف أبدًا أقل منها.',
        }}
      />
    </KpiRow>
  );
}
