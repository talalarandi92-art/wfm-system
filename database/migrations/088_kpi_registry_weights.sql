-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 088: KPI Registry — AUTHORITATIVE weights + corrected PRR/Quiz/QA
--   definitions, decoded from the Director's real 2026 SC workbooks
--   (new folder/Scorecard 2026/KPI_Rules_Decoded_From_Sheets.md — all 6 months
--   byte-identical). Supersedes the ambiguous flags seeded in 080.
--
--   • Sets each KPI's MAX-POINTS weight (Net Points col H): Quality 30, PRR 2.5
--     (+2.5 bonus cell), AHT 15 (Email=10), FCR 20, Productivity 15, CTR 10,
--     Quiz 10, Common Mistakes 15, Response Time 15. SURVEY_RR/COMMITMENT/CSAT/
--     NPS/INCIDENTS/ATTENDANCE = 0 (tracked, NOT summed into Net Points).
--   • PRR denominator corrected to Yes ÷ (Yes+No responses) [NOT ÷ contacts];
--     Quiz 95=5 confirmed; QA bar 95→30 uniform (80% = +10 band only).
--   • Adds INCIDENTS + ATTENDANCE registry rows (weight 0, non-scoring).
--   • AHT gains a "Mail & NPS" (Email) function override capped at 10.
--
--   IDEMPOTENT: ON CONFLICT DO UPDATE. Source of truth: kpi-seed.ts (jest spec
--   asserts SQL 088 ↔ TS parity). Apply by direct pg (rb-apply style), NOT
--   migrate.js. Machine-generated from kpi-seed.ts — do not hand-edit.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── QUALITY ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'QUALITY', 'Quality (QA)', 'الجودة',
  -- DEF QUALITY
  '{"notes":"QA arrives as a ready percentage from the approved Quality report — do not recompute.","bar":"Full 30 points at ≥95% — UNIFORM across ALL functions. Decoded from the Director''s Jan–June 2026 SC sheets, cell K14 = IF(J14>=95%,30, IF(90%<=J14<95%,20, IF(80%<=J14<90%,10, IF(65%<=J14<=80%,−10, IF(J14<65%,−20))))). 80% is only the +10 band, NOT the full-points bar. Byte-identical every function/month — no ambiguity.","missing_month":"empty QA month → substitute the bar (max score) per skill §7","matching":"by employee ID","source_evidence":"new folder/Scorecard 2026/KPI_Rules_Decoded_From_Sheets.md §Q3 (SC!K14)"}'::jsonb,
  'QA% imported as final percentage from approved Quality report; round-half-up to integer; UNIFORM band (SC!K14 IF): >=95→30, 90–94→20, 80–89→10, 65–79→−10, <65→−20 (max 30)', 'higher_better', '%', 'QA file (user-provided monthly Quality report)', 'per agent per week by employee ID', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT QUALITY 30
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 30, 95,
  -- BAND QUALITY
  '{"type":"threshold_pct","rounding":"half_up_pct","bands":[{"gte":95,"points":30},{"gte":90,"points":20},{"gte":80,"points":10},{"gte":65,"points":-10}],"default":-20}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'QUALITY'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- ─── PRR ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'PRR', 'Positive Response Rate', 'معدل الرد الإيجابي',
  -- DEF PRR
  '{"denominator":"survey_responses","mandatory_clarification":"PRR rate (BRR) = Survey Yes ÷ (Yes+No survey responses) — the POSITIVE rate AMONG RESPONDERS, NOT ÷ total contacts. Decoded from the Director''s Jan–June 2026 SC sheets: N14 (PRR Points)=IF(AND(M14>=80%,L14>=10%),2.5,0), O14 (PRR Bonus)=IF(AND(L14>=10%,M14>=80%),2.5,0); M14=PRR rate=Yes/(Yes+No responses), L14=Response Rate=responses/contacts. Raw PRR tab confirms BRR=Yes/responses (e.g. 18/20=0.90). All 6 workbooks byte-identical.","direction_confirmed":true,"response_rate_gate":"Survey Response Rate (RES) = responses ÷ contacts is a SEPARATE column (see SURVEY_RR), used ONLY as the ≥10% eligibility gate for PRR — never mixed into the PRR rate.","cells":"two template cells (PRR Points col N + PRR Bonus col O), each 2.5 when BOTH gates pass (BRR≥80% AND RES≥10%) → total max 5","store":["survey_yes","survey_no","survey_responses","total_contacts","brr_pct","res_pct","prr_points","prr_bonus"],"source_evidence":"new folder/Scorecard 2026/KPI_Rules_Decoded_From_Sheets.md §Q1 (SC!N14/O14 + raw PRR tab)"}'::jsonb,
  'PRR rate (BRR) = Survey Yes ÷ (Yes+No responses) [NOT ÷ contacts]; PRR Points = 2.5 if BRR≥80% AND RES≥10% else 0; PRR Bonus = same gate → another 2.5 (both pass = max 5). RES = responses÷contacts (SURVEY_RR) is the ≥10% gate only.', 'higher_better', '%', 'Sprinklr survey (Yes/No able-to-resolve + response count); fallback Ameyo feedback1', 'per agent per week by agent name (space/spelling-tolerant)', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT PRR 2.5
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 2.5, 80,
  -- BAND PRR
  '{"type":"gate","rounding":"half_up_pct","gates":[{"metric":"PRR","gte":80},{"metric":"SURVEY_RR","gte":10}],"pass_points":2.5,"cells":["PRR Points","PRR Bonus"],"default":0}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'PRR'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- ─── SURVEY_RR ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'SURVEY_RR', 'Survey Response Rate (RES)', 'معدل الاستجابة للاستبيان',
  -- DEF SURVEY_RR
  '{"mandatory_clarification":"Survey Response Rate % = (Survey Yes + Survey No) ÷ Total Contacts × 100 = Total Survey Responses ÷ Total Contacts × 100. PRR and Survey Response Rate are SEPARATE KPIs and must never be mixed.","role":"not independently pointed in the 2026 template; acts as the RES≥10% gate inside PRR scoring"}'::jsonb,
  'Survey RR% = (Yes + No) ÷ Total Contacts × 100; no standalone points — gates PRR (RES ≥ 10%)', 'higher_better', '%', 'Sprinklr survey export (Yes/No counts) ÷ total contacts', 'per agent per week by agent name', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT SURVEY_RR 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 0, 10,
  -- BAND SURVEY_RR
  '{"type":"info","rounding":"half_up_pct"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'SURVEY_RR'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- ─── AHT ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'AHT', 'Average Handling Time', 'متوسط وقت المعالجة',
  -- DEF AHT
  '{"mandatory_clarification":"Period AHT must be WEIGHTED from totals (sum handle time ÷ sum contacts handled) — never an average of averages.","current_band":"single 48h threshold on total hours (Director: keep at 48 until Sprinklr revision, 2026-06-17). Spec requires per-function duration bands from historical sheets — not yet extracted per function; flagged.","max_points":"Decoded max points = 15 for voice/chat functions; Email (Mail & NPS) AHT max = 10 (SC!Q = IF(P*24<=48,10,−10) case-SLA, not a time-of-day AHT). Band SHAPE differs by function (chat AHT-seconds, inbound, OMT) — only the Email 10-pt cap is encoded as a function override; the runtime 48h band is the Director-approved simplification pending per-function extraction.","value_format":"Excel day-fraction, cell format [h]:mm:ss","voice_source":"own channel only: Inbound-function ← Inbound.xlsx, Outbound ← Outbound.xlsx","chat_source":"Sprinklr Case-Assignments \"Avg. Handling Time\" (NOT the \"(Case)\" variant), weighted by case count"}'::jsonb,
  'AHT = Σ handle time ÷ Σ contacts handled (weighted, never average-of-averages); score: total hours ≤ 48 → 10 else −10', 'lower_better', 'hours (from day-fraction)', 'Ameyo Inbound/Outbound.xlsx (voice); Sprinklr Case-Assignments (CH-WA, Social & Email)', 'voice by employee ID from own channel; Sprinklr by Last Engaged User name, weighted by case count', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT AHT 15
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 15, 48,
  -- BAND AHT
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":48,"points":10}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV AHT Mail & NPS 10
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Mail & NPS', 10, 48,
  -- OVBAND AHT
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":48,"points":10}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- ─── FCR ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'FCR', 'First Contact Resolution', 'الحل من أول تواصل',
  -- DEF FCR
  '{"mandatory_clarification":"FCR % = Closed Tickets ÷ Total Tickets × 100. Store total/closed/open/reopened; verify closure qualification, reopen impact, same-agent rule, denominator basis per function — verification pending, flagged.","peak_override":"peak months: Inbound/Outbound/Refund FCR = bar; Sprinklr functions FCR = normal/computed. Bar applies on FINAL row only; weekly rows are real."}'::jsonb,
  'FCR% = Closed first-contact ÷ Total × 100; round-half-up; band: ≥85→20, 80–84→10, 75–79→5, <75→−10', 'higher_better', '%', 'Sprinklr Case-Assignments "First Contact Closure"; voice functions per historical process', 'per agent per week; Sprinklr by name, voice by ID', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT FCR 20
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 20, 85,
  -- BAND FCR
  '{"type":"threshold_pct","rounding":"half_up_pct","bands":[{"gte":85,"points":20},{"gte":80,"points":10},{"gte":75,"points":5}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'FCR'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- ─── PRODUCTIVITY ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'PRODUCTIVITY', 'Productivity', 'الإنتاجية',
  -- DEF PRODUCTIVITY
  '{"formula_detail":"X = Σ daily hours (normal day = 9h; maternity *7 shift codes b7,n7,m7,e7,md7,mn7,ee7 = 7h). Y = X − ShortBreak (Short Break column ONLY). Z = Y/X. Productivity% = IF(sick=0→Z, sick=1→Z−2%, sick=2→Z−5%, else→Z).","sick_gt2_quirk":"the Director''s sheet IF gives NO penalty for sick>2 (intent was \"2+ → −5%\") — replicate the IF as written so outputs match the sheet, but flag it. Redesign gated on Director approval — do not activate a new formula automatically.","shortbreak_source":"per FUNCTION per WEEK: Inbound/Refund/Outbound ← Ameyo AGENT_Session_Details; CH-WA/Social/Email ← Sprinklr occupancy/break export","on_leave_week":"WD=0 week = on leave → not scored (blank inputs + WFM note)","maternity_agents":"named mothers on *7 codes: Shaima Saoud, Haya Mohanna"}'::jsonb,
  'Z = (WD-hours − ShortBreak) ÷ WD-hours; sick penalty: 1→−2%, 2→−5%, >2→none (sheet quirk, replicated as-is); round-half-up; band: ≥91→15, =90→10, =89→5, 87–88→0, ≤86→−15', 'higher_better', '%', 'Schedule/Productivity WD blocks + Ameyo AGENT_Session_Details / Sprinklr break export (per function)', 'per agent per week by employee ID; Final = whole month', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT PRODUCTIVITY 15
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 15, 91,
  -- BAND PRODUCTIVITY
  '{"type":"threshold_pct","rounding":"half_up_pct","bands":[{"gte":91,"points":15},{"eq":90,"points":10},{"eq":89,"points":5},{"lte":86,"points":-15}],"default":0}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'PRODUCTIVITY'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- ─── CTR ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'CTR', 'Contact-to-Ticket Ratio', 'نسبة التواصل إلى التذاكر',
  -- DEF CTR
  '{"mandatory_clarification":"Business definition supplied: CTR % = Total Contacts ÷ Total Tickets × 100. Store both raw values and the percentage. If a historical sheet uses Tickets ÷ Contacts, document and require approval — never hide or silently reverse the ratio.","direction_confirmed":false,"peak_override":"peak months: CTR = bar (100% for Sprinklr functions, band bar for voice/Refund); Final row only, weekly rows real"}'::jsonb,
  'CTR% = Total Contacts ÷ Total Tickets × 100 (ratio direction pending Director confirmation — direction_confirmed:false); round-half-up; band: ≥95→10, 90–94→5, <90→−10', 'higher_better', '%', 'Contacts vs tickets created (Sprinklr / Ameyo per function)', 'per agent per week', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT CTR 10
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 10, 95,
  -- BAND CTR
  '{"type":"threshold_pct","rounding":"half_up_pct","bands":[{"gte":95,"points":10},{"gte":90,"points":5}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'CTR'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- ─── QUIZ ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'QUIZ', 'Quiz', 'الاختبار',
  -- DEF QUIZ
  '{"mandatory_clarification":"Quiz is received as a ready score (fraction pts/100). Convert with the exact historical grid — do not create a new points table unless approved.","band_rule":"Decoded from the Director''s Jan–June 2026 SC sheets, cell Y14 = IF(AND(X14>=90%,X14<=95%),5, IF(AND(X14>95%,X14<=100%),10, IF(X14<90%,−10,\"\"))). So EXACTLY 95 → 5 points; full 10 requires strictly >95. Byte-identical every function/month — no ambiguity (the earlier \"prose says 95–100→10\" note is superseded: the sheet IF wins).","no_quiz_week":"weeks with no quiz file → everyone gets the bar (max quiz score)","source_evidence":"new folder/Scorecard 2026/KPI_Rules_Decoded_From_Sheets.md §Q2 (SC!Y14)"}'::jsonb,
  'Quiz score fraction ×100 round-half-up; band (SC!Y14 IF): >95→10, 90–95→5, <90→−10 (95 exactly → 5; max 10)', 'higher_better', '%', 'Weekly MS-Forms quiz exports (Email, Name, Total points/100, function)', 'match by email-local OR agent name (space/spelling-tolerant)', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT QUIZ 10
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 10, 96,
  -- BAND QUIZ
  '{"type":"threshold_pct","rounding":"half_up_pct","bands":[{"gt":95,"points":10},{"gte":90,"points":5}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'QUIZ'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- ─── COMMON_MISTAKES ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'COMMON_MISTAKES', 'Common Mistakes', 'الأخطاء الشائعة',
  -- DEF COMMON_MISTAKES
  '{"quiz_commitment_routing":"present-but-did-not-solve-quiz penalty (−5) is ROUTED through this column (Common Mistakes = 1 → 15−5 = 10) because Common Mistakes IS in the Net formula while Attendance Score is NOT. On leave that week → no penalty, no note. Final = total quiz-miss weeks."}'::jsonb,
  'Score = 15 − (mistake count × 5); 0 mistakes → 15', 'lower_better', 'count', 'TL/QA mistake log + quiz-commitment routing', 'per agent per week', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT COMMON_MISTAKES 15
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 15, 0,
  -- BAND COMMON_MISTAKES
  '{"type":"linear_count","base":15,"per_unit":-5}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'COMMON_MISTAKES'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- ─── RESPONSE_TIME ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'RESPONSE_TIME', 'Response Time (FRT)', 'وقت الاستجابة الأولى',
  -- DEF RESPONSE_TIME
  '{"value_format":"Excel day-fraction (1h = 1/24)","note":"this is the template ResponseTimeScore column (a.k.a. EMAIL_FRT for Social Media & Email); period aggregation weighted like AHT"}'::jsonb,
  'First Response Time in hours: ≤1h→15, ≤2h→10, ≤4h→5, else −15', 'lower_better', 'hours (from day-fraction)', 'Sprinklr Case-Assignments "First Response Time"; CHAT AMEYO FRT for pre-Sprinklr weeks', 'per agent per week by name, weighted by case count', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT RESPONSE_TIME 15
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 15, 1,
  -- BAND RESPONSE_TIME
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":1,"points":15},{"lte":2,"points":10},{"lte":4,"points":5}],"default":-15}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'RESPONSE_TIME'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- ─── COMMITMENT ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'COMMITMENT', 'Commitment (quiz)', 'الالتزام',
  -- DEF COMMITMENT
  '{"rule":"agent present (WD>0) but did NOT solve that week''s quiz → −5, routed via COMMON_MISTAKES (+ cell note \"didn''t solve quiz\"); on leave → no deduction, no note"}'::jsonb,
  '−5 per quiz-missed week while present; applied through Common Mistakes column', 'higher_better', 'points', 'Quiz files vs Productivity WD (presence)', 'per agent per week', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT COMMITMENT 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 0, NULL,
  -- BAND COMMITMENT
  '{"type":"deduction","points_if_missed":-5,"routed_via":"COMMON_MISTAKES"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'COMMITMENT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- ─── CSAT ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'CSAT', 'Customer Satisfaction', 'رضا العملاء',
  -- DEF CSAT
  '{"status":"registered per FINAL master spec §13; NOT scored in the 2026 template — no historical band exists to encode. Bands/weights await Director definition."}'::jsonb,
  'CSAT% (definition and band pending Director — not part of current Net Points)', 'higher_better', '%', 'pending (Sprinklr survey / CSAT program)', 'pending attribution-rule verification (spec §12: do not score surveys until attribution verified)', false
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT CSAT 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 0, NULL, NULL, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'CSAT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- ─── NPS ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'NPS', 'Net Promoter Score', 'صافي نقاط الترويج',
  -- DEF NPS
  '{"status":"registered per FINAL master spec §13; NOT scored in the 2026 template — no historical band exists to encode. Bands/weights await Director definition."}'::jsonb,
  'NPS = %Promoters − %Detractors (band pending Director — not part of current Net Points)', 'higher_better', 'score', 'pending', 'pending attribution-rule verification', false
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT NPS 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 0, NULL, NULL, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'NPS'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- ─── INCIDENTS ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'INCIDENTS', 'Incidents', 'الحوادث',
  -- DEF INCIDENTS
  '{"role":"TRACKED column only (SC col AB Incidents / AC Incidents Score) — NOT summed into Net Points. The Net Points formula (col H = K+N+O+Q+S+U+W+Y+AA+AG) EXCLUDES AC. Encoded weight 0 / non-scoring so it is documented but never inflates the score.","source_evidence":"new folder/Scorecard 2026/KPI_Rules_Decoded_From_Sheets.md §Harvested weights (AC not in H)"}'::jsonb,
  'Incidents tracked (SC col AC) — NOT part of Net Points (weight 0, non-scoring)', 'lower_better', 'count', 'TL/RTA incident log', 'per agent per week', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT INCIDENTS 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 0, NULL,
  -- BAND INCIDENTS
  '{"type":"info"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'INCIDENTS'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- ─── ATTENDANCE ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'ATTENDANCE', 'Attendance', 'الحضور',
  -- DEF ATTENDANCE
  '{"role":"TRACKED column only (SC col AD Attendance / AE Attendance Score) — NOT summed into Net Points. The Net Points formula (col H) EXCLUDES AE. Encoded weight 0 / non-scoring so it is documented but never inflates the score.","source_evidence":"new folder/Scorecard 2026/KPI_Rules_Decoded_From_Sheets.md §Harvested weights (AE not in H)"}'::jsonb,
  'Attendance tracked (SC col AE) — NOT part of Net Points (weight 0, non-scoring)', 'higher_better', '%', 'Attendance/roster reconciliation', 'per agent per week', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT ATTENDANCE 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 0, NULL,
  -- BAND ATTENDANCE
  '{"type":"info"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'ATTENDANCE'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();
