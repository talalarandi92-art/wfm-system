/**
 * AUTO-SCORING READINESS — "can the scorecard build itself yet?"
 *
 * B7 proved the ENGINE is right (98.95% against the Director's own workbooks).
 * This answers the other half: does the system actually HOLD the numbers the
 * engine would score from. Every row is a live probe over a real table, and every
 * missing feed is priced in Net Points — so "chase the Sprinklr key or not?" is a
 * number, not an opinion.
 *
 * Rendered inside /scorecard?tab=rules, under the rulebook it depends on.
 */
import { useEffect, useState, useCallback } from 'react';
import { Radar, AlertTriangle, CheckCircle2, CircleSlash, Wrench } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { NxCard, card, STATUS } from '@/components/ds';
import { scalarLabel } from '@/utils/format';

type ReadyState = 'ready' | 'partial' | 'missing' | 'not-scored' | 'probe-error';
interface KpiReadiness {
  kpiCode: string; nameEn: string; nameAr: string; weight: number;
  source: string; probe: string;
  rowsWithValue: number; peopleCovered: number; latestDate: string | null;
  coveragePct: number | null; state: ReadyState; blockedBy: string;
}
interface Report {
  generatedAt: string; window: { from: string; to: string }; population: number;
  autoScorablePoints: number; scoredPointsTotal: number; autoScorablePct: number;
  unlockedBy: { feed: string; points: number; kpis: string[] }[];
  kpis: KpiReadiness[];
  verdict: { canAutoScore: boolean; text_en: string; text_ar: string };
}

const STATE_META: Record<ReadyState, { color: string; ar: string; en: string }> = {
  ready:         { color: STATUS.ok,      ar: 'جاهز',        en: 'ready' },
  partial:       { color: STATUS.warn,    ar: 'جزئي',        en: 'partial' },
  missing:       { color: STATUS.risk,    ar: 'مفقود',       en: 'missing' },
  'probe-error': { color: '#a855f7',      ar: 'فحص فاشل',    en: 'probe error' },
  'not-scored':  { color: STATUS.neutral, ar: 'غير محتسَب',  en: 'not scored' },
};

export default function AutoScoringReadiness() {
  const { dark, lang } = useUiStore();
  const ar = lang === 'ar';
  const [d, setD] = useState<Report | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(() => {
    setErr(false);
    apiClient.get<Report>('/scorecard/auto-scoring-readiness')
      .then(r => setD(r.data)).catch(() => setErr(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (err) return null;                 // graceful-hide; the rulebook above still stands
  if (!d) return null;

  const scored = d.kpis.filter(k => k.weight > 0).sort((a, b) => b.weight - a.weight);
  const pctColor = d.autoScorablePct >= 80 ? STATUS.ok : d.autoScorablePct >= 40 ? STATUS.warn : STATUS.risk;
  const txt = dark ? '#cbd5e1' : '#334155';
  const faint = dark ? '#94a3b8' : '#64748b';

  return (
    <NxCard dark={dark} style={{ marginBottom: 14, borderInlineStart: `3px solid ${pctColor}` }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
        <Radar size={16} style={{ color: pctColor, flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ color: dark ? '#f1f5f9' : '#0f172a', fontSize: 13 }}>
            {ar ? 'هل يستطيع النظام احتساب السكوركارد بنفسه؟' : 'Can the scorecard build itself yet?'}
          </b>
          <div style={{ fontSize: 12.5, lineHeight: 1.65, color: txt, marginTop: 5 }}>
            {ar ? d.verdict.text_ar : d.verdict.text_en}
          </div>
          <div style={{ fontSize: 11, color: faint, marginTop: 5 }}>
            {ar
              ? `نافذة ${d.window.from} → ${d.window.to} · ${d.population} شخصًا على الروستر · كل سطر أدناه فحصٌ حيّ على جدول حقيقي`
              : `window ${d.window.from} → ${d.window.to} · ${d.population} people on the roster · every row below is a live probe over a real table`}
          </div>
        </div>
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: pctColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {d.autoScorablePct}%
          </div>
          <div style={{ fontSize: 10, color: faint, marginTop: 3 }}>
            {d.autoScorablePoints} / {d.scoredPointsTotal} {ar ? 'نقطة' : 'pts'}
          </div>
        </div>
      </div>

      {/* per-KPI probe results */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {scored.map(k => {
          const m = STATE_META[k.state];
          const Icon = k.state === 'ready' ? CheckCircle2 : k.state === 'probe-error' ? Wrench
            : k.state === 'missing' ? CircleSlash : AlertTriangle;
          return (
            <div key={k.kpiCode} style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
              padding: '5px 8px', borderRadius: 8,
              background: k.state === 'ready' ? `${m.color}0d` : 'transparent',
              borderInlineStart: `2px solid ${m.color}`,
            }}>
              <Icon size={12} style={{ color: m.color, flexShrink: 0 }} />
              <span style={{ minWidth: 128, fontWeight: 700, color: dark ? '#e2e8f0' : '#0f172a' }}>{k.kpiCode}</span>
              <span style={{ minWidth: 42, textAlign: 'end', fontVariantNumeric: 'tabular-nums', color: faint }}>
                {k.weight} {ar ? 'ن' : 'pt'}
              </span>
              <span style={{ minWidth: 74, color: m.color, fontWeight: 600 }}>{ar ? m.ar : m.en}</span>
              <span style={{ minWidth: 52, textAlign: 'end', fontVariantNumeric: 'tabular-nums', color: faint }}>
                {scalarLabel(k.coveragePct) == null ? '—' : `${k.coveragePct}%`}
              </span>
              <span style={{ flex: 1, color: faint, fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={k.blockedBy || k.probe}>
                {k.blockedBy || k.probe}
              </span>
            </div>
          );
        })}
      </div>

      {/* the decision list — what each missing feed is worth */}
      {d.unlockedBy.length > 0 && (
        <div style={{ borderTop: card(dark).border, paddingTop: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: dark ? '#f1f5f9' : '#0f172a', marginBottom: 6 }}>
            {ar ? 'ماذا يفتح كل مصدر ناقص' : 'What each missing feed is worth'}
          </div>
          {d.unlockedBy.map(u => (
            <div key={u.feed} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 0' }}>
              <span style={{ minWidth: 60, textAlign: 'end', fontWeight: 800, color: STATUS.ok, fontVariantNumeric: 'tabular-nums' }}>
                +{u.points}
              </span>
              <span style={{ flex: 1, color: txt }}>{u.feed}</span>
              <span style={{ fontSize: 10.5, color: faint }}>{u.kpis.join(', ')}</span>
            </div>
          ))}
        </div>
      )}
    </NxCard>
  );
}
