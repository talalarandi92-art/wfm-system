import { useState, useEffect, useCallback } from 'react';
import {
  Scale, ShieldCheck, Ban, Info, FileText, Target, Layers, BookOpen, CircleSlash,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import {
  useInjectDsStyles, NxPageHeader, NxLoading, NxError, NxCard, card, STATUS,
} from '@/components/ds';
import { StatTile } from '@/components/dazzle';

/* ─── Types (mirror /scorecard/scoring-rules) ─────────────────────────────── */
interface KpiBandDef {
  type: 'threshold_pct' | 'threshold_hours' | 'gate' | 'linear_count' | 'deduction' | 'info';
  transform?: string;
  bands?: { gte?: number; gt?: number; lte?: number; eq?: number; points: number }[];
  default?: number;
  gates?: { metric: string; gte: number }[];
  pass_points?: number;
  base?: number; per_unit?: number;
  points_if_missed?: number;
  note?: string;
}
interface FnOverride { functionName: string; weight: number | null; target: number | null; band: KpiBandDef | null }
interface Kpi {
  kpiCode: string; nameEn: string; nameAr: string; formulaText: string;
  direction: string; unit: string; source: string; attributionRule: string;
  active: boolean; definition: Record<string, any>;
  weight: number; target: number | null; band: KpiBandDef | null;
  functionOverrides: FnOverride[];
}
interface Rulebook {
  netPointsMax: number; netPointsFormula: string; engine: string; provenance: string;
  count: number; kpis: Kpi[];
}

/* ─── Band → human rows ───────────────────────────────────────────────────── */
interface BandRow { cond: string; points: number }
const tone = (p: number): string => (p > 0 ? STATUS.ok : p < 0 ? STATUS.risk : STATUS.warn);

/** Format an hour value as the sheet duration (48h, 9:00, 1:30:00…). */
function fmtDur(hours: number): string {
  const sec = Math.round(hours * 3600);
  if (sec % 3600 === 0) return `${sec / 3600}h`;
  if (sec < 3600) return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Turn a band definition into ordered threshold→points rows + a summary line. */
function describeBand(band: KpiBandDef | null, ar: boolean): { rows: BandRow[]; summary: string | null; kind: string } {
  if (!band) return { rows: [], summary: ar ? 'غير محدد' : 'Not defined', kind: 'none' };
  switch (band.type) {
    case 'info':
      return { rows: [], summary: ar ? 'غير مُقيَّم — للمتابعة فقط' : 'Not evaluated — tracked only', kind: 'info' };
    case 'threshold_pct': {
      const rows = (band.bands ?? []).map((b) => {
        const cond = b.eq !== undefined ? `= ${b.eq}%`
          : b.gt !== undefined ? `> ${b.gt}%`
          : b.gte !== undefined ? `≥ ${b.gte}%`
          : b.lte !== undefined ? `≤ ${b.lte}%` : '—';
        return { cond, points: b.points };
      });
      if (band.default !== undefined) rows.push({ cond: ar ? 'غير ذلك' : 'otherwise', points: band.default });
      return { rows, summary: null, kind: 'pct' };
    }
    case 'threshold_hours': {
      const rows = (band.bands ?? []).map((b) => {
        const cond = b.lte !== undefined ? `≤ ${fmtDur(b.lte)}`
          : b.gte !== undefined ? `≥ ${fmtDur(b.gte)}` : '—';
        return { cond, points: b.points };
      });
      if (band.default !== undefined) rows.push({ cond: ar ? 'غير ذلك' : 'otherwise', points: band.default });
      return { rows, summary: null, kind: 'hours' };
    }
    case 'gate': {
      const g = (band.gates ?? []).map((x) => `${x.metric === 'SURVEY_RR' ? (ar ? 'معدل الاستجابة' : 'Survey RR') : x.metric} ≥ ${x.gte}%`).join(ar ? ' و ' : ' AND ');
      return {
        rows: [
          { cond: g || (ar ? 'اجتياز البوابة' : 'gate pass'), points: band.pass_points ?? 0 },
          { cond: ar ? 'غير ذلك' : 'otherwise', points: band.default ?? 0 },
        ],
        summary: ar ? 'يُطبَّق على خليتين (نقاط + مكافأة)' : 'Applied to two cells (Points + Bonus)',
        kind: 'gate',
      };
    }
    case 'linear_count':
      return {
        rows: [],
        summary: `${band.base ?? 0} ${(band.per_unit ?? 0) < 0 ? '−' : '+'} ${Math.abs(band.per_unit ?? 0)} × ${ar ? 'العدد' : 'count'}`,
        kind: 'count',
      };
    case 'deduction':
      return { rows: [], summary: `${band.points_if_missed ?? 0} ${ar ? 'عند التقصير' : 'if missed'}`, kind: 'deduction' };
    default:
      return { rows: [], summary: null, kind: 'none' };
  }
}

/* ─── KPI display order (matches the Net Points formula, tracked/inactive last) */
const ORDER: Record<string, number> = {
  QUALITY: 1, PRR: 2, AHT: 3, FCR: 4, PRODUCTIVITY: 5, CTR: 6, QUIZ: 7,
  COMMON_MISTAKES: 8, RESPONSE_TIME: 9, SURVEY_RR: 10, COMMITMENT: 11,
  INCIDENTS: 12, ATTENDANCE: 13, CSAT: 14, NPS: 15,
};

/* ─── Small band-table renderer ───────────────────────────────────────────── */
function BandTable({ band, ar, dark }: { band: KpiBandDef | null; ar: boolean; dark: boolean }) {
  const { rows, summary } = describeBand(band, ar);
  return (
    <div>
      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <span style={{ minWidth: 92, color: dark ? '#94a3b8' : '#475569', fontVariantNumeric: 'tabular-nums' }}>{r.cond}</span>
              <span style={{ flex: 1, height: 1, background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }} />
              <span style={{
                fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 42, textAlign: 'end',
                color: tone(r.points),
              }}>{r.points > 0 ? '+' : ''}{r.points}</span>
            </div>
          ))}
        </div>
      )}
      {summary && (
        <div style={{ fontSize: 12, color: dark ? '#94a3b8' : '#64748b', marginTop: rows.length ? 8 : 0, fontStyle: 'italic' }}>{summary}</div>
      )}
    </div>
  );
}

/* ─── KPI card ─────────────────────────────────────────────────────────────── */
function KpiCard({ kpi, ar, dark }: { kpi: Kpi; ar: boolean; dark: boolean }) {
  const scoring = kpi.active && (kpi.weight > 0 || (kpi.band && kpi.band.type !== 'info'));
  const accent = scoring ? '#6366f1' : STATUS.neutral;
  const prov = kpi.definition?.source_evidence as string | undefined;

  return (
    <NxCard dark={dark} pad="0" style={{ overflow: 'hidden' }}>
      {/* header */}
      <div style={{ padding: '14px 18px', borderBottom: card(dark).border, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: `${accent}1f`, color: accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Scale size={16} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: dark ? '#f1f5f9' : '#0f172a', letterSpacing: '-0.02em' }}>
            {ar ? kpi.nameAr : kpi.nameEn}
          </div>
          <div style={{ fontSize: 11, color: dark ? '#64748b' : '#94a3b8', fontFamily: 'monospace' }}>{kpi.kpiCode} · {kpi.unit || '—'} · {kpi.direction === 'higher_better' ? (ar ? 'الأعلى أفضل' : 'higher better') : (ar ? 'الأقل أفضل' : 'lower better')}</div>
        </div>
        {/* weight chip */}
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: scoring ? accent : (dark ? '#475569' : '#94a3b8'), lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {kpi.weight}
          </div>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.06em', color: dark ? '#64748b' : '#94a3b8' }}>{ar ? 'الوزن' : 'max pts'}</div>
        </div>
        {!scoring && (
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: `${STATUS.neutral}18`, color: STATUS.neutral, border: `1px solid ${STATUS.neutral}30`, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <CircleSlash size={11} />{kpi.active ? (ar ? 'للمتابعة' : 'tracked') : (ar ? 'غير مُفعّل' : 'inactive')}
          </span>
        )}
      </div>

      {/* body */}
      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* formula */}
        <div style={{ fontSize: 12.5, lineHeight: 1.55, color: dark ? '#cbd5e1' : '#334155' }}>{kpi.formulaText}</div>

        {/* base band */}
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: dark ? '#64748b' : '#94a3b8', marginBottom: 8 }}>
            {kpi.functionOverrides.length ? (ar ? 'الأساس (كل الوظائف)' : 'Base (all functions)') : (ar ? 'النطاقات → النقاط' : 'Bands → points')}
          </div>
          <BandTable band={kpi.band} ar={ar} dark={dark} />
        </div>

        {/* per-function overrides */}
        {kpi.functionOverrides.length > 0 && (
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: dark ? '#64748b' : '#94a3b8', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Layers size={12} /> {ar ? 'حسب الوظيفة' : 'Per-function bands'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {kpi.functionOverrides.map((ov, i) => {
                const notEval = !ov.band || ov.band.type === 'info';
                return (
                  <div key={i} style={{ borderRadius: 12, padding: '10px 12px', background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', border: card(dark).border }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: dark ? '#e2e8f0' : '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ov.functionName}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: notEval ? STATUS.neutral : '#6366f1', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                        {notEval ? (ar ? '—' : '—') : `${ov.weight ?? 0} ${ar ? 'نقطة' : 'pts'}`}
                      </span>
                    </div>
                    <BandTable band={ov.band} ar={ar} dark={dark} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* source + provenance */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 4, borderTop: card(dark).border }}>
          <div style={{ display: 'flex', gap: 6, fontSize: 11.5, color: dark ? '#94a3b8' : '#64748b' }}>
            <FileText size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span><b style={{ color: dark ? '#cbd5e1' : '#475569' }}>{ar ? 'المصدر:' : 'Source:'}</b> {kpi.source || '—'}</span>
          </div>
          {prov && (
            <div style={{ display: 'flex', gap: 6, fontSize: 11, color: dark ? '#64748b' : '#94a3b8' }}>
              <BookOpen size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontStyle: 'italic' }}>{prov}</span>
            </div>
          )}
        </div>
      </div>
    </NxCard>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────────── */
export default function ScoringRules() {
  useInjectDsStyles();
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  const [data, setData] = useState<Rulebook | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiClient.get<Rulebook>('/scorecard/scoring-rules')
      .then((r) => { setData(r.data); setErr(false); })
      .catch(() => setErr(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const kpis = (data?.kpis ?? []).slice().sort((a, b) => (ORDER[a.kpiCode] ?? 99) - (ORDER[b.kpiCode] ?? 99));
  const scored = kpis.filter((k) => k.active && (k.weight > 0 || (k.band && k.band.type !== 'info')));
  const tracked = kpis.filter((k) => !(k.active && (k.weight > 0 || (k.band && k.band.type !== 'info'))));

  // QUALITY not-evaluated rule + excluded functions
  const quality = kpis.find((k) => k.kpiCode === 'QUALITY');
  const notEvalRule = quality?.definition?.not_evaluated_rule as string | undefined;
  const notApplicable = quality?.definition?.not_applicable_functions as string | undefined;
  const excludedFns = (quality?.functionOverrides ?? [])
    .filter((o) => !o.band || o.band.type === 'info')
    .map((o) => o.functionName);

  return (
    <div className="page-enter" style={{ maxWidth: 1180, margin: '0 auto' }}>
      <NxPageHeader
        icon={Scale}
        title="Scoring Rules" titleAr="قواعد الاحتساب"
        desc="How every KPI is scored — read-only, straight from the validated engine"
        descAr="كيف تُحتسب كل مؤشرات الأداء — للعرض فقط من المحرك المعتمد"
        color="#6366f1" dark={dark} ar={ar} onRefresh={load} refreshing={loading}
      />

      {err && <NxError onRetry={load} dark={dark} ar={ar} />}
      {loading && !data && <NxLoading dark={dark} ar={ar} />}

      {data && (
        <>
          {/* top metrics + engine provenance */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
            <StatTile icon={Target} label={ar ? 'أقصى نقاط' : 'Net Points Max'} num={data.netPointsMax} color="#6366f1" />
            <StatTile icon={ShieldCheck} label={ar ? 'مؤشرات مُحتسَبة' : 'Scored KPIs'} num={scored.length} color={STATUS.ok} />
            <StatTile icon={Info} label={ar ? 'للمتابعة فقط' : 'Tracked / inactive'} num={tracked.length} color={STATUS.neutral} />
          </div>

          {/* ── Open rulings (B7, 2026-07-22) ──────────────────────────────────
              A rulebook that hides its disputes is a brochure. These are the
              points where the CONFIRMED rule and the Director's own SC workbooks
              disagree, measured over the 6 real 2026 workbooks. Nothing here has
              been executed — changing a confirmed rule needs his approval. */}
          <NxCard dark={dark} style={{ marginBottom: 14, borderInlineStart: '3px solid #f59e0b' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <CircleSlash size={16} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12.5, lineHeight: 1.65, color: dark ? '#cbd5e1' : '#334155' }}>
                <b style={{ color: dark ? '#f1f5f9' : '#0f172a' }}>
                  {ar ? 'قرارات معلَّقة تؤثر على كل تقييم قادم' : 'Open rulings that affect every future score'}
                </b>
                <div style={{ marginTop: 6 }}>
                  <b>D-079 ✅ — {ar ? 'أساس التقريب (محسوم):' : 'rounding basis (settled):'}</b>{' '}
                  {ar
                    ? 'محسوم ٢٢ يوليو ٢٠٢٦: التقريب للعرض فقط، والشرائح تُقارَن بالقيمة الخام — مطابقةً لمعادلات دفاترك. كان الفرق ٧١ خلية، ٦٨ منها تمنح نقاطًا أكثر من الدفتر (+٥٥٠ نقطة). بعد التطبيق: صنف «التقريب» صفر في كل الشهور، ودقة المحرّك ٩١٫٢٩٪ ← ٩٢٫٣٣٪.'
                    : 'Settled 2026-07-22: rounding is DISPLAY only, bands compare the raw % — matching your workbook formulas. The old basis disagreed on 71 cells, 68 of them paying MORE (+550 net points). After the change the rounding variance class is zero in every month and engine accuracy went 91.29% → 92.33%.'}
                </div>
                <div style={{ marginTop: 5 }}>
                  <b>D-081a ✅ — {ar ? 'باند مايو (محسوم):' : 'the May band (settled):'}</b>{' '}
                  {ar
                    ? 'مايو ٢٠٢٦ لوظيفة Internship Inbound يُحتسب على شكل الإيميل — قاعدة فترة، لا شذوذ. يناير ويونيو يبقيان على باند الـinbound. النتيجة: مايو ٣٩٫٢٩٪ ← ٧١٫٤٣٪.'
                    : 'May 2026 for Internship Inbound is scored on the email shape — a PERIOD rule, not an outlier. Jan and June keep the inbound band. Result: May 39.29% → 71.43%.'}
                </div>
                <div style={{ marginTop: 6, color: dark ? '#94a3b8' : '#64748b', fontSize: 11.5 }}>
                  {ar
                    ? 'دقة المحرّك الحالية مقابل الدفاتر: ٩٥٫٤٧٪ على الصفوف المشتقّة من معادلات (١٧١ من ٤٥٨ صفًا تحتوي خلايا مكتوبة يدويًا لا يمكن لأي محرّك إعادة إنتاجها). المتبقي ١٣ صفًا فقط، ١١ منها معلّقة على قرار واحد: هل قاعدة «جودة Offline غير منطبقة» تسري للأمام فقط؟'
                    : 'Current engine accuracy vs the workbooks: 95.47% on formula-derivable rows (171 of 458 rows contain hand-typed cells no engine can reproduce). Only 13 rows remain, 11 of them on one open ruling: is the Offline-QA-not-applicable rule forward-only?'}
                </div>
              </div>
            </div>
          </NxCard>

          <NxCard dark={dark} style={{ marginBottom: 14, borderInlineStart: '3px solid #6366f1' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <ShieldCheck size={16} style={{ color: '#6366f1', flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12.5, lineHeight: 1.6, color: dark ? '#cbd5e1' : '#334155' }}>
                <b style={{ color: dark ? '#f1f5f9' : '#0f172a' }}>{data.engine}</b>
                <div style={{ marginTop: 4, color: dark ? '#94a3b8' : '#64748b' }}>{data.provenance}</div>
                <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 11.5, color: dark ? '#64748b' : '#94a3b8' }}>{data.netPointsFormula}</div>
              </div>
            </div>
          </NxCard>

          {/* QA not-evaluated rule + excluded functions */}
          {(notEvalRule || excludedFns.length > 0) && (
            <NxCard dark={dark} style={{ marginBottom: 18, borderInlineStart: `3px solid ${STATUS.warn}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Ban size={15} style={{ color: STATUS.warn }} />
                <span style={{ fontSize: 13, fontWeight: 800, color: dark ? '#f1f5f9' : '#0f172a' }}>
                  {ar ? 'قاعدة الجودة: غير مُقيَّم' : 'Quality — “Not Evaluated” rule'}
                </span>
              </div>
              {notEvalRule && (
                <div style={{ fontSize: 12.5, lineHeight: 1.6, color: dark ? '#cbd5e1' : '#334155', marginBottom: 10 }}>{notEvalRule}</div>
              )}
              {excludedFns.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: dark ? '#64748b' : '#94a3b8', marginBottom: 7 }}>
                    {ar ? 'وظائف بلا تقييم جودة' : 'Functions with no QA evaluation'}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {excludedFns.map((f) => (
                      <span key={f} style={{ fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 20, background: `${STATUS.warn}14`, color: STATUS.warn, border: `1px solid ${STATUS.warn}30` }}>{f}</span>
                    ))}
                  </div>
                  {notApplicable && (
                    <div style={{ fontSize: 11, color: dark ? '#64748b' : '#94a3b8', marginTop: 8, fontStyle: 'italic' }}>{notApplicable}</div>
                  )}
                </div>
              )}
            </NxCard>
          )}

          {/* scored KPIs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {scored.map((k) => <KpiCard key={k.kpiCode} kpi={k} ar={ar} dark={dark} />)}
          </div>

          {/* tracked / inactive */}
          {tracked.length > 0 && (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: dark ? '#475569' : '#94a3b8', margin: '22px 0 12px' }}>
                {ar ? 'مؤشرات للمتابعة (خارج نقاط الأداء)' : 'Tracked / not in Net Points'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {tracked.map((k) => <KpiCard key={k.kpiCode} kpi={k} ar={ar} dark={dark} />)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
