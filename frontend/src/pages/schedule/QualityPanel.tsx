/**
 * SCHEDULE QUALITY PANEL — grade an EXISTING week (Stage 2B, new hub tab).
 *
 * Reads GET /roster-v2/schedule-quality?from&to (being built by the parallel
 * backend agent) through useMaybe(): while the endpoint is missing the panel
 * shows an honest awaiting state — it NEVER fakes a score. Once live it shows
 * coverage / fairness / compliance tiles + a worst-day callout + per-day bars.
 */
import { useEffect, useState } from 'react';
import {
  BadgeCheck, Calendar, ChevronLeft, ChevronRight, ShieldCheck,
  Moon, BedDouble, CalendarOff, AlertTriangle, Gauge as GaugeIcon,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { fmtLocalDate, weekStartSat } from '@/utils/format';
import { Gauge, BarRow } from '@/components/dazzle';
import {
  Section, Awaiting, useMaybe, normalizeQuality, SPAL, scoreHue, gapHue,
  nfmt, fmtDayShort, addDaysIso,
} from './kit';

function fmtRange(from: string, to: string, ar: boolean) {
  const s = new Date(from + 'T00:00:00');
  const e = new Date(to + 'T00:00:00');
  if (ar) {
    const M = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    return `${s.getDate()} ${M[s.getMonth()]} – ${e.getDate()} ${M[e.getMonth()]}`;
  }
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function RulePill({ icon: Icon, label, state, detail, ar }: {
  icon: any; label: string; state: 'ok' | 'fail' | 'unknown'; detail?: string; ar: boolean;
}) {
  const color = state === 'ok' ? SPAL.ok : state === 'fail' ? SPAL.risk : SPAL.neutral;
  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
      style={{ background: `${color}12`, border: `1px solid ${color}30` }}>
      <Icon size={14} style={{ color, flexShrink: 0 }} />
      <span className="text-[11.5px] font-semibold min-w-0" style={{ color: 'var(--text-2)' }}>{label}</span>
      <span className="text-[11.5px] font-extrabold ms-auto whitespace-nowrap" style={{ color }}>
        {detail ?? (state === 'ok' ? '✓' : state === 'fail' ? '✗' : (ar ? '…' : '…'))}
      </span>
    </div>
  );
}

export default function QualityPanel() {
  const { lang } = useUiStore();
  const ar = lang === 'ar';

  const [availableWeeks, setAvailableWeeks] = useState<string[]>([]);
  const [weekStart, setWeekStart] = useState(weekStartSat());

  useEffect(() => {
    apiClient.get('/schedule/available-weeks').then(r => {
      const wks: string[] = r.data ?? [];
      setAvailableWeeks(wks);
      // Default: latest week on or before today (a week that actually exists)
      const today = fmtLocalDate(new Date());
      const past = wks.find(w => w <= today) ?? wks[0];
      if (past) setWeekStart(past);
    }).catch(() => {});
  }, []);

  const weekEnd = addDaysIso(weekStart, 6);
  const q = useMaybe<unknown>(`/roster-v2/schedule-quality?from=${weekStart}&to=${weekEnd}`);
  const quality = q.status === 'live' ? normalizeQuality(q.data) : null;

  const shiftWeek = (dir: -1 | 1) => {
    const idx = availableWeeks.indexOf(weekStart);
    if (idx >= 0) {
      const next = availableWeeks[idx - dir];   // list is newest-first
      if (next) { setWeekStart(next); return; }
    }
    setWeekStart(addDaysIso(weekStart, dir * 7));
  };

  const maxBar = quality?.perDay.length
    ? Math.max(1, ...quality.perDay.map(d => Math.max(d.required ?? 0, d.staffed ?? 0)))
    : 1;

  const ruleState = (n: number | null): 'ok' | 'fail' | 'unknown' =>
    n == null ? 'unknown' : n === 0 ? 'ok' : 'fail';

  return (
    <div className="max-w-[1600px] mx-auto space-y-4" dir={ar ? 'rtl' : 'ltr'}>

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BadgeCheck size={20} className="text-indigo-500 dark:text-indigo-400" />
            {ar ? 'جودة الجدول' : 'Schedule Quality'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {ar
              ? 'درجة أسبوع موجود فعلاً: التغطية، العدالة، والالتزام بالقواعد — من بيانات الروستر المعتمدة'
              : 'Grade an existing week: coverage, fairness, and rule compliance — from the canonical roster'}
          </p>
        </div>
      </div>

      {/* ══ ① WEEK UNDER REVIEW ═════════════════════════════════════════════ */}
      <Section
        no={ar ? '١' : '1'}
        icon={Calendar}
        color={SPAL.staffed}
        title={ar ? 'الأسبوع قيد التقييم' : 'Week under review'}
        desc={ar
          ? 'الأسبوع يبدأ السبت — اختر أي أسبوع من الجداول الموجودة لتقييمه.'
          : 'Week starts Saturday — pick any existing scheduled week to grade.'}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => shiftWeek(-1)}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400
                         hover:text-slate-900 dark:hover:text-white bg-slate-900/5 dark:bg-white/5 transition-colors">
              {ar ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
            <div className="text-center" style={{ minWidth: 150 }}>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{ar ? 'الأسبوع' : 'Week'}</p>
              <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{fmtRange(weekStart, weekEnd, ar)}</p>
            </div>
            <button onClick={() => shiftWeek(1)}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400
                         hover:text-slate-900 dark:hover:text-white bg-slate-900/5 dark:bg-white/5 transition-colors">
              {ar ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>
        }
      >
        <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
          {ar
            ? 'المصدر: GET /roster-v2/schedule-quality — يقيّم الجدول الفعلي المخزّن (roster_days / attendance_records) مقابل الطلب والقواعد.'
            : 'Source: GET /roster-v2/schedule-quality — scores the stored schedule (roster_days / attendance_records) against demand and the rules.'}
        </p>
      </Section>

      {/* ══ ② SCORECARD ═════════════════════════════════════════════════════ */}
      <Section
        no={ar ? '٢' : '2'}
        icon={GaugeIcon}
        color={SPAL.fair}
        title={ar ? 'بطاقة الجودة — تغطية · عدالة · التزام' : 'Quality scorecard — coverage · fairness · compliance'}
        desc={ar
          ? 'كل رقم من الخادم مباشرة — لا يُعرض أي رقم مُختلق.'
          : 'Every number comes straight from the endpoint — nothing is fabricated.'}
      >
        {q.status === 'loading' && (
          <div className="flex items-center justify-center py-10">
            <div className="w-7 h-7 rounded-full border-[3px] border-indigo-500/20 border-t-indigo-500 animate-spin" />
          </div>
        )}

        {q.status === 'missing' && (
          <Awaiting ar={ar}
            text="Scoring endpoint not deployed yet — /roster-v2/schedule-quality lands with the backend verdict work. This panel lights up automatically."
            textAr="نقطة التقييم لم تُنشر بعد — /roster-v2/schedule-quality تصل مع شغل الـverdict في الخادم. اللوحة تشتغل تلقائياً عند وصولها." />
        )}

        {q.status === 'live' && !quality && (
          <Awaiting ar={ar}
            text="Endpoint responded but returned no gradeable data for this week."
            textAr="النقطة ردّت لكن بدون بيانات قابلة للتقييم لهذا الأسبوع." />
        )}

        {quality && (
          <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
            {/* Coverage */}
            <div className="rounded-xl p-3 grid place-items-center" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              {quality.coveragePct != null
                ? <Gauge value={Math.max(0, Math.min(100, quality.coveragePct))}
                    label={ar ? 'تغطية الطلب' : 'Demand coverage'}
                    color={scoreHue(quality.coveragePct)} size={132} />
                : <Awaiting ar={ar} text="No coverage % in the response" textAr="لا نسبة تغطية في الرد" />}
            </div>
            {/* Fairness */}
            <div className="rounded-xl p-3 grid place-items-center" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              {quality.fairnessScore != null
                ? <Gauge value={Math.max(0, Math.min(100, quality.fairnessScore))}
                    label={ar ? 'مؤشر العدالة' : 'Fairness score'}
                    color={scoreHue(quality.fairnessScore)} size={132} />
                : <Awaiting ar={ar} text="No fairness score in the response" textAr="لا مؤشر عدالة في الرد" />}
            </div>
            {/* Compliance */}
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <ShieldCheck size={12} style={{ color: SPAL.fair }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  {ar ? 'الالتزام بالقواعد' : 'Rule compliance'}
                </span>
              </div>
              <RulePill ar={ar} icon={Moon}
                label={ar ? 'قاعدة الليل للإناث' : 'Female night rule'}
                state={ruleState(quality.rules.femaleNightViolations)}
                detail={quality.rules.femaleNightViolations == null ? undefined
                  : quality.rules.femaleNightViolations === 0 ? '✓ 0' : `✗ ${quality.rules.femaleNightViolations}`} />
              <RulePill ar={ar} icon={BedDouble}
                label={ar ? 'راحة ١٠ ساعات' : '10h rest rule'}
                state={ruleState(quality.rules.restViolations)}
                detail={quality.rules.restViolations == null ? undefined
                  : quality.rules.restViolations === 0 ? '✓ 0' : `✗ ${quality.rules.restViolations}`} />
              <RulePill ar={ar} icon={CalendarOff}
                label={ar ? 'OFF أسبوعي لكل موظف' : 'Weekly OFF per agent'}
                state={quality.rules.offPerWeekOk == null ? 'unknown' : quality.rules.offPerWeekOk ? 'ok' : 'fail'} />
            </div>
            {/* Worst day callout */}
            <div className="rounded-xl p-3 space-y-2" style={{
              background: quality.worstDay ? `${SPAL.risk}0a` : `${SPAL.ok}0a`,
              border: `1px solid ${quality.worstDay ? SPAL.risk : SPAL.ok}30`,
            }}>
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle size={12} style={{ color: quality.worstDay ? SPAL.risk : SPAL.ok }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  {ar ? 'أسوأ يوم' : 'Worst day'}
                </span>
              </div>
              {quality.worstDay ? (
                <>
                  <p className="text-xl font-extrabold" style={{ color: SPAL.risk }}>
                    {fmtDayShort(quality.worstDay.date, ar)}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                    {quality.worstDay.reason
                      ?? (ar
                        ? `عجز ${nfmt(quality.worstDay.gap)} جسم بالذروة — راجع توزيع هذا اليوم أولاً`
                        : `${nfmt(quality.worstDay.gap)} bodies short at peak — review this day’s mix first`)}
                  </p>
                </>
              ) : (
                <p className="text-[11.5px] font-semibold" style={{ color: SPAL.ok }}>
                  {ar ? '✓ لا يوجد يوم بعجز — كل أيام الأسبوع مغطاة' : '✓ No day in deficit — every day of the week is covered'}
                </p>
              )}
            </div>
          </div>
        )}
      </Section>

      {/* ══ ③ PER-DAY BREAKDOWN ═════════════════════════════════════════════ */}
      {quality && quality.perDay.length > 0 && (
        <Section
          no={ar ? '٣' : '3'}
          icon={Calendar}
          color={SPAL.required}
          title={ar ? 'يوم بيوم — المجدول مقابل المطلوب' : 'Day by day — staffed vs required'}
          desc={ar
            ? 'الأزرق السماوي = مجدول · النيلي = مطلوب · اللون على الرقم = حالة الفجوة.'
            : 'Sky = staffed · indigo = required · the number’s color = gap status.'}
        >
          <div className="space-y-3">
            {quality.perDay.map((d, i) => (
              <div key={d.date} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold w-16" style={{ color: 'var(--text-1)' }}>{fmtDayShort(d.date, ar)}</span>
                  <span className="text-[10px] font-extrabold tabular-nums px-2 py-0.5 rounded-lg"
                    style={{ background: `${gapHue(d.gap)}15`, color: gapHue(d.gap), border: `1px solid ${gapHue(d.gap)}30` }}>
                    {d.gap > 0 ? `−${nfmt(d.gap)}` : d.gap < 0 ? `+${nfmt(-d.gap)}` : '✓'}
                  </span>
                </div>
                {d.staffed != null && (
                  <BarRow label={ar ? 'مجدول' : 'staffed'} value={d.staffed} max={maxBar} color={SPAL.staffed} delay={i * 40} />
                )}
                {d.required != null && (
                  <BarRow label={ar ? 'مطلوب' : 'required'} value={d.required} max={maxBar} color={SPAL.required} delay={i * 40 + 20} />
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
