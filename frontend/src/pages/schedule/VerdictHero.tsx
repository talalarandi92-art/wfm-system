/**
 * VERDICT HERO — the moment after Generate: one glance = can we run this week?
 *
 *   coverage ring (Gauge) · fairness score · rule-compliance badges ·
 *   hiring hint when short · per-day × function gap/surplus mini-grid ·
 *   honest unfilled-with-reasons list (severity-colored)
 *
 * Renders REAL numbers today from the engines' existing payloads and upgrades
 * automatically when the backend's normalized `verdict` block lands
 * (GenVerdict.live). Theme-aware (CSS vars) + RTL-safe (logical props).
 */
import { Link } from 'react-router-dom';
import {
  ShieldCheck, ShieldAlert, Scale, Moon, BedDouble, CalendarOff,
  UserPlus, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { Gauge } from '@/components/dazzle';
import {
  GenVerdict, SPAL, scoreHue, gapHue, nfmt, pct1, fmtDayShort, Awaiting,
} from './kit';

/* ── Rule badge ───────────────────────────────────────────────────────────── */
function RuleBadge({ icon: Icon, label, state, detail }: {
  icon: any; label: string;
  state: 'ok' | 'fail' | 'unknown';
  detail?: string;
}) {
  const color = state === 'ok' ? SPAL.ok : state === 'fail' ? SPAL.risk : SPAL.neutral;
  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2"
      style={{ background: `${color}12`, border: `1px solid ${color}30` }}>
      <Icon size={13} style={{ color, flexShrink: 0 }} />
      <span className="text-[11px] font-semibold min-w-0" style={{ color: 'var(--text-2)' }}>{label}</span>
      <span className="text-[11px] font-extrabold ms-auto whitespace-nowrap" style={{ color }}>
        {detail ?? (state === 'ok' ? '✓' : state === 'fail' ? '✗' : '…')}
      </span>
    </div>
  );
}

/* ── Mini gap cell ────────────────────────────────────────────────────────── */
function GapCell({ cell, ar }: { cell: { required: number | null; staffed: number | null; gap: number } | undefined; ar: boolean }) {
  if (!cell) {
    return <div className="h-7 rounded-md grid place-items-center" style={{ background: 'var(--surface-2)' }}>
      <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>—</span>
    </div>;
  }
  const g = cell.gap;
  const color = gapHue(g);
  const label = g > 0 ? `−${nfmt(g)}` : g < 0 ? `+${nfmt(-g)}` : '✓';
  const tip = cell.required != null && cell.staffed != null
    ? `${ar ? 'مطلوب' : 'req'} ${cell.required} · ${ar ? 'مجدول' : 'staffed'} ${cell.staffed}`
    : g > 0 ? (ar ? `عجز ${g} بالذروة النهارية` : `short ${g} at daytime peak`) : (ar ? 'مغطى' : 'covered');
  return (
    <div className="h-7 rounded-md grid place-items-center" title={tip}
      style={{ background: `${color}${g === 0 ? '14' : '1f'}`, border: `1px solid ${color}${g === 0 ? '26' : '40'}` }}>
      <span className="text-[10px] font-extrabold tabular-nums" style={{ color }}>{label}</span>
    </div>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────────── */
export default function VerdictHero({ ar, verdict, dates }: {
  ar: boolean;
  verdict: GenVerdict;
  dates: string[];
}) {
  const cov = verdict.coveragePct;
  const fair = verdict.fairnessScore;
  const ready = verdict.totalGap === 0
    && (verdict.rules.femaleNightViolations ?? 0) === 0
    && (verdict.rules.restViolations ?? 0) === 0
    && verdict.unfilled.length === 0;

  const ruleState = (n: number | null): 'ok' | 'fail' | 'unknown' =>
    n == null ? 'unknown' : n === 0 ? 'ok' : 'fail';

  return (
    <div className="space-y-4">

      {/* ── Top strip: verdict banner ── */}
      <div className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 flex-wrap"
        style={{
          background: ready ? `${SPAL.ok}10` : `${SPAL.warn}10`,
          border: `1px solid ${ready ? SPAL.ok : SPAL.warn}35`,
        }}>
        {ready
          ? <CheckCircle2 size={16} style={{ color: SPAL.ok, flexShrink: 0 }} />
          : <AlertTriangle size={16} style={{ color: SPAL.warn, flexShrink: 0 }} />}
        <span className="text-[12.5px] font-extrabold" style={{ color: ready ? SPAL.ok : SPAL.warn }}>
          {ready
            ? (ar ? 'الجدول جاهز — التغطية كاملة ولا مخالفات' : 'Schedule ready — full coverage, no violations')
            : (ar
              ? `يحتاج مراجعة — ${verdict.gapDays} يوم فيه عجز · ${verdict.unfilled.length} شاغر`
              : `Needs review — ${verdict.gapDays} day(s) with a gap · ${verdict.unfilled.length} unfilled`)}
        </span>
        {!verdict.live && (
          <span className="text-[9.5px] px-2 py-0.5 rounded-lg ms-auto"
            style={{ background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
            {ar ? 'محسوب من نتيجة المولّد — عدّادات القواعد الكاملة قادمة مع الخادم' : 'derived from the generate payload — full rule counters land with the backend verdict'}
          </span>
        )}
      </div>

      {/* ── Hero row: gauges + rules + hiring ── */}
      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>

        {/* Coverage ring */}
        <div className="rounded-xl p-3 grid place-items-center" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          {cov != null ? (
            <Gauge
              value={Math.max(0, Math.min(100, cov))}
              label={ar ? 'التغطية مقابل المطلوب' : 'Coverage vs required'}
              color={scoreHue(cov)}
              size={132}
            />
          ) : (
            <Awaiting ar={ar}
              text="Coverage % awaits the demand curve"
              textAr="نسبة التغطية بانتظار منحنى الطلب" />
          )}
        </div>

        {/* Fairness */}
        <div className="rounded-xl p-3 grid place-items-center" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          {fair != null ? (
            <Gauge
              value={Math.max(0, Math.min(100, fair))}
              label={ar ? 'مؤشر العدالة (توزيع الورديات)' : 'Fairness score (shift distribution)'}
              color={scoreHue(fair)}
              size={132}
            />
          ) : (
            <Awaiting ar={ar}
              text="Fairness score lands with the backend verdict block"
              textAr="مؤشر العدالة يصل مع كتلة verdict من الخادم" />
          )}
        </div>

        {/* Rule compliance */}
        <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <ShieldCheck size={12} style={{ color: SPAL.fair }} />
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              {ar ? 'الالتزام بالقواعد' : 'Rule compliance'}
            </span>
          </div>
          <RuleBadge icon={Moon}
            label={ar ? 'قاعدة الليل للإناث' : 'Female night rule'}
            state={ruleState(verdict.rules.femaleNightViolations)}
            detail={verdict.rules.femaleNightViolations == null
              ? undefined
              : verdict.rules.femaleNightViolations === 0 ? '✓ 0' : `✗ ${verdict.rules.femaleNightViolations}`} />
          <RuleBadge icon={BedDouble}
            label={ar ? 'راحة ١٠ ساعات' : '10h rest rule'}
            state={ruleState(verdict.rules.restViolations)}
            detail={verdict.rules.restViolations == null
              ? undefined
              : verdict.rules.restViolations === 0 ? '✓ 0' : `✗ ${verdict.rules.restViolations}`} />
          <RuleBadge icon={CalendarOff}
            label={ar ? 'OFF أسبوعي لكل موظف' : 'Weekly OFF per agent'}
            state={verdict.rules.offPerWeekOk == null ? 'unknown' : verdict.rules.offPerWeekOk ? 'ok' : 'fail'} />
          {!verdict.live && (
            <p className="text-[9px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
              {ar ? '… = العدّاد يصل مع كتلة verdict' : '… = counter arrives with the verdict block'}
            </p>
          )}
        </div>

        {/* Gap summary + hiring hint */}
        <div className="rounded-xl p-3 space-y-2.5" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Scale size={12} style={{ color: SPAL.required }} />
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              {ar ? 'ملخص العجز' : 'Gap summary'}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold tabular-nums" style={{ color: verdict.totalGap > 0 ? SPAL.risk : SPAL.ok }}>
              {verdict.totalGap > 0 ? `−${nfmt(verdict.totalGap)}` : '0'}
            </span>
            <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
              {ar ? 'جسم ناقص بالذروة (مجموع الأسبوع)' : 'bodies short at peak (week total)'}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-extrabold tabular-nums" style={{ color: cov != null ? scoreHue(cov) : 'var(--text-3)' }}>
              {pct1(cov)}
            </span>
            <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
              {ar ? 'من المطلوب مغطى' : 'of requirement covered'}
            </span>
          </div>
          {verdict.totalGap > 0 && (
            <Link to="/capacity?tab=staffing"
              className="flex items-center gap-2 rounded-xl px-3 py-2 transition-all hover:brightness-110"
              style={{ background: `${SPAL.risk}12`, border: `1px solid ${SPAL.risk}35` }}>
              <UserPlus size={13} style={{ color: SPAL.risk, flexShrink: 0 }} />
              <span className="text-[10.5px] font-semibold" style={{ color: SPAL.risk }}>
                {verdict.hiringHint
                  ?? (ar
                    ? 'العجز يتكرر؟ افتح قرار التوظيف في Capacity — يحسب كم إنترن مطلوب'
                    : 'Recurring gap? Open the hiring verdict in Capacity — it sizes the interns needed')}
              </span>
            </Link>
          )}
          {verdict.totalGap === 0 && (
            <p className="text-[10.5px] flex items-center gap-1.5" style={{ color: SPAL.ok }}>
              <ShieldCheck size={11} />
              {ar ? 'الفريق الحالي يغطي طلب الأسبوع' : 'Current team covers the week’s demand'}
            </p>
          )}
        </div>
      </div>

      {/* ── Per-day × function gap/surplus mini-grid ── */}
      {verdict.perFunction.length > 0 && dates.length > 0 && (
        <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              {ar ? 'العجز/الفائض — يوم × فنكشن (نافذة النهار 07:00+)' : 'Gap / surplus — day × function (daytime window 07:00+)'}
            </span>
            <span className="flex items-center gap-2.5 ms-auto text-[9px]" style={{ color: 'var(--text-3)' }}>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: SPAL.ok }} />{ar ? 'مغطى' : 'covered'}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: SPAL.warn }} />−1</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: SPAL.risk }} />{ar ? '−2 أو أكثر' : '−2 or worse'}</span>
            </span>
          </div>
          <div className="overflow-x-auto">
            <div style={{ minWidth: 560 }}>
              {/* header row */}
              <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: `150px repeat(${dates.length}, 1fr)` }}>
                <span />
                {dates.map(d => (
                  <span key={d} className="text-[9px] font-bold text-center" style={{ color: 'var(--text-3)' }}>
                    {fmtDayShort(d, ar)}
                  </span>
                ))}
              </div>
              {verdict.perFunction.map(fn => (
                <div key={fn.functionName} className="grid gap-1 mb-1" style={{ gridTemplateColumns: `150px repeat(${dates.length}, 1fr)` }}>
                  <span className="text-[10.5px] font-semibold truncate self-center" title={fn.functionName} style={{ color: 'var(--text-2)' }}>
                    {fn.functionName}
                  </span>
                  {dates.map(d => <GapCell key={d} cell={fn.days[d]} ar={ar} />)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Unfilled with reasons — the honest list ── */}
      {verdict.unfilled.length > 0 && (
        <div className="rounded-xl p-3 space-y-1.5" style={{ background: `${SPAL.risk}08`, border: `1px solid ${SPAL.risk}30` }}>
          <div className="flex items-center gap-2">
            <ShieldAlert size={13} style={{ color: SPAL.risk }} />
            <span className="text-[11px] font-extrabold" style={{ color: SPAL.risk }}>
              {ar ? `${verdict.unfilled.length} شاغر لم يُملأ — الأسباب` : `${verdict.unfilled.length} unfilled slot(s) — with reasons`}
            </span>
          </div>
          {verdict.unfilled.slice(0, 10).map((u, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px]">
              <span className="mt-0.5 flex-shrink-0" style={{ color: SPAL.risk }}>•</span>
              <span style={{ color: 'var(--text-2)' }}>
                {u.date && <span className="font-bold me-1" style={{ color: 'var(--text-1)' }}>{fmtDayShort(u.date, ar)}</span>}
                {u.functionName && <span className="me-1" style={{ color: SPAL.required }}>{u.functionName}</span>}
                {u.code && <span className="font-mono font-bold me-1" style={{ color: SPAL.warn }}>{u.code}</span>}
                — {u.reason}
              </span>
            </div>
          ))}
          {verdict.unfilled.length > 10 && (
            <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
              +{verdict.unfilled.length - 10} {ar ? 'أخرى…' : 'more…'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
