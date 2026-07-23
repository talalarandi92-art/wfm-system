-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 094: PRODUCTIVITY band uses RANGES at the top (D-082, Director
--   2026-07-23: "خليها مدى ≥90").
--
--   THE BUG IT FIXES: the SC sheet wrote the middle steps as EXACT integer
--   matches (`=90`, `=89`). That worked only while every % was rounded to a whole
--   number first. D-079 (2026-07-22) made the engine band the RAW percentage —
--   and from that moment 90.5% matched NOTHING and fell through to 0, while
--   90.0% scored 10. A better performer scored worse. `gte` removes the cliff.
--
--   WHAT IS DELIBERATELY *NOT* CHANGED: the bottom edge stays `lte: 86`, exactly
--   as the sheet wrote it — NOT widened to `< 87`. That widening was measured
--   against the 6 real 2026 workbooks first and would have dropped 8 real people
--   sitting at 86.18–86.99% from 0 to −15. The sheet itself gives them 0. The
--   ruling was to fix the cliff, not to harden the penalty band.
--
--   MEASURED IMPACT (all 6 workbooks, 2247 productivity cells):
--     50 cells change · 50 BETTER for the employee · 0 worse · +360 points
--     0 of them are Final rows, so no published Net Points moves
--     B7 engine accuracy unchanged at 98.95% — the gate still passes
--
--   IDEMPOTENT. Overlays the m088 band for PRODUCTIVITY only. Source of truth:
--   kpi-seed.ts (the jest spec asserts SQL ↔ TS parity). Apply by direct pg
--   (rb-apply style), NOT migrate.js.
-- ═══════════════════════════════════════════════════════════════════════════

-- WT PRODUCTIVITY 15
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
SELECT r.tenant_id, r.id, NULL, 15, 91,
  -- BAND PRODUCTIVITY
  '{"type":"threshold_pct","rounding":"half_up_pct","bands":[{"gte":91,"points":15},{"gte":90,"points":10},{"gte":89,"points":5},{"gte":87,"points":0},{"lte":86,"points":-15}],"default":0}'::jsonb,
  DATE '2026-01-01'
FROM kpi_registry r WHERE r.kpi_code = 'PRODUCTIVITY'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight = EXCLUDED.weight, target = EXCLUDED.target, band = EXCLUDED.band, updated_at = NOW();

-- Keep the registry's own formula text honest about what the band now does.
UPDATE kpi_registry SET
  formula_text = 'Z = (WD-hours − ShortBreak) ÷ WD-hours; sick penalty: 1→−2%, 2→−5%, >2→none (sheet quirk, replicated as-is); band (D-082, RANGES not exact steps): ≥91→15, ≥90→10, ≥89→5, ≥87→0, ≤86→−15',
  updated_at = NOW()
WHERE kpi_code = 'PRODUCTIVITY';

-- Audit trail: the rulebook change itself is a formula version.
INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id,
       COALESCE((SELECT MAX(version) FROM scorecard_formula_versions v WHERE v.kpi_id = r.id), 0) + 1,
       r.id,
       'D-082 (Director 2026-07-23): PRODUCTIVITY uses RANGES at the top (>=90, >=89) instead of exact integer matches, removing the cliff D-079 exposed where 90.5% scored 0 while 90.0% scored 10. Bottom edge left at <=86 as the sheet wrote it.',
       jsonb_build_object('decision', 'D-082',
                          'was', '{gte:91}, {eq:90}, {eq:89}, {lte:86}, default 0',
                          'now', '{gte:91}, {gte:90}, {gte:89}, {gte:87}, {lte:86}, default 0',
                          'measured_impact', '50 of 2247 cells change, all 50 in the employee''s favour, 0 worse, 0 Final rows affected; B7 accuracy unchanged at 98.95%',
                          'deliberately_unchanged', 'bottom edge stays lte:86 — widening it to <87 would have cost 8 real people 15 points each, and the sheet gives them 0'),
       DATE '2026-07-23'
FROM kpi_registry r WHERE r.kpi_code = 'PRODUCTIVITY';
