/**
 * GATE (wave B1): the KPI Registry reproduces the scorecard-builder skill 1:1.
 *
 *  Part A — scoring parity: seeded band JSON, run through the pure scoreBand
 *  engine, must equal the skill's documented points (scoring-bands.md IF
 *  formulas), incl. boundary values and round-half-up behavior. 30+ assertions.
 *
 *  Part B — SQL ↔ TS parity: the band JSON embedded in migration
 *  080_kpi_registry.sql deep-equals SEED_KPIS (kpi-seed.ts), so what's applied
 *  to the live DB is exactly what these tests prove.
 */
import * as fs from 'fs';
import * as path from 'path';
import { SEED_KPIS, KpiBand, NET_POINTS_MAX } from './kpi-seed';
import { scoreBand, roundHalfUpPct } from './score-band';

const band = (code: string): KpiBand => {
  const k = SEED_KPIS.find((s) => s.code === code);
  if (!k || !k.band) throw new Error(`no band for ${code}`);
  return k.band;
};

describe('KPI Registry — scoring reproduces the skill 1:1', () => {
  // skill: Math.round(v*100) — 89.5→90 up, 89.4→89
  it('round-half-up', () => {
    expect(roundHalfUpPct(0.895)).toBe(90);
    expect(roundHalfUpPct(0.894)).toBe(89);
    expect(roundHalfUpPct(0.8969)).toBe(90);
  });

  it('QUALITY: ≥95→30 · 90–94→20 · 80–89→10 · 65–79→−10 · <65→−20', () => {
    const b = band('QUALITY');
    expect(scoreBand(b, 0.95)).toBe(30);
    expect(scoreBand(b, 0.945)).toBe(30);   // 94.5 → 95 (half-up boundary)
    expect(scoreBand(b, 0.94)).toBe(20);
    expect(scoreBand(b, 0.90)).toBe(20);
    expect(scoreBand(b, 0.895)).toBe(20);   // 89.5 → 90
    expect(scoreBand(b, 0.894)).toBe(10);   // 89.4 → 89
    expect(scoreBand(b, 0.80)).toBe(10);
    expect(scoreBand(b, 0.79)).toBe(-10);
    expect(scoreBand(b, 0.65)).toBe(-10);
    expect(scoreBand(b, 0.64)).toBe(-20);
  });

  it('FCR: ≥85→20 · 80–84→10 · 75–79→5 · <75→−10', () => {
    const b = band('FCR');
    expect(scoreBand(b, 0.85)).toBe(20);
    expect(scoreBand(b, 0.845)).toBe(20);   // 84.5 → 85
    expect(scoreBand(b, 0.84)).toBe(10);
    expect(scoreBand(b, 0.80)).toBe(10);
    expect(scoreBand(b, 0.79)).toBe(5);
    expect(scoreBand(b, 0.75)).toBe(5);
    expect(scoreBand(b, 0.74)).toBe(-10);
  });

  it('PRODUCTIVITY: ≥91→15 · =90→10 · =89→5 · 87–88→0 · ≤86→−15 (discrete steps)', () => {
    const b = band('PRODUCTIVITY');
    expect(scoreBand(b, 0.91)).toBe(15);
    expect(scoreBand(b, 0.905)).toBe(15);   // 90.5 → 91
    expect(scoreBand(b, 0.90)).toBe(10);
    expect(scoreBand(b, 0.89)).toBe(5);
    expect(scoreBand(b, 0.88)).toBe(0);
    expect(scoreBand(b, 0.87)).toBe(0);
    expect(scoreBand(b, 0.86)).toBe(-15);
    expect(scoreBand(b, 0.50)).toBe(-15);
  });

  it('CTR: ≥95→10 · 90–94→5 · <90→−10', () => {
    const b = band('CTR');
    expect(scoreBand(b, 0.95)).toBe(10);
    expect(scoreBand(b, 0.94)).toBe(5);
    expect(scoreBand(b, 0.895)).toBe(5);    // 89.5 → 90
    expect(scoreBand(b, 0.894)).toBe(-10);  // 89.4 → 89
  });

  it('QUIZ (template IF): >95→10 · 90–95→5 · <90→−10', () => {
    const b = band('QUIZ');
    expect(scoreBand(b, 0.96)).toBe(10);
    expect(scoreBand(b, 0.955)).toBe(10);   // 95.5 → 96 > 95
    expect(scoreBand(b, 0.95)).toBe(5);     // exactly 95 → 5 per template IF
    expect(scoreBand(b, 0.90)).toBe(5);
    expect(scoreBand(b, 0.89)).toBe(-10);
  });

  it('AHT: total hours ≤48 → 10 else −10 (day-fraction input)', () => {
    const b = band('AHT');
    expect(scoreBand(b, 48 / 24)).toBe(10);   // exactly 48h
    expect(scoreBand(b, 47 / 24)).toBe(10);
    expect(scoreBand(b, 48.5 / 24)).toBe(-10);
  });

  it('PRR gate: 2.5 per cell iff BRR≥80% AND RES≥10% (RES=responses÷contacts gate, half-up)', () => {
    const b = band('PRR');
    expect(scoreBand(b, 0, { PRR: 0.80, SURVEY_RR: 0.10 })).toBe(2.5);
    expect(scoreBand(b, 0, { PRR: 0.795, SURVEY_RR: 0.10 })).toBe(2.5);  // 79.5 → 80
    expect(scoreBand(b, 0, { PRR: 0.799, SURVEY_RR: 0.50 })).toBe(2.5);   // BRR 79.9 → 80 passes
    expect(scoreBand(b, 0, { PRR: 0.79, SURVEY_RR: 0.50 })).toBe(0);      // BRR 79 < 80 bar → fail
    expect(scoreBand(b, 0, { PRR: 0.90, SURVEY_RR: 0.094 })).toBe(0);     // RES 9.4 → 9 < 10 gate fails
    // both cells (Points + Bonus) passing = 5 total
    const cell = scoreBand(b, 0, { PRR: 0.85, SURVEY_RR: 0.12 })!;
    expect(cell * 2).toBe(5);
  });

  it('COMMON_MISTAKES: 15 − n×5 (quiz-commitment −5 routes here as n+=1)', () => {
    const b = band('COMMON_MISTAKES');
    expect(scoreBand(b, 0)).toBe(15);
    expect(scoreBand(b, 1)).toBe(10);       // one quiz-missed week
    expect(scoreBand(b, 2)).toBe(5);
    expect(scoreBand(b, 4)).toBe(-5);
  });

  it('RESPONSE_TIME: ≤1h→15 · ≤2h→10 · ≤4h→5 · else −15 (day-fraction input)', () => {
    const b = band('RESPONSE_TIME');
    expect(scoreBand(b, 1 / 24)).toBe(15);
    expect(scoreBand(b, 2 / 24)).toBe(10);
    expect(scoreBand(b, 3 / 24)).toBe(5);
    expect(scoreBand(b, 5 / 24)).toBe(-15);
  });

  it('COMMITMENT deduction: −5 when present-but-missed, 0 otherwise', () => {
    const b = band('COMMITMENT');
    expect(scoreBand(b, 1)).toBe(-5);
    expect(scoreBand(b, 0)).toBe(0);
  });

  it('SURVEY_RR is informational (separate KPI, never pointed) and CSAT/NPS are inactive placeholders', () => {
    expect(scoreBand(band('SURVEY_RR'), 0.5)).toBeNull();
    const csat = SEED_KPIS.find((k) => k.code === 'CSAT')!;
    const nps = SEED_KPIS.find((k) => k.code === 'NPS')!;
    expect(csat.active).toBe(false);
    expect(nps.active).toBe(false);
    expect(csat.band).toBeNull();
  });

  it('AUTHORITATIVE weights (max-points, decoded col H): Quality30 PRR2.5 AHT15 FCR20 Prod15 CTR10 Quiz10 Mistakes15 RT15; non-scoring=0', () => {
    const w = (c: string) => SEED_KPIS.find((k) => k.code === c)!.weight;
    expect(w('QUALITY')).toBe(30);
    expect(w('PRR')).toBe(2.5);
    expect(w('AHT')).toBe(15);
    expect(w('FCR')).toBe(20);
    expect(w('PRODUCTIVITY')).toBe(15);
    expect(w('CTR')).toBe(10);
    expect(w('QUIZ')).toBe(10);
    expect(w('COMMON_MISTAKES')).toBe(15);
    expect(w('RESPONSE_TIME')).toBe(15);
    // tracked but NOT summed into Net Points
    for (const c of ['SURVEY_RR', 'COMMITMENT', 'CSAT', 'NPS', 'INCIDENTS', 'ATTENDANCE']) expect(w(c)).toBe(0);
  });

  it('Email (Mail & NPS) AHT max = 10, other-function AHT max = 15 (only AHT/RT differ by function)', () => {
    const aht = SEED_KPIS.find((k) => k.code === 'AHT')!;
    expect(aht.weight).toBe(15);                       // default (voice/chat)
    const email = aht.functionOverrides?.find((o) => o.functionName === 'Mail & NPS');
    expect(email).toBeDefined();
    expect(email!.weight).toBe(10);                    // Email case-SLA cap
  });

  it('Net Points ceiling = 135 (perfect agent), summed from the decoded max-points weights', () => {
    // PRR contributes twice (Points cell + Bonus cell), each = its weight.
    const scoring = ['QUALITY', 'AHT', 'FCR', 'PRODUCTIVITY', 'CTR', 'QUIZ', 'COMMON_MISTAKES', 'RESPONSE_TIME'];
    const w = (c: string) => SEED_KPIS.find((k) => k.code === c)!.weight;
    const max = scoring.reduce((s, c) => s + w(c), 0) + w('PRR') * 2;
    expect(max).toBe(135);
    expect(NET_POINTS_MAX).toBe(135);
    // arithmetic spelled out: 30 + 5 + 15 + 20 + 15 + 10 + 10 + 15 + 15
    expect(30 + 2.5 + 2.5 + 15 + 20 + 15 + 10 + 10 + 15 + 15).toBe(135);
  });

  it('corrected clarifications encoded: PRR=Yes÷responses (NOT contacts), Quiz95=5 cited, QA95=30 uniform, direction_confirmed', () => {
    const f = (c: string) => SEED_KPIS.find((k) => k.code === c)!;
    expect(f('PRR').definition['mandatory_clarification']).toMatch(/Yes ÷ \(Yes\+No survey responses\)/);
    expect(f('PRR').definition['mandatory_clarification']).toMatch(/NOT ÷ total contacts/);
    expect(f('PRR').definition['denominator']).toBe('survey_responses');
    expect(f('PRR').definition['direction_confirmed']).toBe(true);
    expect(f('QUIZ').definition['band_rule']).toMatch(/EXACTLY 95 → 5/);
    expect(f('QUALITY').definition['bar']).toMatch(/≥95%[\s\S]*UNIFORM/);
    // untouched clarifications still intact
    expect(f('SURVEY_RR').definition['mandatory_clarification']).toMatch(/SEPARATE KPIs/);
    expect(f('FCR').formulaText).toMatch(/Closed/);
    expect(f('AHT').formulaText).toMatch(/never average-of-averages/);
    expect(f('CTR').definition['direction_confirmed']).toBe(false);
    expect(f('PRODUCTIVITY').definition['sick_gt2_quirk']).toMatch(/NO penalty for sick>2/);
  });
});

describe('KPI Registry — migration 088 (authoritative re-seed) deep-equals kpi-seed.ts (what the live DB got is what we tested)', () => {
  // 088 is machine-generated from kpi-seed.ts and is the seed actually applied to
  // the live DB (via direct pg). It supersedes the ambiguous 080 seed. Parity here
  // guarantees the corrections proven above are exactly what production received.
  const sql = fs.readFileSync(
    path.join(__dirname, '../../../../database/migrations/088_kpi_registry_weights.sql'),
    'utf8',
  );

  const extract = (marker: string): Record<string, any> => {
    const out: Record<string, any> = {};
    const re = new RegExp(`-- ${marker} (\\w+)\\s*\\n\\s*'((?:[^']|'')*)'::jsonb`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) out[m[1]] = JSON.parse(m[2].replace(/''/g, "'"));
    return out;
  };

  it('every NULL-function band in SQL deep-equals the TS constant', () => {
    const sqlBands = extract('BAND');
    const withBands = SEED_KPIS.filter((k) => k.band !== null);
    expect(Object.keys(sqlBands).sort()).toEqual(withBands.map((k) => k.code).sort());
    for (const k of withBands) expect(sqlBands[k.code]).toEqual(k.band);
  });

  it('every seeded definition in SQL deep-equals the TS constant', () => {
    const sqlDefs = extract('DEF');
    expect(Object.keys(sqlDefs).sort()).toEqual(SEED_KPIS.map((k) => k.code).sort());
    for (const k of SEED_KPIS) expect(sqlDefs[k.code]).toEqual(k.definition);
  });

  it('every KPI weight (max-points) in SQL equals the TS weight', () => {
    const re = /-- WT (\w+) ([\d.]+)/g;
    const out: Record<string, number> = {};
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) out[m[1]] = Number(m[2]);
    expect(Object.keys(out).sort()).toEqual(SEED_KPIS.map((k) => k.code).sort());
    for (const k of SEED_KPIS) expect(out[k.code]).toBe(k.weight);
  });

  it('AHT Email (Mail & NPS) function override present in SQL: weight 10 + band', () => {
    expect(sql).toMatch(/-- OV AHT Mail & NPS 10/);
    const ovBand = /-- OVBAND AHT\s*\n\s*'((?:[^']|'')*)'::jsonb/.exec(sql);
    expect(ovBand).toBeTruthy();
    const email = SEED_KPIS.find((k) => k.code === 'AHT')!.functionOverrides![0];
    expect(JSON.parse(ovBand![1].replace(/''/g, "'"))).toEqual(email.band);
  });
});
