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
import { SEED_KPIS, KpiBand } from './kpi-seed';
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

  it('PRR gate: 2.5 per cell iff PRR≥80% AND RES≥10% (half-up on gates)', () => {
    const b = band('PRR');
    expect(scoreBand(b, 0, { PRR: 0.80, SURVEY_RR: 0.10 })).toBe(2.5);
    expect(scoreBand(b, 0, { PRR: 0.795, SURVEY_RR: 0.10 })).toBe(2.5);  // 79.5 → 80
    expect(scoreBand(b, 0, { PRR: 0.79, SURVEY_RR: 0.50 })).toBe(0);
    expect(scoreBand(b, 0, { PRR: 0.90, SURVEY_RR: 0.09 })).toBe(0);
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

  it('Net Points example: perfect agent ≈ 130 (skill §4 max)', () => {
    const total =
      scoreBand(band('QUALITY'), 0.97)! +           // 30
      scoreBand(band('PRR'), 0, { PRR: 0.9, SURVEY_RR: 0.2 })! * 2 + // 5
      scoreBand(band('AHT'), 40 / 24)! +            // 10
      scoreBand(band('FCR'), 0.9)! +                // 20
      scoreBand(band('PRODUCTIVITY'), 0.93)! +      // 15
      scoreBand(band('CTR'), 0.97)! +               // 10
      scoreBand(band('QUIZ'), 1.0)! +               // 10
      scoreBand(band('COMMON_MISTAKES'), 0)! +      // 15
      scoreBand(band('RESPONSE_TIME'), 0.5 / 24)!;  // 15
    expect(total).toBe(130);
  });

  it('mandatory clarifications encoded: PRR=Yes÷Contacts, SURVEY_RR separate, FCR=Closed÷Total, AHT weighted, CTR direction_confirmed:false', () => {
    const f = (c: string) => SEED_KPIS.find((k) => k.code === c)!;
    expect(f('PRR').definition['mandatory_clarification']).toMatch(/Survey Yes Count ÷ Total Contacts/);
    expect(f('SURVEY_RR').definition['mandatory_clarification']).toMatch(/SEPARATE KPIs/);
    expect(f('FCR').formulaText).toMatch(/Closed/);
    expect(f('AHT').formulaText).toMatch(/never average-of-averages/);
    expect(f('CTR').definition['direction_confirmed']).toBe(false);
    expect(f('PRODUCTIVITY').definition['sick_gt2_quirk']).toMatch(/NO penalty for sick>2/);
  });
});

describe('KPI Registry — migration SQL band JSON equals kpi-seed.ts (what the live DB got is what we tested)', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../../../database/migrations/080_kpi_registry.sql'),
    'utf8',
  );

  const extract = (marker: string): Record<string, any> => {
    const out: Record<string, any> = {};
    const re = new RegExp(`-- ${marker} (\\w+)\\s*\\n\\s*'((?:[^']|'')*)'::jsonb`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) out[m[1]] = JSON.parse(m[2].replace(/''/g, "'"));
    return out;
  };

  it('every seeded band in SQL deep-equals the TS constant', () => {
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
});
