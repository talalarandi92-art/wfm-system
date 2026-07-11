-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 089: KPI Registry — PER-FUNCTION AHT + Response-Time bands and the
--   QUALITY "not evaluated" rule, extracted VERBATIM from the Director's 6 real
--   2026 SC workbooks (new folder/Scorecard 2026/1.Jan..6.June 26 SC..xlsx,
--   SC!Q / SC!AG score formulas + rows-2..8 threshold constants $N$4-7 /
--   $O$2-8 / $AF$3-8) — extracted 2026-07-11. The sheets are the authority.
--   Supersedes the m088 simplified 48h-AHT / email-RT single bands for the
--   AHT / RESPONSE_TIME / QUALITY codes (NULL-function rows stay as fallback).
--
--   • AHT: chat 9:00/9:30/10:00→15/10/5/−5 (CH-WA), inbound 6-band
--     2:30..5:00 (Inbound), OMT 2:00/3:00→10/5/−5, email 48h SLA max 10
--     (Mail & NPS, SM&Email, Offline, Internship OMT/Offline), Refund/Social
--     Media AHT not scored. Internship Inbound = inbound band by MAJORITY
--     (Jan+June); the May-26 email-shaped block is a flagged outlier.
--   • RESPONSE_TIME: chat 35s/40s→10/5/−10, Social Media 10/15/20/30min
--     5-band, email 1/2/4h default; Inbound/OMT/Refund RT not scored.
--   • QUALITY (Director rule 2026-07-11): blank/0 QA raw = NOT EVALUATED →
--     score null, excluded from Net (band has no default; 0% falls through);
--     Support/Offline/Team Leader/administrative(إداري)/Customer Care are
--     not applicable (info-band overrides, weight 0).
--
--   IDEMPOTENT: ON CONFLICT DO UPDATE. Source of truth: kpi-seed.ts (jest spec
--   asserts SQL 089 ↔ TS parity; 089 overlays 088 for these codes). Apply by
--   direct pg (rb-apply style), NOT migrate.js. Machine-generated from
--   kpi-seed.ts — do not hand-edit.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── QUALITY ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'QUALITY', 'Quality (QA)', 'الجودة',
  -- DEF QUALITY
  '{"notes":"QA arrives as a ready percentage from the approved Quality report — do not recompute.","bar":"Full 30 points at ≥95% — UNIFORM across ALL functions. Decoded from the Director''s Jan–June 2026 SC sheets, cell K14 = IF(J14>=95%,30, IF(90%<=J14<95%,20, IF(80%<=J14<90%,10, IF(65%<=J14<=80%,−10, IF(J14<65%,−20))))). 80% is only the +10 band, NOT the full-points bar. Byte-identical every function/month — no ambiguity.","missing_month":"empty QA month → substitute the bar (max score) per skill §7","matching":"by employee ID","not_evaluated_rule":"DIRECTOR RULE 2026-07-11: a blank OR zero QA raw value means NOT EVALUATED — score is NULL (excluded from Net Points), NEVER −20. Covers agents on leave / barely-worked periods (low Working-Days %). Mirrors the sheets'' dominant behavior: when J is blank the Director DELETES the K score cell so H sums it as 0 (e.g. Feb 26 SM&Email: 26 J=0 rows all have K deleted). Encoded in the band as lowest band gte:1→−20 with NO default → rounded 0% falls through to null. Residual: a few sheet rows (Mar ×7, June ×11) left the −20 formula on blank/zero J — sheet-side contradictions of the rule, classified not forced.","not_applicable_functions":"DIRECTOR RULE 2026-07-11: Support, Offline, Team Leader, administrative/إداري roles, and Customer Care have NO QA evaluation at all — QUALITY is not applicable (score null, their Net max excludes the 30). Seeded as info-band functionOverrides. Sheet evidence: Offline blocks blank/delete K for 30 of 40 Feb rows; Support/Team Leader/Customer Care/إداري never appear as scored SC blocks.","source_evidence":"new folder/Scorecard 2026/KPI_Rules_Decoded_From_Sheets.md §Q3 (SC!K14); blank/zero-K behavior re-extracted from all 6 workbooks 2026-07-11"}'::jsonb,
  'QA% imported as final percentage from approved Quality report; round-half-up to integer; UNIFORM band (SC!K14 IF): >=95→30, 90–94→20, 80–89→10, 65–79→−10, 1–64→−20 (max 30); blank/0% → NOT EVALUATED (null, excluded from Net — Director rule 2026-07-11); not applicable to Support/Offline/Team Leader/administrative/Customer Care', 'higher_better', '%', 'QA file (user-provided monthly Quality report)', 'per agent per week by employee ID', true
FROM tenants t
ON CONFLICT (tenant_id, kpi_code) DO UPDATE SET
  name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, definition=EXCLUDED.definition,
  formula_text=EXCLUDED.formula_text, direction=EXCLUDED.direction, unit=EXCLUDED.unit,
  source=EXCLUDED.source, attribution_rule=EXCLUDED.attribution_rule, active=EXCLUDED.active, updated_at=NOW();

-- WT QUALITY 30
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 30, 95,
  -- BAND QUALITY
  '{"type":"threshold_pct","rounding":"half_up_pct","bands":[{"gte":95,"points":30},{"gte":90,"points":20},{"gte":80,"points":10},{"gte":65,"points":-10},{"gte":1,"points":-20}]}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'QUALITY'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV QUALITY Support 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Support', 0, NULL,
  -- OVBAND QUALITY Support
  '{"type":"info","note":"QUALITY not applicable — no QA evaluation (Director rule 2026-07-11)"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'QUALITY'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV QUALITY Offline 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Offline', 0, NULL,
  -- OVBAND QUALITY Offline
  '{"type":"info","note":"QUALITY not applicable — no QA evaluation (Director rule 2026-07-11)"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'QUALITY'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV QUALITY Internship Offline 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Internship Offline', 0, NULL,
  -- OVBAND QUALITY Internship Offline
  '{"type":"info","note":"QUALITY not applicable — no QA evaluation (Director rule 2026-07-11)"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'QUALITY'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV QUALITY Team Leader 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Team Leader', 0, NULL,
  -- OVBAND QUALITY Team Leader
  '{"type":"info","note":"QUALITY not applicable — no QA evaluation (Director rule 2026-07-11)"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'QUALITY'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV QUALITY Customer Care 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Customer Care', 0, NULL,
  -- OVBAND QUALITY Customer Care
  '{"type":"info","note":"QUALITY not applicable — no QA evaluation (Director rule 2026-07-11)"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'QUALITY'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV QUALITY Administrative 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Administrative', 0, NULL,
  -- OVBAND QUALITY Administrative
  '{"type":"info","note":"QUALITY not applicable — no QA evaluation (Director rule 2026-07-11)"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'QUALITY'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV QUALITY إداري 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'إداري', 0, NULL,
  -- OVBAND QUALITY إداري
  '{"type":"info","note":"QUALITY not applicable — no QA evaluation (Director rule 2026-07-11)"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'QUALITY'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id,
       (SELECT COALESCE(MAX(version),0)+1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id),
       r.id,
       'm089: per-function AHT/RT bands + QUALITY not-evaluated rule extracted from the 6 real SC workbooks (sheets are the authority; Director rules 2026-07-11)',
       jsonb_build_object('formula_text', r.formula_text, 'definition', r.definition, 'active', r.active,
         'configs', (SELECT COALESCE(json_agg(json_build_object('function_name', c.function_name, 'weight', c.weight,
            'target', c.target, 'band', c.band, 'applies_from', c.applies_from)), '[]')
            FROM kpi_function_config c WHERE c.kpi_id = r.id)),
       CURRENT_DATE
  FROM kpi_registry r WHERE r.kpi_code = 'QUALITY'
    AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.change_note LIKE 'm089:%');

-- ─── AHT ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'AHT', 'Average Handling Time', 'متوسط وقت المعالجة',
  -- DEF AHT
  '{"mandatory_clarification":"Period AHT must be WEIGHTED from totals (sum handle time ÷ sum contacts handled) — never an average of averages.","current_band":"SUPERSEDED-BY-SHEET-EXTRACTION (2026-07-11): the earlier simplified single-48h band (Director interim rule, 2026-06-17) is now only the NULL-function FALLBACK. The per-function bands below are seeded as functionOverrides, extracted verbatim from the Q-column IF-formulas + rows-2..8 threshold constants of the Director''s 6 real SC workbooks (new folder/Scorecard 2026/1.Jan..6.June 26 SC..xlsx) — the sheets are the authority.","per_function_bands":{"CH - WA / Internship CH - WA":"SC!Q = IF(P<=$N$7,15, $N$7<P<$N$6→10, $N$5<=P<$N$4→5, P>$N$4→−5, P=$N$4→blank). Constants: N7=0:09:00, N5=N6=0:09:30, N4=0:10:00 — identical Jan/Apr/May/June (Feb CH-WA block unscored that month, Mar Q hand-typed constant 10; majority = this band).","Inbound / Internship Inbound":"SC!Q 6-branch = $O$3<=P<=$O$6→15, $O$6<P<=$O$2→10, $O$2<P<$O$8→0, P>=$O$8→blank, $O$4<=P<$O$3→5, P<$O$4→−10 (the <O4 AND >=O8 branch is dead). Constants: O4=0:02:30, O3=0:03:00, O6=0:04:00, O2=0:04:30, O8=0:05:00 — identical Jan/Feb/Apr/May/June. OUTLIER: May \"Internship Inbound\" block used the email 48h shape — majority (Jan+June inbound band) wins, May flagged.","OMT":"SC!Q = IF(P>$O$3,−5, P<$O$5→10, $O$5<=P<=$O$3→5). Constants: O5=0:02:00, O3=0:03:00. Max = 10.","Mail & NPS / Social Media & Email / Offline / Internship Offline / Internship OMT":"SC!Q = IF(P*24<=48,10,−10) — 48-hour case-SLA, max 10 (Internship OMT/Offline evidence = May 26 only; flagged single-month).","Refund / Social Media":"AHT NOT scored (Q cells empty in every month the block appears) → info band override (weight 0)."},"exact_boundary_note":"Excel awards blank (\"\") at P exactly = the chat 0:10:00 / inbound ≥0:05:00 edges — encoded as points 0 (blank sums as 0 in Net col H). Strict \"<\" edges are encoded as lte threshold−1e-9h.","value_format":"Excel day-fraction, cell format [h]:mm:ss","voice_source":"own channel only: Inbound-function ← Inbound.xlsx, Outbound ← Outbound.xlsx","chat_source":"Sprinklr Case-Assignments \"Avg. Handling Time\" (NOT the \"(Case)\" variant), weighted by case count","source_evidence":"SC!Q14/Q24/Q29/Q59 formulas + threshold cells $N$4..$N$7, $O$2..$O$8 (rows 2–8), all 6 workbooks, extracted 2026-07-11"}'::jsonb,
  'AHT = Σ handle time ÷ Σ contacts handled (weighted, never average-of-averages); score: PER-FUNCTION sheet bands (chat 9:00/9:30/10:00 → 15/10/5/−5; inbound 2:30/3:00/4:00/4:30/5:00 → −10/5/15/10/0; OMT 2:00/3:00 → 10/5/−5; email-shaped functions ≤48h→10 else −10); NULL-function fallback = simplified ≤48h→10 else −10', 'lower_better', 'hours (from day-fraction)', 'Ameyo Inbound/Outbound.xlsx (voice); Sprinklr Case-Assignments (CH-WA, Social & Email)', 'voice by employee ID from own channel; Sprinklr by Last Engaged User name, weighted by case count', true
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

-- OV AHT CH - WA 15
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'CH - WA', 15, 0.15,
  -- OVBAND AHT CH - WA
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":0.150000001,"points":15},{"lte":0.15833333233333333,"points":10},{"lte":0.16666666566666666,"points":5},{"lte":0.16666666766666666,"points":0}],"default":-5}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV AHT Internship CH - WA 15
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Internship CH - WA', 15, 0.15,
  -- OVBAND AHT Internship CH - WA
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":0.150000001,"points":15},{"lte":0.15833333233333333,"points":10},{"lte":0.16666666566666666,"points":5},{"lte":0.16666666766666666,"points":0}],"default":-5}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV AHT Inbound 15
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Inbound', 15, 0.06666666666666667,
  -- OVBAND AHT Inbound
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":0.041666665666666665,"points":-10},{"lte":0.049999999,"points":5},{"lte":0.06666666766666667,"points":15},{"lte":0.075000001,"points":10},{"lte":0.08333333233333333,"points":0}],"default":0}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV AHT Internship Inbound 15
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Internship Inbound', 15, 0.06666666666666667,
  -- OVBAND AHT Internship Inbound
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":0.041666665666666665,"points":-10},{"lte":0.049999999,"points":5},{"lte":0.06666666766666667,"points":15},{"lte":0.075000001,"points":10},{"lte":0.08333333233333333,"points":0}],"default":0}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV AHT OMT 10
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'OMT', 10, 0.03333333333333333,
  -- OVBAND AHT OMT
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":0.03333333233333333,"points":10},{"lte":0.050000001,"points":5}],"default":-5}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV AHT Mail & NPS 10
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Mail & NPS', 10, 48,
  -- OVBAND AHT Mail & NPS
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":48,"points":10}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV AHT Social Media & Email 10
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Social Media & Email', 10, 48,
  -- OVBAND AHT Social Media & Email
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":48,"points":10}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV AHT Offline 10
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Offline', 10, 48,
  -- OVBAND AHT Offline
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":48,"points":10}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV AHT Internship Offline 10
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Internship Offline', 10, 48,
  -- OVBAND AHT Internship Offline
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":48,"points":10}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV AHT Internship OMT 10
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Internship OMT', 10, 48,
  -- OVBAND AHT Internship OMT
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":48,"points":10}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV AHT Refund 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Refund', 0, NULL,
  -- OVBAND AHT Refund
  '{"type":"info","note":"AHT not scored for Refund (Q cells empty in all 6 workbooks)"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV AHT Social Media 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Social Media', 0, NULL,
  -- OVBAND AHT Social Media
  '{"type":"info","note":"AHT not scored for the Jan-26 Social Media block (Q cells empty)"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id,
       (SELECT COALESCE(MAX(version),0)+1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id),
       r.id,
       'm089: per-function AHT/RT bands + QUALITY not-evaluated rule extracted from the 6 real SC workbooks (sheets are the authority; Director rules 2026-07-11)',
       jsonb_build_object('formula_text', r.formula_text, 'definition', r.definition, 'active', r.active,
         'configs', (SELECT COALESCE(json_agg(json_build_object('function_name', c.function_name, 'weight', c.weight,
            'target', c.target, 'band', c.band, 'applies_from', c.applies_from)), '[]')
            FROM kpi_function_config c WHERE c.kpi_id = r.id)),
       CURRENT_DATE
  FROM kpi_registry r WHERE r.kpi_code = 'AHT'
    AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.change_note LIKE 'm089:%');

-- ─── RESPONSE_TIME ───
INSERT INTO kpi_registry (tenant_id, kpi_code, name_en, name_ar, definition, formula_text, direction, unit, source, attribution_rule, active)
SELECT t.id, 'RESPONSE_TIME', 'Response Time (FRT)', 'وقت الاستجابة الأولى',
  -- DEF RESPONSE_TIME
  '{"value_format":"Excel day-fraction (1h = 1/24)","note":"this is the template ResponseTimeScore column (a.k.a. EMAIL_FRT for Social Media & Email); period aggregation weighted like AHT","per_function_bands":"SUPERSEDED-BY-SHEET-EXTRACTION (2026-07-11), extracted from the AG-column IF-formulas + $AF$3..$AF$8 constants of all 6 workbooks: (a) CH-WA / Internship CH-WA chat RT = AF<=0:35→10, <0:40→5, =0:40→blank, >0:40→−10 (max 10, constants $AF$3/$AF$4); (b) Social Media (Jan block) 5-band = <=10:00→15, <=15:00→10, <=20:00→5, <=30:00→−5, >30:00→−15 ($AF$5..$AF$8) — NOTE the Jan sheet formula carries the known wrong-row bug (reads AF34), classified sheet-side; (c) Mail & NPS / Social Media & Email / Offline blocks = the email 1h/2h/4h → 15/10/5/−15 shape = the NULL-function default; (d) Inbound / Internship Inbound / OMT / Refund: RT NOT scored (AG cells empty) → info overrides.","source_evidence":"SC!AG formulas + threshold cells $AF$3..$AF$8 (rows 2–8), all 6 workbooks, extracted 2026-07-11"}'::jsonb,
  'First Response Time, PER-FUNCTION sheet bands: chat ≤35s→10/<40s→5/>40s→−10; Social Media ≤10m→15/≤15m→10/≤20m→5/≤30m→−5/else −15; email-shaped (default) ≤1h→15, ≤2h→10, ≤4h→5, else −15; Inbound/OMT/Refund not scored', 'lower_better', 'hours (from day-fraction)', 'Sprinklr Case-Assignments "First Response Time"; CHAT AMEYO FRT for pre-Sprinklr weeks', 'per agent per week by name, weighted by case count', true
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

-- OV RESPONSE_TIME CH - WA 10
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'CH - WA', 10, 0.009722222222222222,
  -- OVBAND RESPONSE_TIME CH - WA
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":0.009722223222222222,"points":10},{"lte":0.011111110111111112,"points":5},{"lte":0.011111112111111111,"points":0}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'RESPONSE_TIME'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV RESPONSE_TIME Internship CH - WA 10
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Internship CH - WA', 10, 0.009722222222222222,
  -- OVBAND RESPONSE_TIME Internship CH - WA
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":0.009722223222222222,"points":10},{"lte":0.011111110111111112,"points":5},{"lte":0.011111112111111111,"points":0}],"default":-10}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'RESPONSE_TIME'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV RESPONSE_TIME Social Media 15
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Social Media', 15, 0.16666666666666666,
  -- OVBAND RESPONSE_TIME Social Media
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":0.16666666766666666,"points":15},{"lte":0.250000001,"points":10},{"lte":0.33333333433333334,"points":5},{"lte":0.500000001,"points":-5}],"default":-15}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'RESPONSE_TIME'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV RESPONSE_TIME Inbound 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Inbound', 0, NULL,
  -- OVBAND RESPONSE_TIME Inbound
  '{"type":"info","note":"Response Time not scored for Inbound (AG cells empty in all 6 workbooks)"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'RESPONSE_TIME'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV RESPONSE_TIME Internship Inbound 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Internship Inbound', 0, NULL,
  -- OVBAND RESPONSE_TIME Internship Inbound
  '{"type":"info","note":"Response Time not scored for Internship Inbound (AG cells empty where the inbound band applies)"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'RESPONSE_TIME'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV RESPONSE_TIME OMT 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'OMT', 0, NULL,
  -- OVBAND RESPONSE_TIME OMT
  '{"type":"info","note":"Response Time not scored for OMT (AG cells empty in all 6 workbooks)"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'RESPONSE_TIME'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

-- OV RESPONSE_TIME Refund 0
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, 'Refund', 0, NULL,
  -- OVBAND RESPONSE_TIME Refund
  '{"type":"info","note":"Response Time not scored for Refund (AG cells empty in all 6 workbooks)"}'::jsonb, DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'RESPONSE_TIME'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band, updated_at=NOW();

INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id,
       (SELECT COALESCE(MAX(version),0)+1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id),
       r.id,
       'm089: per-function AHT/RT bands + QUALITY not-evaluated rule extracted from the 6 real SC workbooks (sheets are the authority; Director rules 2026-07-11)',
       jsonb_build_object('formula_text', r.formula_text, 'definition', r.definition, 'active', r.active,
         'configs', (SELECT COALESCE(json_agg(json_build_object('function_name', c.function_name, 'weight', c.weight,
            'target', c.target, 'band', c.band, 'applies_from', c.applies_from)), '[]')
            FROM kpi_function_config c WHERE c.kpi_id = r.id)),
       CURRENT_DATE
  FROM kpi_registry r WHERE r.kpi_code = 'RESPONSE_TIME'
    AND NOT EXISTS (SELECT 1 FROM scorecard_formula_versions v WHERE v.kpi_id = r.id AND v.change_note LIKE 'm089:%');
