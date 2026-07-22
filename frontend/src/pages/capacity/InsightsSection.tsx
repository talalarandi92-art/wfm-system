/**
 * ⑤ INSIGHTS — the engine's own reading of the plan, as severity-colored
 * bullets ({metric, severity, text_en, text_ar}). Powered by
 * GET /capacity/staffing/insights?from&to (parallel backend agent).
 * Graceful-hides entirely until the endpoint lands — never invented prose.
 */
import { useMemo } from 'react';
import { Lightbulb } from 'lucide-react';
import { Section, sevPal, PAL, type Maybe } from './kit';

/* `metric` is NOT a string. The endpoint carries a different shape per insight
   kind ({staleDays}, {functionKey,date,hour,required}, {wapePct,perChannel}, …),
   and rendering one straight into JSX threw React #31 ("objects are not valid as
   a React child") — which blanked the whole Capacity page a second after load.
   Typed `unknown` so the compiler can never be told a comfortable lie again. */
interface Bullet { metric?: unknown; severity?: string; text_en?: string; text_ar?: string; text?: string }

/** A metric chip only ever shows a SCALAR. An object metric is already spelled
 *  out in the bullet's sentence, so there is nothing to invent — show nothing. */
export function metricLabel(m: unknown): string | null {
  if (m === null || m === undefined) return null;
  if (typeof m === 'number') return Number.isFinite(m) ? String(m) : null;
  if (typeof m === 'string') return m.trim() || null;
  if (typeof m === 'boolean') return String(m);
  return null;   // object / array → the sentence carries it
}

/** Same guard for the sentence itself: never hand React a non-string. */
function asText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : null;
}

export function normalizeInsights(data: unknown): Bullet[] {
  if (Array.isArray(data)) return data as Bullet[];
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const k of ['bullets', 'insights', 'items']) {
      if (Array.isArray(d[k])) return d[k] as Bullet[];
    }
  }
  return [];
}

export default function InsightsSection({ ar, no, ins }: { ar: boolean; no: string; ins: Maybe<unknown> }) {
  const bullets = useMemo(() => (ins.status === 'live' ? normalizeInsights(ins.data) : []), [ins]);
  if (ins.status !== 'live' || !bullets.length) return null;   // graceful-hide until the endpoint lands

  const sevRank = (s?: string) => (sevPal(s) === PAL.risk ? 0 : sevPal(s) === PAL.warn ? 1 : 2);
  const sorted = [...bullets].sort((a, b) => sevRank(a.severity) - sevRank(b.severity));

  return (
    <Section no={no} icon={Lightbulb} color={PAL.demand}
      title={ar ? 'قراءة المحرك للخطة' : "The engine's reading of the plan"}
      desc={ar ? 'ملاحظات مولّدة من نفس الأرقام أعلاه — مرتبة بالخطورة' : 'observations generated from the same numbers above — ordered by severity'}>
      <div className="space-y-1.5">
        {sorted.map((b, i) => {
          const color = sevPal(b.severity);
          const text = ar
            ? (asText(b.text_ar) ?? asText(b.text_en) ?? asText(b.text))
            : (asText(b.text_en) ?? asText(b.text) ?? asText(b.text_ar));
          if (!text) return null;
          const chip = metricLabel(b.metric);
          return (
            <div key={i} className="flex items-start gap-2.5 rounded-xl px-3 py-2"
              style={{ background: 'var(--surface-2)', borderInlineStart: `3px solid ${color}` }}>
              <span className="mt-1 flex-shrink-0 rounded-full" style={{ width: 7, height: 7, background: color, boxShadow: `0 0 6px ${color}66` }} />
              <span className="text-[11px] leading-relaxed flex-1" style={{ color: 'var(--text-2)' }}>{text}</span>
              {chip && (
                <span className="text-[8.5px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 mt-0.5"
                  style={{ background: `${color}15`, color }}>
                  {chip}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
