/**
 * Wave B7 — run one SC-sheet row's RAW KPI values through OUR committed engine
 * (kpi-registry scoreBand + SEED_KPIS). Bands are IMPORTED, never re-implemented.
 */
import { scoreBand } from '../kpi-registry/score-band';
import { SEED_KPIS, KpiBand } from '../kpi-registry/kpi-seed';
import { ScRow, ScoreKpi, SCORE_CELLS } from './sc-workbook-reader';

const kpiByCode = new Map(SEED_KPIS.map((k) => [k.code, k]));

function bandFor(kpiCode: string, functionName: string): KpiBand | null {
  const kpi = kpiByCode.get(kpiCode);
  if (!kpi) return null;
  const ov = kpi.functionOverrides?.find((o) => o.functionName.toLowerCase() === functionName.toLowerCase());
  return (ov?.band ?? kpi.band) ?? null;
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

export function rescoreRow(row: ScRow): RescoredRow {
  const ourPoints = {} as Record<ScoreKpi, number | null>;

  for (const sc of SCORE_CELLS) {
    const cell = row.cells[sc.kpi];
    const raw = cell.raw;
    const code = CELL_TO_KPI_CODE[sc.kpi];
    const band = bandFor(code, row.functionName);

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
