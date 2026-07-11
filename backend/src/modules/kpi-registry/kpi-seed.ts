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
  weight: number;
  target: number | null;
  band: KpiBand | null;
}

export const SEED_KPIS: SeedKpi[] = [
  {
    code: 'QUALITY',
    nameEn: 'Quality (QA)',
    nameAr: 'الجودة',
    definition: {
      notes: 'QA arrives as a ready percentage from the approved Quality report — do not recompute. Empty month → bar (skill documents bar 0.95 for missing-month substitution; scoring-bands lists max-score threshold ambiguity QA 0.80 — flagged, see bar_ambiguity).',
      bar_ambiguity: 'SKILL §7 QA bar=0.80; §7 missing-QA substitution=0.95; scoring-bands bar=0.80 — Director confirmation pending',
      matching: 'by employee ID',
    },
    formulaText: 'QA% imported as final percentage from approved Quality report; round-half-up to integer; band: >=95→30, 90–94→20, 80–89→10, 65–79→−10, <65→−20',
    direction: 'higher_better',
    unit: '%',
    source: 'QA file (user-provided monthly Quality report)',
    attributionRule: 'per agent per week by employee ID',
    active: true,
    weight: 1,
    target: 95,
    band: { type: 'threshold_pct', rounding: 'half_up_pct', bands: [{ gte: 95, points: 30 }, { gte: 90, points: 20 }, { gte: 80, points: 10 }, { gte: 65, points: -10 }], default: -20 },
  },
  {
    code: 'PRR',
    nameEn: 'Positive Response Rate',
    nameAr: 'معدل الرد الإيجابي',
    definition: {
      mandatory_clarification: 'PRR % = Survey Yes Count ÷ Total Contacts × 100. Do NOT calculate PRR as Yes ÷ total survey responses unless a separately approved scorecard version explicitly requires it.',
      note_skill_variant: 'rules-confirmed.md (2026-06-16) records PRR = Yes ÷ responses; the FINAL master spec mandates Yes ÷ Total Contacts — spec wins, discrepancy documented, Director aware.',
      cells: 'two template cells (PRR Points + PRR Bonus), each 2.5 when BOTH gates pass (total 5)',
      store: ['total_contacts', 'survey_yes', 'survey_no', 'total_survey_responses', 'prr_pct', 'prr_points', 'prr_bonus'],
    },
    formulaText: 'PRR% = Survey Yes ÷ Total Contacts × 100; PRR Points = 2.5 if PRR≥80% AND Survey RR≥10% else 0; PRR Bonus = same gate, another 2.5 (both pass = 5)',
    direction: 'higher_better',
    unit: '%',
    source: 'Sprinklr survey (Yes/No able-to-resolve + response count); fallback Ameyo feedback1',
    attributionRule: 'per agent per week by agent name (space/spelling-tolerant)',
    active: true,
    weight: 1,
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
    weight: 1,
    target: 48,
    band: { type: 'threshold_hours', transform: 'dayfrac_to_hours', bands: [{ lte: 48, points: 10 }], default: -10 },
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
    weight: 1,
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
    weight: 1,
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
    weight: 1,
    target: 95,
    band: { type: 'threshold_pct', rounding: 'half_up_pct', bands: [{ gte: 95, points: 10 }, { gte: 90, points: 5 }], default: -10 },
  },
  {
    code: 'QUIZ',
    nameEn: 'Quiz',
    nameAr: 'الاختبار',
    definition: {
      mandatory_clarification: 'Quiz is received as a ready score (fraction pts/100). Convert with the exact historical grid — do not create a new points table unless approved.',
      band_boundary_note: 'template IF (scoring-bands.md) awards 10 only for p>95 and 5 for 90–95 inclusive; SKILL.md prose table says 95–100→10. The IF-formula provenance wins (encoded here: 95→5, 96→10) — flagged for Director.',
      no_quiz_week: 'weeks with no quiz file → everyone gets the bar (max quiz score)',
    },
    formulaText: 'Quiz score fraction ×100 round-half-up; band: >95→10, 90–95→5, <90→−10 (exact template IF)',
    direction: 'higher_better',
    unit: '%',
    source: 'Weekly MS-Forms quiz exports (Email, Name, Total points/100, function)',
    attributionRule: 'match by email-local OR agent name (space/spelling-tolerant)',
    active: true,
    weight: 1,
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
    weight: 1,
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
    weight: 1,
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
    weight: 1,
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
];

/** Net Points composition, for reference (skill §4). */
export const NET_POINTS_FORMULA =
  'Net Points = QualityScore + PRR Points + PRR Bonus + AHTScore + FCRScore + ProductivityScore + CTRScore + QuizScore + MistakesScore + ResponseTimeScore (+ CommitmentScore routed via Common Mistakes). Max ≈ 130.';
