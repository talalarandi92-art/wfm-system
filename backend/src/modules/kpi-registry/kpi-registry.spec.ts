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

/** Per-function band (functionOverrides), same resolution the re-scorer uses. */
const fnBand = (code: string, fn: string): KpiBand => {
  const k = SEED_KPIS.find((s) => s.code === code);
  const ov = k?.functionOverrides?.find((o) => o.functionName.toLowerCase() === fn.toLowerCase());
  const b = ov?.band ?? k?.band;
  if (!b) throw new Error(`no band for ${code}/${fn}`);
  return b;
};

/** m:ss (or h) → Excel day-fraction, the raw format of SC!P / SC!AF. */
const dayfrac = (seconds: number) => seconds / 86400;

describe('KPI Registry — scoring reproduces the skill 1:1', () => {
  // skill: Math.round(v*100) — 89.5→90 up, 89.4→89
  it('round-half-up', () => {
    expect(roundHalfUpPct(0.895)).toBe(90);
    expect(roundHalfUpPct(0.894)).toBe(89);
    expect(roundHalfUpPct(0.8969)).toBe(90);
  });

  it('QUALITY: ≥95→30 · 90–94→20 · 80–89→10 · 65–79→−10 · 1–64→−20 · blank/0 → NOT EVALUATED (null)', () => {
    const b = band('QUALITY');
    expect(scoreBand(b, 0.95)).toBe(30);
    expect(scoreBand(b, 0.945)).toBe(20);   // D-079: 94.5% is NOT 95% — banding is on the raw %
    expect(scoreBand(b, 0.94)).toBe(20);
    expect(scoreBand(b, 0.90)).toBe(20);
    expect(scoreBand(b, 0.895)).toBe(10);   // D-079: 89.5% stays in the 80–89 band
    expect(scoreBand(b, 0.894)).toBe(10);
    expect(scoreBand(b, 0.80)).toBe(10);
    expect(scoreBand(b, 0.79)).toBe(-10);
    expect(scoreBand(b, 0.65)).toBe(-10);
    expect(scoreBand(b, 0.64)).toBe(-20);
    expect(scoreBand(b, 0.01)).toBe(-20);   // 1% still the −20 band
    // DIRECTOR RULE 2026-07-11: blank/zero QA = not evaluated → null (never −20)
    expect(scoreBand(b, 0)).toBeNull();
    expect(scoreBand(b, 0.004)).toBeNull(); // rounds to 0% → not evaluated
    expect(scoreBand(b, NaN)).toBeNull();   // blank raw
  });

  it('QUALITY not applicable to Support/Offline/Team Leader/administrative/Customer Care (Director rule 2026-07-11)', () => {
    for (const fn of ['Support', 'Offline', 'Internship Offline', 'Team Leader', 'Customer Care', 'Administrative', 'إداري']) {
      expect(scoreBand(fnBand('QUALITY', fn), 0.99)).toBeNull(); // even a perfect QA value scores null — no QA evaluation
      const ov = SEED_KPIS.find((k) => k.code === 'QUALITY')!.functionOverrides!.find((o) => o.functionName === fn)!;
      expect(ov.weight).toBe(0); // their Net max excludes Quality's 30
    }
    // other functions untouched
    expect(scoreBand(fnBand('QUALITY', 'CH - WA'), 0.95)).toBe(30);
  });

  it('FCR: ≥85→20 · 80–84→10 · 75–79→5 · <75→−10', () => {
    const b = band('FCR');
    expect(scoreBand(b, 0.85)).toBe(20);
    expect(scoreBand(b, 0.845)).toBe(10);   // D-079: 84.5% is below the 85 bar
    expect(scoreBand(b, 0.84)).toBe(10);
    expect(scoreBand(b, 0.80)).toBe(10);
    expect(scoreBand(b, 0.79)).toBe(5);
    expect(scoreBand(b, 0.75)).toBe(5);
    expect(scoreBand(b, 0.74)).toBe(-10);
  });

  it('PRODUCTIVITY: ≥91→15 · =90→10 · =89→5 · 87–88→0 · ≤86→−15 (discrete steps)', () => {
    const b = band('PRODUCTIVITY');
    expect(scoreBand(b, 0.91)).toBe(15);
    // D-079 + the sheet's DISCRETE productivity steps (=90, =89): a value between the
    // integer steps matches no band and falls to 0 — exactly what the Director's own
    // sheet does (May CH-WA 88.90% was awarded 0 there). Flagged in SCORECARD_PROGRAM §F5.
    expect(scoreBand(b, 0.905)).toBe(0);
    expect(scoreBand(b, 0.889)).toBe(0);
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
    expect(scoreBand(b, 0.895)).toBe(-10);  // D-079: 89.5% is below the 90 bar
    expect(scoreBand(b, 0.894)).toBe(-10);
  });

  it('QUIZ (template IF): >95→10 · 90–95→5 · <90→−10', () => {
    const b = band('QUIZ');
    expect(scoreBand(b, 0.96)).toBe(10);
    expect(scoreBand(b, 0.955)).toBe(10);   // 95.5 → 96 > 95
    expect(scoreBand(b, 0.95)).toBe(5);     // exactly 95 → 5 per template IF
    expect(scoreBand(b, 0.90)).toBe(5);
    expect(scoreBand(b, 0.89)).toBe(-10);
  });

  it('AHT default (NULL-function fallback): total hours ≤48 → 10 else −10 (day-fraction input)', () => {
    const b = band('AHT');
    expect(scoreBand(b, 48 / 24)).toBe(10);   // exactly 48h
    expect(scoreBand(b, 47 / 24)).toBe(10);
    expect(scoreBand(b, 48.5 / 24)).toBe(-10);
  });

  it('AHT CH-WA chat band ($N$4..$N$7 = 9:00/9:30/10:00): ≤9:00→15 · <9:30→10 · <10:00→5 · =10:00→blank(0) · >10:00→−5', () => {
    for (const fn of ['CH - WA', 'Internship CH - WA']) {
      const b = fnBand('AHT', fn);
      expect(scoreBand(b, dayfrac(8 * 60))).toBe(15);       // 8:00
      expect(scoreBand(b, dayfrac(540))).toBe(15);          // exactly 9:00
      expect(scoreBand(b, dayfrac(555))).toBe(10);          // 9:15
      expect(scoreBand(b, dayfrac(570))).toBe(5);           // exactly 9:30 → sheet's ≥$N$5 & <$N$4 branch
      expect(scoreBand(b, dayfrac(590))).toBe(5);           // 9:50
      expect(scoreBand(b, dayfrac(600))).toBe(0);           // exactly 10:00 → sheet blank ⇒ 0
      expect(scoreBand(b, dayfrac(601))).toBe(-5);          // > 10:00
    }
  });

  it('AHT Inbound 6-band ($O$2..$O$8 = 2:30/3:00/4:00/4:30/5:00): <2:30→−10 · <3:00→5 · 3:00–4:00→15 · ≤4:30→10 · <5:00→0 · ≥5:00→blank(0)', () => {
    for (const fn of ['Inbound', 'Internship Inbound']) { // Internship Inbound = MAJORITY band (Jan+June); May-26 email-shaped block flagged as outlier
      const b = fnBand('AHT', fn);
      expect(scoreBand(b, dayfrac(149))).toBe(-10);         // 2:29
      expect(scoreBand(b, dayfrac(150))).toBe(5);           // exactly 2:30
      expect(scoreBand(b, dayfrac(179))).toBe(5);           // 2:59
      expect(scoreBand(b, dayfrac(180))).toBe(15);          // exactly 3:00
      expect(scoreBand(b, dayfrac(240))).toBe(15);          // exactly 4:00
      expect(scoreBand(b, dayfrac(241))).toBe(10);          // 4:01
      expect(scoreBand(b, dayfrac(270))).toBe(10);          // exactly 4:30
      expect(scoreBand(b, dayfrac(280))).toBe(0);           // 4:40
      expect(scoreBand(b, dayfrac(300))).toBe(0);           // 5:00 → sheet blank ⇒ 0
      expect(scoreBand(b, dayfrac(600))).toBe(0);           // ≥5:00 → sheet blank ⇒ 0
    }
  });

  it('AHT OMT 3-band ($O$5/$O$3 = 2:00/3:00): <2:00→10 · 2:00–3:00→5 · >3:00→−5 (max 10)', () => {
    const b = fnBand('AHT', 'OMT');
    expect(scoreBand(b, dayfrac(119))).toBe(10);
    expect(scoreBand(b, dayfrac(120))).toBe(5);             // exactly 2:00
    expect(scoreBand(b, dayfrac(180))).toBe(5);             // exactly 3:00
    expect(scoreBand(b, dayfrac(181))).toBe(-5);
    expect(SEED_KPIS.find((k) => k.code === 'AHT')!.functionOverrides!.find((o) => o.functionName === 'OMT')!.weight).toBe(10);
  });

  it('AHT email-shaped 48h SLA (Mail & NPS, SM&Email, Offline, Internship OMT/Offline): ≤48h→10 else −10, max 10', () => {
    const aht = SEED_KPIS.find((k) => k.code === 'AHT')!;
    for (const fn of ['Mail & NPS', 'Social Media & Email', 'Offline', 'Internship Offline', 'Internship OMT']) {
      const b = fnBand('AHT', fn);
      expect(scoreBand(b, 48 / 24)).toBe(10);
      expect(scoreBand(b, 49 / 24)).toBe(-10);
      expect(aht.functionOverrides!.find((o) => o.functionName === fn)!.weight).toBe(10);
    }
  });

  it('AHT not scored for Refund and the Jan-26 Social Media block (info overrides → null)', () => {
    expect(scoreBand(fnBand('AHT', 'Refund'), dayfrac(200))).toBeNull();
    expect(scoreBand(fnBand('AHT', 'Social Media'), dayfrac(200))).toBeNull();
  });

  it('PRR gate: 2.5 per cell iff BRR≥80% AND RES≥10% (RES=responses÷contacts gate, half-up)', () => {
    const b = band('PRR');
    expect(scoreBand(b, 0, { PRR: 0.80, SURVEY_RR: 0.10 })).toBe(2.5);
    expect(scoreBand(b, 0, { PRR: 0.795, SURVEY_RR: 0.10 })).toBe(0);     // D-079: 79.5% does not clear an 80% gate
    expect(scoreBand(b, 0, { PRR: 0.799, SURVEY_RR: 0.50 })).toBe(0);     // 79.9% likewise
    expect(scoreBand(b, 0, { PRR: 0.79, SURVEY_RR: 0.50 })).toBe(0);      // BRR 79 < 80 bar → fail
    expect(scoreBand(b, 0, { PRR: 0.90, SURVEY_RR: 0.094 })).toBe(0);     // RES 9.4% < 10% gate fails
    expect(scoreBand(b, 0, { PRR: 0.80, SURVEY_RR: 0.10 })).toBe(2.5);    // exact edges still pass (float-noise tolerance)
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

  it('RESPONSE_TIME default (email shape, = Mail & NPS / SM&Email sheet blocks): ≤1h→15 · ≤2h→10 · ≤4h→5 · else −15', () => {
    const b = band('RESPONSE_TIME');
    expect(scoreBand(b, 1 / 24)).toBe(15);
    expect(scoreBand(b, 2 / 24)).toBe(10);
    expect(scoreBand(b, 3 / 24)).toBe(5);
    expect(scoreBand(b, 5 / 24)).toBe(-15);
    // email-shaped functions use the default (no override needed)
    expect(scoreBand(fnBand('RESPONSE_TIME', 'Mail & NPS'), 1 / 24)).toBe(15);
    expect(scoreBand(fnBand('RESPONSE_TIME', 'Social Media & Email'), 5 / 24)).toBe(-15);
  });

  it('RESPONSE_TIME chat band ($AF$3/$AF$4 = 0:35/0:40): ≤35s→10 · <40s→5 · =40s→blank(0) · >40s→−10 (max 10)', () => {
    for (const fn of ['CH - WA', 'Internship CH - WA']) {
      const b = fnBand('RESPONSE_TIME', fn);
      expect(scoreBand(b, dayfrac(30))).toBe(10);
      expect(scoreBand(b, dayfrac(35))).toBe(10);           // exactly 0:35
      expect(scoreBand(b, dayfrac(38))).toBe(5);
      expect(scoreBand(b, dayfrac(40))).toBe(0);            // exactly 0:40 → sheet blank ⇒ 0
      expect(scoreBand(b, dayfrac(41))).toBe(-10);
      expect(SEED_KPIS.find((k) => k.code === 'RESPONSE_TIME')!.functionOverrides!.find((o) => o.functionName === fn)!.weight).toBe(10);
    }
  });

  it('RESPONSE_TIME Social Media 5-band ($AF$5..$AF$8 = 10/15/20/30 min): ≤10m→15 · ≤15m→10 · ≤20m→5 · ≤30m→−5 · else −15', () => {
    const b = fnBand('RESPONSE_TIME', 'Social Media');
    expect(scoreBand(b, dayfrac(600))).toBe(15);
    expect(scoreBand(b, dayfrac(900))).toBe(10);
    expect(scoreBand(b, dayfrac(1200))).toBe(5);
    expect(scoreBand(b, dayfrac(1800))).toBe(-5);
    expect(scoreBand(b, dayfrac(1801))).toBe(-15);
  });

  it('RESPONSE_TIME not scored for Inbound/Internship Inbound/OMT/Refund (info overrides → null)', () => {
    for (const fn of ['Inbound', 'Internship Inbound', 'OMT', 'Refund']) {
      expect(scoreBand(fnBand('RESPONSE_TIME', fn), dayfrac(60))).toBeNull();
    }
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

  it('Email (Mail & NPS) AHT max = 10, chat/inbound AHT max = 15 (AHT/RT/QUALITY-applicability differ by function)', () => {
    const aht = SEED_KPIS.find((k) => k.code === 'AHT')!;
    expect(aht.weight).toBe(15);                       // default (voice/chat)
    const email = aht.functionOverrides?.find((o) => o.functionName === 'Mail & NPS');
    expect(email).toBeDefined();
    expect(email!.weight).toBe(10);                    // Email case-SLA cap
    expect(aht.functionOverrides!.find((o) => o.functionName === 'CH - WA')!.weight).toBe(15);
    expect(aht.functionOverrides!.find((o) => o.functionName === 'Inbound')!.weight).toBe(15);
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

describe('KPI Registry — migrations 088 + 089 deep-equal kpi-seed.ts (what the live DB got is what we tested)', () => {
  // 088 (authoritative weights re-seed) and 089 (per-function AHT/RT bands +
  // QUALITY not-evaluated rule) are machine-generated from kpi-seed.ts and are
  // the seeds actually applied to the live DB (via direct pg). 089 OVERLAYS 088
  // for the QUALITY / AHT / RESPONSE_TIME codes (idempotent ON CONFLICT UPDATE),
  // so parity is asserted against 088-with-089-overlaid.
  const sql088 = fs.readFileSync(
    path.join(__dirname, '../../../../database/migrations/088_kpi_registry_weights.sql'),
    'utf8',
  );
  const sql089 = fs.readFileSync(
    path.join(__dirname, '../../../../database/migrations/089_kpi_aht_rt_function_bands.sql'),
    'utf8',
  );

  const extract = (sql: string, marker: string): Record<string, any> => {
    const out: Record<string, any> = {};
    const re = new RegExp(`-- ${marker} (\\w+)\\s*\\n\\s*'((?:[^']|'')*)'::jsonb`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) out[m[1]] = JSON.parse(m[2].replace(/''/g, "'"));
    return out;
  };
  /** 088 map with 089 rows overlaid (what the DB holds after both applied). */
  const overlaid = (marker: string) => ({ ...extract(sql088, marker), ...extract(sql089, marker) });

  it('every NULL-function band in SQL (088 overlaid by 089) deep-equals the TS constant', () => {
    const sqlBands = overlaid('BAND');
    const withBands = SEED_KPIS.filter((k) => k.band !== null);
    expect(Object.keys(sqlBands).sort()).toEqual(withBands.map((k) => k.code).sort());
    for (const k of withBands) expect(sqlBands[k.code]).toEqual(k.band);
  });

  it('every seeded definition in SQL (088 overlaid by 089) deep-equals the TS constant', () => {
    const sqlDefs = overlaid('DEF');
    expect(Object.keys(sqlDefs).sort()).toEqual(SEED_KPIS.map((k) => k.code).sort());
    for (const k of SEED_KPIS) expect(sqlDefs[k.code]).toEqual(k.definition);
  });

  it('every KPI weight (max-points) in SQL equals the TS weight', () => {
    const out: Record<string, number> = {};
    for (const sql of [sql088, sql089]) {
      const re = /-- WT (\w+) ([\d.]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql))) out[m[1]] = Number(m[2]);
    }
    expect(Object.keys(out).sort()).toEqual(SEED_KPIS.map((k) => k.code).sort());
    for (const k of SEED_KPIS) expect(out[k.code]).toBe(k.weight);
  });

  it('089 carries EVERY functionOverride of QUALITY/AHT/RESPONSE_TIME with byte-equal band JSON + weight', () => {
    for (const code of ['QUALITY', 'AHT', 'RESPONSE_TIME']) {
      const kpi = SEED_KPIS.find((k) => k.code === code)!;
      for (const ov of kpi.functionOverrides!) {
        const escFn = ov.functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(sql089).toMatch(new RegExp(`-- OV ${code} ${escFn} ${ov.weight}`));
        const m = new RegExp(`-- OVBAND ${code} ${escFn}\\s*\\n\\s*'((?:[^']|'')*)'::jsonb`).exec(sql089);
        expect(m).toBeTruthy();
        expect(JSON.parse(m![1].replace(/''/g, "'"))).toEqual(ov.band);
      }
    }
  });
});
