/**
 * KPI Registry seed — the reverse-engineered scorecard rulebook, 1:1 with
 * `.claude/skills/scorecard-builder` (SKILL.md + reference/scoring-bands.md +
 * reference/rules-confirmed.md). Bands decoded from the IF-formulas of the
 * Director's real 2026 template (`My work/OPS/Score Card 2026/*.xlsx`).
 *
 * This constant is the single TS source for the seed; migration
 * `database/migrations/080_kpi_registry.sql` embeds the SAME JSON (a jest spec
 * asserts SQL ↔ TS parity, and a scoring spec asserts the bands reproduce the
 * skill's documented points).
 *
 * Value conventions (same as the skill / template):
 *  - percentage KPIs arrive as FRACTIONS (0.95) and are rounded HALF-UP to an
 *    integer percent before banding (89.5→90, 89.4→89) — `Math.round(v*100)`.
 *  - AHT and Response Time arrive as Excel DAY-FRACTIONS (1h = 1/24).
 *  - Common Mistakes arrives as a COUNT.
 */

export interface KpiBand {
  type: 'threshold_pct' | 'threshold_hours' | 'gate' | 'linear_count' | 'deduction' | 'info';
  rounding?: 'half_up_pct';
  transform?: 'dayfrac_to_hours';
  bands?: Array<{ gte?: number; gt?: number; lte?: number; eq?: number; points: number }>;
  default?: number;
  // gate type
  gates?: Array<{ metric: string; gte: number }>;
  pass_points?: number;
  cells?: string[];
  // linear_count type
  base?: number;
  per_unit?: number;
  // deduction type
  points_if_missed?: number;
  routed_via?: string;
  [k: string]: unknown;
}

/** A per-function config override (only AHT/Response-Time band shapes differ by function). */
export interface SeedKpiFunctionConfig {
  functionName: string;
  weight: number;
  target: number | null;
  band: KpiBand | null;
}

export interface SeedKpi {
  code: string;
  nameEn: string;
  nameAr: string;
  definition: Record<string, unknown>;
  formulaText: string;
  direction: 'higher_better' | 'lower_better';
  unit: string;
  source: string;
  attributionRule: string;
  active: boolean;
  /**
   * MAX-POINTS weight = the KPI's built-in contribution to Net Points, decoded
   * from the Director's SC-sheet formulas (col H = K+N+O+Q+S+U+W+Y+AA+AG).
   * Quality 30 · PRR 2.5 (+2.5 bonus cell) · AHT 15 (Email 10) · FCR 20 ·
   * Productivity 15 · CTR 10 · Quiz 10 · Common Mistakes 15 · Response Time 15.
   * SURVEY_RR/COMMITMENT/CSAT/NPS/INCIDENTS/ATTENDANCE = 0 (NOT summed into Net Points).
   */
  weight: number;
  target: number | null;
  band: KpiBand | null;
  /** Extra per-function config rows (function-specific band shape/max). */
  functionOverrides?: SeedKpiFunctionConfig[];
}

export const SEED_KPIS: SeedKpi[] = [
  {
    code: 'QUALITY',
    nameEn: 'Quality (QA)',
    nameAr: 'الجودة',
    definition: {
      notes: 'QA arrives as a ready percentage from the approved Quality report — do not recompute.',
      bar: 'Full 30 points at ≥95% — UNIFORM across ALL functions. Decoded from the Director\'s Jan–June 2026 SC sheets, cell K14 = IF(J14>=95%,30, IF(90%<=J14<95%,20, IF(80%<=J14<90%,10, IF(65%<=J14<=80%,−10, IF(J14<65%,−20))))). 80% is only the +10 band, NOT the full-points bar. Byte-identical every function/month — no ambiguity.',
      missing_month: 'empty QA month → substitute the bar (max score) per skill §7',
      matching: 'by employee ID',
      source_evidence: 'new folder/Scorecard 2026/KPI_Rules_Decoded_From_Sheets.md §Q3 (SC!K14)',
    },
    formulaText: 'QA% imported as final percentage from approved Quality report; round-half-up to integer; UNIFORM band (SC!K14 IF): >=95→30, 90–94→20, 80–89→10, 65–79→−10, <65→−20 (max 30)',
    direction: 'higher_better',
    unit: '%',
    source: 'QA file (user-provided monthly Quality report)',
    attributionRule: 'per agent per week by employee ID',
    active: true,
    weight: 30,
    target: 95,
    band: { type: 'threshold_pct', rounding: 'half_up_pct', bands: [{ gte: 95, points: 30 }, { gte: 90, points: 20 }, { gte: 80, points: 10 }, { gte: 65, points: -10 }], default: -20 },
  },
  {
    code: 'PRR',
    nameEn: 'Positive Response Rate',
    nameAr: 'معدل الرد الإيجابي',
    definition: {
      denominator: 'survey_responses',
      mandatory_clarification: 'PRR rate (BRR) = Survey Yes ÷ (Yes+No survey responses) — the POSITIVE rate AMONG RESPONDERS, NOT ÷ total contacts. Decoded from the Director\'s Jan–June 2026 SC sheets: N14 (PRR Points)=IF(AND(M14>=80%,L14>=10%),2.5,0), O14 (PRR Bonus)=IF(AND(L14>=10%,M14>=80%),2.5,0); M14=PRR rate=Yes/(Yes+No responses), L14=Response Rate=responses/contacts. Raw PRR tab confirms BRR=Yes/responses (e.g. 18/20=0.90). All 6 workbooks byte-identical.',
      direction_confirmed: true,
      response_rate_gate: 'Survey Response Rate (RES) = responses ÷ contacts is a SEPARATE column (see SURVEY_RR), used ONLY as the ≥10% eligibility gate for PRR — never mixed into the PRR rate.',
      cells: 'two template cells (PRR Points col N + PRR Bonus col O), each 2.5 when BOTH gates pass (BRR≥80% AND RES≥10%) → total max 5',
      store: ['survey_yes', 'survey_no', 'survey_responses', 'total_contacts', 'brr_pct', 'res_pct', 'prr_points', 'prr_bonus'],
      source_evidence: 'new folder/Scorecard 2026/KPI_Rules_Decoded_From_Sheets.md §Q1 (SC!N14/O14 + raw PRR tab)',
    },
    formulaText: 'PRR rate (BRR) = Survey Yes ÷ (Yes+No responses) [NOT ÷ contacts]; PRR Points = 2.5 if BRR≥80% AND RES≥10% else 0; PRR Bonus = same gate → another 2.5 (both pass = max 5). RES = responses÷contacts (SURVEY_RR) is the ≥10% gate only.',
    direction: 'higher_better',
    unit: '%',
    source: 'Sprinklr survey (Yes/No able-to-resolve + response count); fallback Ameyo feedback1',
    attributionRule: 'per agent per week by agent name (space/spelling-tolerant)',
    active: true,
    weight: 2.5,
    target: 80,
    band: { type: 'gate', rounding: 'half_up_pct', gates: [{ metric: 'PRR', gte: 80 }, { metric: 'SURVEY_RR', gte: 10 }], pass_points: 2.5, cells: ['PRR Points', 'PRR Bonus'], default: 0 },
  },
  {
    code: 'SURVEY_RR',
    nameEn: 'Survey Response Rate (RES)',
    nameAr: 'معدل الاستجابة للاستبيان',
    definition: {
      mandatory_clarification: 'Survey Response Rate % = (Survey Yes + Survey No) ÷ Total Contacts × 100 = Total Survey Responses ÷ Total Contacts × 100. PRR and Survey Response Rate are SEPARATE KPIs and must never be mixed.',
      role: 'not independently pointed in the 2026 template; acts as the RES≥10% gate inside PRR scoring',
    },
    formulaText: 'Survey RR% = (Yes + No) ÷ Total Contacts × 100; no standalone points — gates PRR (RES ≥ 10%)',
    direction: 'higher_better',
    unit: '%',
    source: 'Sprinklr survey export (Yes/No counts) ÷ total contacts',
    attributionRule: 'per agent per week by agent name',
    active: true,
    weight: 0,
    target: 10,
    band: { type: 'info', rounding: 'half_up_pct' },
  },
  {
    code: 'AHT',
    nameEn: 'Average Handling Time',
    nameAr: 'متوسط وقت المعالجة',
    definition: {
      mandatory_clarification: 'Period AHT must be WEIGHTED from totals (sum handle time ÷ sum contacts handled) — never an average of averages.',
      current_band: 'single 48h threshold on total hours (Director: keep at 48 until Sprinklr revision, 2026-06-17). Spec requires per-function duration bands from historical sheets — not yet extracted per function; flagged.',
      max_points: 'Decoded max points = 15 for voice/chat functions; Email (Mail & NPS) AHT max = 10 (SC!Q = IF(P*24<=48,10,−10) case-SLA, not a time-of-day AHT). Band SHAPE differs by function (chat AHT-seconds, inbound, OMT) — only the Email 10-pt cap is encoded as a function override; the runtime 48h band is the Director-approved simplification pending per-function extraction.',
      value_format: 'Excel day-fraction, cell format [h]:mm:ss',
      voice_source: 'own channel only: Inbound-function ← Inbound.xlsx, Outbound ← Outbound.xlsx',
      chat_source: 'Sprinklr Case-Assignments "Avg. Handling Time" (NOT the "(Case)" variant), weighted by case count',
    },
    formulaText: 'AHT = Σ handle time ÷ Σ contacts handled (weighted, never average-of-averages); score: total hours ≤ 48 → 10 else −10',
    direction: 'lower_better',
    unit: 'hours (from day-fraction)',
    source: 'Ameyo Inbound/Outbound.xlsx (voice); Sprinklr Case-Assignments (CH-WA, Social & Email)',
    attributionRule: 'voice by employee ID from own channel; Sprinklr by Last Engaged User name, weighted by case count',
    active: true,
    weight: 15,
    target: 48,
    band: { type: 'threshold_hours', transform: 'dayfrac_to_hours', bands: [{ lte: 48, points: 10 }], default: -10 },
    functionOverrides: [
      {
        functionName: 'Mail & NPS',
        weight: 10,
        target: 48,
        band: { type: 'threshold_hours', transform: 'dayfrac_to_hours', bands: [{ lte: 48, points: 10 }], default: -10 },
      },
    ],
  },
  {
    code: 'FCR',
    nameEn: 'First Contact Resolution',
    nameAr: 'الحل من أول تواصل',
    definition: {
      mandatory_clarification: 'FCR % = Closed Tickets ÷ Total Tickets × 100. Store total/closed/open/reopened; verify closure qualification, reopen impact, same-agent rule, denominator basis per function — verification pending, flagged.',
      peak_override: 'peak months: Inbound/Outbound/Refund FCR = bar; Sprinklr functions FCR = normal/computed. Bar applies on FINAL row only; weekly rows are real.',
    },
    formulaText: 'FCR% = Closed first-contact ÷ Total × 100; round-half-up; band: ≥85→20, 80–84→10, 75–79→5, <75→−10',
    direction: 'higher_better',
    unit: '%',
    source: 'Sprinklr Case-Assignments "First Contact Closure"; voice functions per historical process',
    attributionRule: 'per agent per week; Sprinklr by name, voice by ID',
    active: true,
    weight: 20,
    target: 85,
    band: { type: 'threshold_pct', rounding: 'half_up_pct', bands: [{ gte: 85, points: 20 }, { gte: 80, points: 10 }, { gte: 75, points: 5 }], default: -10 },
  },
  {
    code: 'PRODUCTIVITY',
    nameEn: 'Productivity',
    nameAr: 'الإنتاجية',
    definition: {
      formula_detail: 'X = Σ daily hours (normal day = 9h; maternity *7 shift codes b7,n7,m7,e7,md7,mn7,ee7 = 7h). Y = X − ShortBreak (Short Break column ONLY). Z = Y/X. Productivity% = IF(sick=0→Z, sick=1→Z−2%, sick=2→Z−5%, else→Z).',
      sick_gt2_quirk: 'the Director\'s sheet IF gives NO penalty for sick>2 (intent was "2+ → −5%") — replicate the IF as written so outputs match the sheet, but flag it. Redesign gated on Director approval — do not activate a new formula automatically.',
      shortbreak_source: 'per FUNCTION per WEEK: Inbound/Refund/Outbound ← Ameyo AGENT_Session_Details; CH-WA/Social/Email ← Sprinklr occupancy/break export',
      on_leave_week: 'WD=0 week = on leave → not scored (blank inputs + WFM note)',
      maternity_agents: 'named mothers on *7 codes: Shaima Saoud, Haya Mohanna',
    },
    formulaText: 'Z = (WD-hours − ShortBreak) ÷ WD-hours; sick penalty: 1→−2%, 2→−5%, >2→none (sheet quirk, replicated as-is); round-half-up; band: ≥91→15, =90→10, =89→5, 87–88→0, ≤86→−15',
    direction: 'higher_better',
    unit: '%',
    source: 'Schedule/Productivity WD blocks + Ameyo AGENT_Session_Details / Sprinklr break export (per function)',
    attributionRule: 'per agent per week by employee ID; Final = whole month',
    active: true,
    weight: 15,
    target: 91,
    band: { type: 'threshold_pct', rounding: 'half_up_pct', bands: [{ gte: 91, points: 15 }, { eq: 90, points: 10 }, { eq: 89, points: 5 }, { lte: 86, points: -15 }], default: 0 },
  },
  {
    code: 'CTR',
    nameEn: 'Contact-to-Ticket Ratio',
    nameAr: 'نسبة التواصل إلى التذاكر',
    definition: {
      mandatory_clarification: 'Business definition supplied: CTR % = Total Contacts ÷ Total Tickets × 100. Store both raw values and the percentage. If a historical sheet uses Tickets ÷ Contacts, document and require approval — never hide or silently reverse the ratio.',
      direction_confirmed: false,
      peak_override: 'peak months: CTR = bar (100% for Sprinklr functions, band bar for voice/Refund); Final row only, weekly rows real',
    },
    formulaText: 'CTR% = Total Contacts ÷ Total Tickets × 100 (ratio direction pending Director confirmation — direction_confirmed:false); round-half-up; band: ≥95→10, 90–94→5, <90→−10',
    direction: 'higher_better',
    unit: '%',
    source: 'Contacts vs tickets created (Sprinklr / Ameyo per function)',
    attributionRule: 'per agent per week',
    active: true,
    weight: 10,
    target: 95,
    band: { type: 'threshold_pct', rounding: 'half_up_pct', bands: [{ gte: 95, points: 10 }, { gte: 90, points: 5 }], default: -10 },
  },
  {
    code: 'QUIZ',
    nameEn: 'Quiz',
    nameAr: 'الاختبار',
    definition: {
      mandatory_clarification: 'Quiz is received as a ready score (fraction pts/100). Convert with the exact historical grid — do not create a new points table unless approved.',
      band_rule: 'Decoded from the Director\'s Jan–June 2026 SC sheets, cell Y14 = IF(AND(X14>=90%,X14<=95%),5, IF(AND(X14>95%,X14<=100%),10, IF(X14<90%,−10,""))). So EXACTLY 95 → 5 points; full 10 requires strictly >95. Byte-identical every function/month — no ambiguity (the earlier "prose says 95–100→10" note is superseded: the sheet IF wins).',
      no_quiz_week: 'weeks with no quiz file → everyone gets the bar (max quiz score)',
      source_evidence: 'new folder/Scorecard 2026/KPI_Rules_Decoded_From_Sheets.md §Q2 (SC!Y14)',
    },
    formulaText: 'Quiz score fraction ×100 round-half-up; band (SC!Y14 IF): >95→10, 90–95→5, <90→−10 (95 exactly → 5; max 10)',
    direction: 'higher_better',
    unit: '%',
    source: 'Weekly MS-Forms quiz exports (Email, Name, Total points/100, function)',
    attributionRule: 'match by email-local OR agent name (space/spelling-tolerant)',
    active: true,
    weight: 10,
    target: 96,
    band: { type: 'threshold_pct', rounding: 'half_up_pct', bands: [{ gt: 95, points: 10 }, { gte: 90, points: 5 }], default: -10 },
  },
  {
    code: 'COMMON_MISTAKES',
    nameEn: 'Common Mistakes',
    nameAr: 'الأخطاء الشائعة',
    definition: {
      quiz_commitment_routing: 'present-but-did-not-solve-quiz penalty (−5) is ROUTED through this column (Common Mistakes = 1 → 15−5 = 10) because Common Mistakes IS in the Net formula while Attendance Score is NOT. On leave that week → no penalty, no note. Final = total quiz-miss weeks.',
    },
    formulaText: 'Score = 15 − (mistake count × 5); 0 mistakes → 15',
    direction: 'lower_better',
    unit: 'count',
    source: 'TL/QA mistake log + quiz-commitment routing',
    attributionRule: 'per agent per week',
    active: true,
    weight: 15,
    target: 0,
    band: { type: 'linear_count', base: 15, per_unit: -5 },
  },
  {
    code: 'RESPONSE_TIME',
    nameEn: 'Response Time (FRT)',
    nameAr: 'وقت الاستجابة الأولى',
    definition: {
      value_format: 'Excel day-fraction (1h = 1/24)',
      note: 'this is the template ResponseTimeScore column (a.k.a. EMAIL_FRT for Social Media & Email); period aggregation weighted like AHT',
    },
    formulaText: 'First Response Time in hours: ≤1h→15, ≤2h→10, ≤4h→5, else −15',
    direction: 'lower_better',
    unit: 'hours (from day-fraction)',
    source: 'Sprinklr Case-Assignments "First Response Time"; CHAT AMEYO FRT for pre-Sprinklr weeks',
    attributionRule: 'per agent per week by name, weighted by case count',
    active: true,
    weight: 15,
    target: 1,
    band: { type: 'threshold_hours', transform: 'dayfrac_to_hours', bands: [{ lte: 1, points: 15 }, { lte: 2, points: 10 }, { lte: 4, points: 5 }], default: -15 },
  },
  {
    code: 'COMMITMENT',
    nameEn: 'Commitment (quiz)',
    nameAr: 'الالتزام',
    definition: {
      rule: 'agent present (WD>0) but did NOT solve that week\'s quiz → −5, routed via COMMON_MISTAKES (+ cell note "didn\'t solve quiz"); on leave → no deduction, no note',
    },
    formulaText: '−5 per quiz-missed week while present; applied through Common Mistakes column',
    direction: 'higher_better',
    unit: 'points',
    source: 'Quiz files vs Productivity WD (presence)',
    attributionRule: 'per agent per week',
    active: true,
    weight: 0,
    target: null,
    band: { type: 'deduction', points_if_missed: -5, routed_via: 'COMMON_MISTAKES' },
  },
  {
    code: 'CSAT',
    nameEn: 'Customer Satisfaction',
    nameAr: 'رضا العملاء',
    definition: { status: 'registered per FINAL master spec §13; NOT scored in the 2026 template — no historical band exists to encode. Bands/weights await Director definition.' },
    formulaText: 'CSAT% (definition and band pending Director — not part of current Net Points)',
    direction: 'higher_better',
    unit: '%',
    source: 'pending (Sprinklr survey / CSAT program)',
    attributionRule: 'pending attribution-rule verification (spec §12: do not score surveys until attribution verified)',
    active: false,
    weight: 0,
    target: null,
    band: null,
  },
  {
    code: 'NPS',
    nameEn: 'Net Promoter Score',
    nameAr: 'صافي نقاط الترويج',
    definition: { status: 'registered per FINAL master spec §13; NOT scored in the 2026 template — no historical band exists to encode. Bands/weights await Director definition.' },
    formulaText: 'NPS = %Promoters − %Detractors (band pending Director — not part of current Net Points)',
    direction: 'higher_better',
    unit: 'score',
    source: 'pending',
    attributionRule: 'pending attribution-rule verification',
    active: false,
    weight: 0,
    target: null,
    band: null,
  },
  {
    code: 'INCIDENTS',
    nameEn: 'Incidents',
    nameAr: 'الحوادث',
    definition: {
      role: 'TRACKED column only (SC col AB Incidents / AC Incidents Score) — NOT summed into Net Points. The Net Points formula (col H = K+N+O+Q+S+U+W+Y+AA+AG) EXCLUDES AC. Encoded weight 0 / non-scoring so it is documented but never inflates the score.',
      source_evidence: 'new folder/Scorecard 2026/KPI_Rules_Decoded_From_Sheets.md §Harvested weights (AC not in H)',
    },
    formulaText: 'Incidents tracked (SC col AC) — NOT part of Net Points (weight 0, non-scoring)',
    direction: 'lower_better',
    unit: 'count',
    source: 'TL/RTA incident log',
    attributionRule: 'per agent per week',
    active: true,
    weight: 0,
    target: null,
    band: { type: 'info' },
  },
  {
    code: 'ATTENDANCE',
    nameEn: 'Attendance',
    nameAr: 'الحضور',
    definition: {
      role: 'TRACKED column only (SC col AD Attendance / AE Attendance Score) — NOT summed into Net Points. The Net Points formula (col H) EXCLUDES AE. Encoded weight 0 / non-scoring so it is documented but never inflates the score.',
      source_evidence: 'new folder/Scorecard 2026/KPI_Rules_Decoded_From_Sheets.md §Harvested weights (AE not in H)',
    },
    formulaText: 'Attendance tracked (SC col AE) — NOT part of Net Points (weight 0, non-scoring)',
    direction: 'higher_better',
    unit: '%',
    source: 'Attendance/roster reconciliation',
    attributionRule: 'per agent per week',
    active: true,
    weight: 0,
    target: null,
    band: { type: 'info' },
  },
];

/**
 * Net Points composition + decoded max-points ceiling (skill §4 / decoded doc).
 * H = K + N + O + Q + S + U + W + Y + AA + AG =
 *   Quality(30) + PRR Points(2.5) + PRR Bonus(2.5) + AHT(15; Email 10) + FCR(20)
 *   + Productivity(15) + CTR(10) + Quiz(10) + Common Mistakes(15) + Response Time(15).
 * Incidents (AC) + Attendance (AE) are TRACKED but NOT in H. Commitment routes via
 * Common Mistakes. Theoretical max = 30+2.5+2.5+15+20+15+10+10+15+15 = 135.
 */
export const NET_POINTS_MAX = 135;
export const NET_POINTS_FORMULA =
  'Net Points = QualityScore(30) + PRR Points(2.5) + PRR Bonus(2.5) + AHTScore(15; Email 10) + FCRScore(20) + ProductivityScore(15) + CTRScore(10) + QuizScore(10) + MistakesScore(15) + ResponseTimeScore(15) (+ CommitmentScore routed via Common Mistakes; Incidents & Attendance tracked but NOT summed). Max = 135.';
