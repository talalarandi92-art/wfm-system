/**
 * Wave B7 — run one SC-sheet row's RAW KPI values through OUR committed engine
 * (kpi-registry scoreBand + SEED_KPIS). Bands are IMPORTED, never re-implemented.
 */
import { scoreBand } from '../kpi-registry/score-band';
import { SEED_KPIS, KpiBand } from '../kpi-registry/kpi-seed';
import { ScRow, ScoreKpi, SCORE_CELLS } from './sc-workbook-reader';

const kpiByCode = new Map(SEED_KPIS.map((k) => [k.code, k]));

/** Resolve the band the engine ACTUALLY scores with: per-function override, else the
 *  KPI default. Exported so the comparator classifies against the same band the
 *  scorer used — classifying against the generic band mislabels every function
 *  that has an override (m089 gave AHT/RT/QUALITY per-function bands). */
export function bandFor(kpiCode: string, functionName: string, periodDate?: string | null): KpiBand | null {
  const kpi = kpiByCode.get(kpiCode);
  if (!kpi) return null;
  const mine = (kpi.functionOverrides ?? []).filter((o) => o.functionName.toLowerCase() === functionName.toLowerCase());
  if (!mine.length) return kpi.band ?? null;

  /* A dated override wins for dates inside its window (D-081a: May-26 Internship
     Inbound was deliberately email-shaped while Jan/June used the inbound band;
     D-081b: the Offline QA not-applicable rule only starts 2026-07-11).
     Asked WITHOUT a period, the rulebook answers "as of today" — the rule in
     force now — not "ignore every dated rule". Falling back to today keeps a
     caller that forgets the period on the CURRENT rule instead of a stale one. */
  const at = periodDate || new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // Kuwait
  const scoped = mine.find((o) =>
    (o.appliesFrom || o.appliesTo) &&
    (!o.appliesFrom || at >= o.appliesFrom) &&
    (!o.appliesTo || at <= o.appliesTo));
  if (scoped) return scoped.band ?? null;

  /* Outside every window: the undated override, else the KPI default. A rule that
     starts on a date has NO pre-history here by design — before it, the KPI's own
     band applies, which is exactly what "forward-only" means. */
  const undated = mine.find((o) => !o.appliesFrom && !o.appliesTo);
  return (undated?.band ?? kpi.band) ?? null;
}

export interface RescoredRow {
  /** our engine's points per score cell (null = not scorable: missing raw / info band) */
  ourPoints: Record<ScoreKpi, number | null>;
  /** Net Points per the decoded composition H = ΣscoreCells (nulls contribute 0, like blank Excel cells) */
  ourNet: number;
}

/** Map the SC-cell descriptor to the registry KPI whose band scores it. */
const CELL_TO_KPI_CODE: Record<ScoreKpi, string> = {
  QUALITY: 'QUALITY',
  PRR_POINTS: 'PRR',
  PRR_BONUS: 'PRR',
  AHT: 'AHT',
  FCR: 'FCR',
  PRODUCTIVITY: 'PRODUCTIVITY',
  CTR: 'CTR',
  QUIZ: 'QUIZ',
  COMMON_MISTAKES: 'COMMON_MISTAKES',
  RESPONSE_TIME: 'RESPONSE_TIME',
};

export function rescoreRow(row: ScRow, periodDate?: string | null): RescoredRow {
  const ourPoints = {} as Record<ScoreKpi, number | null>;

  for (const sc of SCORE_CELLS) {
    const cell = row.cells[sc.kpi];
    const raw = cell.raw;
    const code = CELL_TO_KPI_CODE[sc.kpi];
    const band = bandFor(code, row.functionName, periodDate);

    if (band === null) {
      ourPoints[sc.kpi] = null;
      continue;
    }

    if (sc.kpi === 'PRR_POINTS' || sc.kpi === 'PRR_BONUS') {
      // gate band: aux carries PRR (col M) + SURVEY_RR (col L) as fractions
      const prr = typeof raw === 'number' ? raw : NaN;
      const rr = row.responseRate ?? NaN;
      ourPoints[sc.kpi] = scoreBand(band, prr, { PRR: prr, SURVEY_RR: rr });
      continue;
    }

    if (typeof raw !== 'number') {
      // missing/unreadable raw → not scorable by our engine
      ourPoints[sc.kpi] = null;
      continue;
    }
    ourPoints[sc.kpi] = scoreBand(band, raw);
  }

  // Net = sum of the 10 score cells; a null cell contributes 0, matching the
  // sheet's H = K+N+O+Q+S+U+W+Y+AA+AG where blank cells sum as 0.
  const ourNet = SCORE_CELLS.reduce((sum, sc) => sum + (ourPoints[sc.kpi] ?? 0), 0);
  return { ourPoints, ourNet };
}
