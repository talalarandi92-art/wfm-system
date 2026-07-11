-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 080: Scorecard Program wave B1 — KPI REGISTRY + RULEBOOK DB
--   (FINAL master scorecard spec §13 + §14 partial + Mandatory KPI Clarifications)
--
--   • kpi_registry             — one row per KPI (code, names, definition JSONB,
--       formula text, direction, unit, source, attribution rule, active).
--   • kpi_function_config      — per-KPI banding/weight/target rows; function_name
--       NULL = all functions (most-specific wins, like break_policies_v2).
--       band JSONB = the EXACT point bands decoded from the Director's 2026
--       template IF-formulas (scorecard-builder skill). Round-half-up applies
--       to every % KPI before banding.
--   • scorecard_formula_versions — append-only formula history (trigger blocks
--       UPDATE/DELETE). "Do not silently replace old formulas" (spec §13).
--
--   ADDITIVE ONLY: nothing reads these tables yet (wave B6 will). Seed is
--   idempotent (ON CONFLICT / NOT EXISTS). Source of truth for the seeded
--   bands: backend/src/modules/kpi-registry/kpi-seed.ts — a jest spec asserts
--   SQL ↔ TS parity and that the bands reproduce the skill's documented points.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. KPI registry ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_registry (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kpi_code         VARCHAR(40)  NOT NULL,
  name_en          VARCHAR(150) NOT NULL,
  name_ar          VARCHAR(150),
  definition       JSONB NOT NULL DEFAULT '{}'::jsonb,
  formula_text     TEXT NOT NULL,
  direction        VARCHAR(15) NOT NULL CHECK (direction IN ('higher_better','lower_better')),
  unit             VARCHAR(40),
  source           TEXT,
  attribution_rule TEXT,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_kpi_registry_code UNIQUE (tenant_id, kpi_code)
);

-- ─── 2. Per-function config (band/weight/target) — NULL function = all ─────
CREATE TABLE IF NOT EXISTS kpi_function_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kpi_id        UUID NOT NULL REFERENCES kpi_registry(id) ON DELETE CASCADE,
  function_name VARCHAR(150),                       -- CANON function name; NULL = all functions
  function_key  TEXT GENERATED ALWAYS AS (COALESCE(function_name, '*')) STORED,
  weight        NUMERIC(8,3) NOT NULL DEFAULT 1,
  target        NUMERIC(12,3),
  band          JSONB,                              -- point bands (see kpi-seed.ts KpiBand)
  applies_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_kpi_function_config UNIQUE (tenant_id, kpi_id, function_key, applies_from)
);
CREATE INDEX IF NOT EXISTS ix_kpi_function_config_kpi ON kpi_function_config (kpi_id, applies_from DESC);

-- ─── 3. Formula versions — immutable append-only ───────────────────────────
CREATE TABLE IF NOT EXISTS scorecard_formula_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version        INT  NOT NULL,
  kpi_id         UUID REFERENCES kpi_registry(id) ON DELETE CASCADE,  -- NULL = global scorecard rule
  change_note    TEXT NOT NULL,
  definition     JSONB NOT NULL,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_scorecard_formula_versions_kpi ON scorecard_formula_versions (kpi_id, version DESC);

CREATE OR REPLACE FUNCTION scorecard_formula_versions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'scorecard_formula_versions is append-only (spec §13: historical KPI rules must remain available)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scorecard_formula_versions_immutable ON scorecard_formula_versions;
CREATE TRIGGER trg_scorecard_formula_versions_immutable
  BEFORE UPDATE OR DELETE ON scorecard_formula_versions
  FOR EACH ROW EXECUTE FUNCTION scorecard_formula_versions_immutable();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. SEED — the reverse-engineered rulebook (generated from kpi-seed.ts).
--    Bands are the exact 2026 template IF-formulas. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
-- ─── QUALITY ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'QUALITY', 'Quality (QA)', 'الجودة',
  -- DEF QUALITY
  '{"notes":"QA arrives as a ready percentage from the approved Quality report — do not recompute. Empty month → bar (skill documents bar 0.95 for missing-month substitution; scoring-bands lists max-score threshold ambiguity QA 0.80 — flagged, see bar_ambiguity).","bar_ambiguity":"SKILL §7 QA bar=0.80; §7 missing-QA substitution=0.95; scoring-bands bar=0.80 — Director confirmation pending","matching":"by employee ID"}'::jsonb,
  'QA% imported as final percentage from approved Quality report; round-half-up to integer; band: >=95→30, 90–94→20, 80–89→10, 65–79→−10, <65→−20', 'higher_better', '%', 'QA file (user-provided monthly Quality report)', 'per agent per week by employee ID', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO NOTHING;

INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 1, 95, 
  -- BAND QUALITY
  '{"type":"threshold_pct","rounding":"half_up_pct","bands":[{"gte":95,"points":30},{"gte":90,"points":20},{"gte":80,"points":10},{"gte":65,"points":-10}],"default":-20}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'QUALITY'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO NOTHING;

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id, 1, r.id, 'v1 seed — reverse-engineered 2026 template rulebook (scorecard-builder skill)',
  jsonb_build_object('formula_text', r.formula_text, 'band', (SELECT band FROM kpi_function_config c WHERE c.kpi_id = r.id AND c.function_name IS NULL), 'definition', r.definition),
  DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'QUALITY'
  AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.version = 1);

-- ─── PRR ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'PRR', 'Positive Response Rate', 'معدل الرد الإيجابي',
  -- DEF PRR
  '{"mandatory_clarification":"PRR % = Survey Yes Count ÷ Total Contacts × 100. Do NOT calculate PRR as Yes ÷ total survey responses unless a separately approved scorecard version explicitly requires it.","note_skill_variant":"rules-confirmed.md (2026-06-16) records PRR = Yes ÷ responses; the FINAL master spec mandates Yes ÷ Total Contacts — spec wins, discrepancy documented, Director aware.","cells":"two template cells (PRR Points + PRR Bonus), each 2.5 when BOTH gates pass (total 5)","store":["total_contacts","survey_yes","survey_no","total_survey_responses","prr_pct","prr_points","prr_bonus"]}'::jsonb,
  'PRR% = Survey Yes ÷ Total Contacts × 100; PRR Points = 2.5 if PRR≥80% AND Survey RR≥10% else 0; PRR Bonus = same gate, another 2.5 (both pass = 5)', 'higher_better', '%', 'Sprinklr survey (Yes/No able-to-resolve + response count); fallback Ameyo feedback1', 'per agent per week by agent name (space/spelling-tolerant)', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO NOTHING;

INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 1, 80, 
  -- BAND PRR
  '{"type":"gate","rounding":"half_up_pct","gates":[{"metric":"PRR","gte":80},{"metric":"SURVEY_RR","gte":10}],"pass_points":2.5,"cells":["PRR Points","PRR Bonus"],"default":0}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'PRR'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO NOTHING;

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id, 1, r.id, 'v1 seed — reverse-engineered 2026 template rulebook (scorecard-builder skill)',
  jsonb_build_object('formula_text', r.formula_text, 'band', (SELECT band FROM kpi_function_config c WHERE c.kpi_id = r.id AND c.function_name IS NULL), 'definition', r.definition),
  DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'PRR'
  AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.version = 1);

-- ─── SURVEY_RR ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'SURVEY_RR', 'Survey Response Rate (RES)', 'معدل الاستجابة للاستبيان',
  -- DEF SURVEY_RR
  '{"mandatory_clarification":"Survey Response Rate % = (Survey Yes + Survey No) ÷ Total Contacts × 100 = Total Survey Responses ÷ Total Contacts × 100. PRR and Survey Response Rate are SEPARATE KPIs and must never be mixed.","role":"not independently pointed in the 2026 template; acts as the RES≥10% gate inside PRR scoring"}'::jsonb,
  'Survey RR% = (Yes + No) ÷ Total Contacts × 100; no standalone points — gates PRR (RES ≥ 10%)', 'higher_better', '%', 'Sprinklr survey export (Yes/No counts) ÷ total contacts', 'per agent per week by agent name', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO NOTHING;

INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 0, 10, 
  -- BAND SURVEY_RR
  '{"type":"info","rounding":"half_up_pct"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'SURVEY_RR'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO NOTHING;

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id, 1, r.id, 'v1 seed — reverse-engineered 2026 template rulebook (scorecard-builder skill)',
  jsonb_build_object('formula_text', r.formula_text, 'band', (SELECT band FROM kpi_function_config c WHERE c.kpi_id = r.id AND c.function_name IS NULL), 'definition', r.definition),
  DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'SURVEY_RR'
  AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.version = 1);

-- ─── AHT ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'AHT', 'Average Handling Time', 'متوسط وقت المعالجة',
  -- DEF AHT
  '{"mandatory_clarification":"Period AHT must be WEIGHTED from totals (sum handle time ÷ sum contacts handled) — never an average of averages.","current_band":"single 48h threshold on total hours (Director: keep at 48 until Sprinklr revision, 2026-06-17). Spec requires per-function duration bands from historical sheets — not yet extracted per function; flagged.","value_format":"Excel day-fraction, cell format [h]:mm:ss","voice_source":"own channel only: Inbound-function ← Inbound.xlsx, Outbound ← Outbound.xlsx","chat_source":"Sprinklr Case-Assignments \"Avg. Handling Time\" (NOT the \"(Case)\" variant), weighted by case count"}'::jsonb,
  'AHT = Σ handle time ÷ Σ contacts handled (weighted, never average-of-averages); score: total hours ≤ 48 → 10 else −10', 'lower_better', 'hours (from day-fraction)', 'Ameyo Inbound/Outbound.xlsx (voice); Sprinklr Case-Assignments (CH-WA, Social & Email)', 'voice by employee ID from own channel; Sprinklr by Last Engaged User name, weighted by case count', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO NOTHING;

INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 1, 48, 
  -- BAND AHT
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":48,"points":10}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO NOTHING;

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id, 1, r.id, 'v1 seed — reverse-engineered 2026 template rulebook (scorecard-builder skill)',
  jsonb_build_object('formula_text', r.formula_text, 'band', (SELECT band FROM kpi_function_config c WHERE c.kpi_id = r.id AND c.function_name IS NULL), 'definition', r.definition),
  DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
  AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.version = 1);

-- ─── FCR ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'FCR', 'First Contact Resolution', 'الحل من أول تواصل',
  -- DEF FCR
  '{"mandatory_clarification":"FCR % = Closed Tickets ÷ Total Tickets × 100. Store total/closed/open/reopened; verify closure qualification, reopen impact, same-agent rule, denominator basis per function — verification pending, flagged.","peak_override":"peak months: Inbound/Outbound/Refund FCR = bar; Sprinklr functions FCR = normal/computed. Bar applies on FINAL row only; weekly rows are real."}'::jsonb,
  'FCR% = Closed first-contact ÷ Total × 100; round-half-up; band: ≥85→20, 80–84→10, 75–79→5, <75→−10', 'higher_better', '%', 'Sprinklr Case-Assignments "First Contact Closure"; voice functions per historical process', 'per agent per week; Sprinklr by name, voice by ID', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO NOTHING;

INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 1, 85, 
  -- BAND FCR
  '{"type":"threshold_pct","rounding":"half_up_pct","bands":[{"gte":85,"points":20},{"gte":80,"points":10},{"gte":75,"points":5}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'FCR'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO NOTHING;

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id, 1, r.id, 'v1 seed — reverse-engineered 2026 template rulebook (scorecard-builder skill)',
  jsonb_build_object('formula_text', r.formula_text, 'band', (SELECT band FROM kpi_function_config c WHERE c.kpi_id = r.id AND c.function_name IS NULL), 'definition', r.definition),
  DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'FCR'
  AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.version = 1);

-- ─── PRODUCTIVITY ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'PRODUCTIVITY', 'Productivity', 'الإنتاجية',
  -- DEF PRODUCTIVITY
  '{"formula_detail":"X = Σ daily hours (normal day = 9h; maternity *7 shift codes b7,n7,m7,e7,md7,mn7,ee7 = 7h). Y = X − ShortBreak (Short Break column ONLY). Z = Y/X. Productivity% = IF(sick=0→Z, sick=1→Z−2%, sick=2→Z−5%, else→Z).","sick_gt2_quirk":"the Director''s sheet IF gives NO penalty for sick>2 (intent was \"2+ → −5%\") — replicate the IF as written so outputs match the sheet, but flag it. Redesign gated on Director approval — do not activate a new formula automatically.","shortbreak_source":"per FUNCTION per WEEK: Inbound/Refund/Outbound ← Ameyo AGENT_Session_Details; CH-WA/Social/Email ← Sprinklr occupancy/break export","on_leave_week":"WD=0 week = on leave → not scored (blank inputs + WFM note)","maternity_agents":"named mothers on *7 codes: Shaima Saoud, Haya Mohanna"}'::jsonb,
  'Z = (WD-hours − ShortBreak) ÷ WD-hours; sick penalty: 1→−2%, 2→−5%, >2→none (sheet quirk, replicated as-is); round-half-up; band: ≥91→15, =90→10, =89→5, 87–88→0, ≤86→−15', 'higher_better', '%', 'Schedule/Productivity WD blocks + Ameyo AGENT_Session_Details / Sprinklr break export (per function)', 'per agent per week by employee ID; Final = whole month', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO NOTHING;

INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 1, 91, 
  -- BAND PRODUCTIVITY
  '{"type":"threshold_pct","rounding":"half_up_pct","bands":[{"gte":91,"points":15},{"eq":90,"points":10},{"eq":89,"points":5},{"lte":86,"points":-15}],"default":0}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'PRODUCTIVITY'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO NOTHING;

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id, 1, r.id, 'v1 seed — reverse-engineered 2026 template rulebook (scorecard-builder skill)',
  jsonb_build_object('formula_text', r.formula_text, 'band', (SELECT band FROM kpi_function_config c WHERE c.kpi_id = r.id AND c.function_name IS NULL), 'definition', r.definition),
  DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'PRODUCTIVITY'
  AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.version = 1);

-- ─── CTR ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'CTR', 'Contact-to-Ticket Ratio', 'نسبة التواصل إلى التذاكر',
  -- DEF CTR
  '{"mandatory_clarification":"Business definition supplied: CTR % = Total Contacts ÷ Total Tickets × 100. Store both raw values and the percentage. If a historical sheet uses Tickets ÷ Contacts, document and require approval — never hide or silently reverse the ratio.","direction_confirmed":false,"peak_override":"peak months: CTR = bar (100% for Sprinklr functions, band bar for voice/Refund); Final row only, weekly rows real"}'::jsonb,
  'CTR% = Total Contacts ÷ Total Tickets × 100 (ratio direction pending Director confirmation — direction_confirmed:false); round-half-up; band: ≥95→10, 90–94→5, <90→−10', 'higher_better', '%', 'Contacts vs tickets created (Sprinklr / Ameyo per function)', 'per agent per week', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO NOTHING;

INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 1, 95, 
  -- BAND CTR
  '{"type":"threshold_pct","rounding":"half_up_pct","bands":[{"gte":95,"points":10},{"gte":90,"points":5}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'CTR'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO NOTHING;

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id, 1, r.id, 'v1 seed — reverse-engineered 2026 template rulebook (scorecard-builder skill)',
  jsonb_build_object('formula_text', r.formula_text, 'band', (SELECT band FROM kpi_function_config c WHERE c.kpi_id = r.id AND c.function_name IS NULL), 'definition', r.definition),
  DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'CTR'
  AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.version = 1);

-- ─── QUIZ ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'QUIZ', 'Quiz', 'الاختبار',
  -- DEF QUIZ
  '{"mandatory_clarification":"Quiz is received as a ready score (fraction pts/100). Convert with the exact historical grid — do not create a new points table unless approved.","band_boundary_note":"template IF (scoring-bands.md) awards 10 only for p>95 and 5 for 90–95 inclusive; SKILL.md prose table says 95–100→10. The IF-formula provenance wins (encoded here: 95→5, 96→10) — flagged for Director.","no_quiz_week":"weeks with no quiz file → everyone gets the bar (max quiz score)"}'::jsonb,
  'Quiz score fraction ×100 round-half-up; band: >95→10, 90–95→5, <90→−10 (exact template IF)', 'higher_better', '%', 'Weekly MS-Forms quiz exports (Email, Name, Total points/100, function)', 'match by email-local OR agent name (space/spelling-tolerant)', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO NOTHING;

INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 1, 96, 
  -- BAND QUIZ
  '{"type":"threshold_pct","rounding":"half_up_pct","bands":[{"gt":95,"points":10},{"gte":90,"points":5}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'QUIZ'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO NOTHING;

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id, 1, r.id, 'v1 seed — reverse-engineered 2026 template rulebook (scorecard-builder skill)',
  jsonb_build_object('formula_text', r.formula_text, 'band', (SELECT band FROM kpi_function_config c WHERE c.kpi_id = r.id AND c.function_name IS NULL), 'definition', r.definition),
  DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'QUIZ'
  AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.version = 1);

-- ─── COMMON_MISTAKES ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'COMMON_MISTAKES', 'Common Mistakes', 'الأخطاء الشائعة',
  -- DEF COMMON_MISTAKES
  '{"quiz_commitment_routing":"present-but-did-not-solve-quiz penalty (−5) is ROUTED through this column (Common Mistakes = 1 → 15−5 = 10) because Common Mistakes IS in the Net formula while Attendance Score is NOT. On leave that week → no penalty, no note. Final = total quiz-miss weeks."}'::jsonb,
  'Score = 15 − (mistake count × 5); 0 mistakes → 15', 'lower_better', 'count', 'TL/QA mistake log + quiz-commitment routing', 'per agent per week', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO NOTHING;

INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 1, 0, 
  -- BAND COMMON_MISTAKES
  '{"type":"linear_count","base":15,"per_unit":-5}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'COMMON_MISTAKES'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO NOTHING;

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id, 1, r.id, 'v1 seed — reverse-engineered 2026 template rulebook (scorecard-builder skill)',
  jsonb_build_object('formula_text', r.formula_text, 'band', (SELECT band FROM kpi_function_config c WHERE c.kpi_id = r.id AND c.function_name IS NULL), 'definition', r.definition),
  DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'COMMON_MISTAKES'
  AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.version = 1);

-- ─── RESPONSE_TIME ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'RESPONSE_TIME', 'Response Time (FRT)', 'وقت الاستجابة الأولى',
  -- DEF RESPONSE_TIME
  '{"value_format":"Excel day-fraction (1h = 1/24)","note":"this is the template ResponseTimeScore column (a.k.a. EMAIL_FRT for Social Media & Email); period aggregation weighted like AHT"}'::jsonb,
  'First Response Time in hours: ≤1h→15, ≤2h→10, ≤4h→5, else −15', 'lower_better', 'hours (from day-fraction)', 'Sprinklr Case-Assignments "First Response Time"; CHAT AMEYO FRT for pre-Sprinklr weeks', 'per agent per week by name, weighted by case count', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO NOTHING;

INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 1, 1, 
  -- BAND RESPONSE_TIME
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":1,"points":15},{"lte":2,"points":10},{"lte":4,"points":5}],"default":-15}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'RESPONSE_TIME'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO NOTHING;

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id, 1, r.id, 'v1 seed — reverse-engineered 2026 template rulebook (scorecard-builder skill)',
  jsonb_build_object('formula_text', r.formula_text, 'band', (SELECT band FROM kpi_function_config c WHERE c.kpi_id = r.id AND c.function_name IS NULL), 'definition', r.definition),
  DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'RESPONSE_TIME'
  AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.version = 1);

-- ─── COMMITMENT ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'COMMITMENT', 'Commitment (quiz)', 'الالتزام',
  -- DEF COMMITMENT
  '{"rule":"agent present (WD>0) but did NOT solve that week''s quiz → −5, routed via COMMON_MISTAKES (+ cell note \"didn''t solve quiz\"); on leave → no deduction, no note"}'::jsonb,
  '−5 per quiz-missed week while present; applied through Common Mistakes column', 'higher_better', 'points', 'Quiz files vs Productivity WD (presence)', 'per agent per week', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO NOTHING;

INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 1, NULL, 
  -- BAND COMMITMENT
  '{"type":"deduction","points_if_missed":-5,"routed_via":"COMMON_MISTAKES"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'COMMITMENT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO NOTHING;

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id, 1, r.id, 'v1 seed — reverse-engineered 2026 template rulebook (scorecard-builder skill)',
  jsonb_build_object('formula_text', r.formula_text, 'band', (SELECT band FROM kpi_function_config c WHERE c.kpi_id = r.id AND c.function_name IS NULL), 'definition', r.definition),
  DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'COMMITMENT'
  AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.version = 1);

-- ─── CSAT ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'CSAT', 'Customer Satisfaction', 'رضا العملاء',
  -- DEF CSAT
  '{"status":"registered per FINAL master spec §13; NOT scored in the 2026 template — no historical band exists to encode. Bands/weights await Director definition."}'::jsonb,
  'CSAT% (definition and band pending Director — not part of current Net Points)', 'higher_better', '%', 'pending (Sprinklr survey / CSAT program)', 'pending attribution-rule verification (spec §12: do not score surveys until attribution verified)', false
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO NOTHING;

INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 0, NULL, NULL, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'CSAT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO NOTHING;

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id, 1, r.id, 'v1 seed — reverse-engineered 2026 template rulebook (scorecard-builder skill)',
  jsonb_build_object('formula_text', r.formula_text, 'band', 'null'::jsonb, 'definition', r.definition),
  DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'CSAT'
  AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.version = 1);

-- ─── NPS ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'NPS', 'Net Promoter Score', 'صافي نقاط الترويج',
  -- DEF NPS
  '{"status":"registered per FINAL master spec §13; NOT scored in the 2026 template — no historical band exists to encode. Bands/weights await Director definition."}'::jsonb,
  'NPS = %Promoters − %Detractors (band pending Director — not part of current Net Points)', 'higher_better', 'score', 'pending', 'pending attribution-rule verification', false
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO NOTHING;

INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 0, NULL, NULL, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'NPS'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO NOTHING;

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id, 1, r.id, 'v1 seed — reverse-engineered 2026 template rulebook (scorecard-builder skill)',
  jsonb_build_object('formula_text', r.formula_text, 'band', 'null'::jsonb, 'definition', r.definition),
  DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'NPS'
  AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.version = 1);

