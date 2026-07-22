-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 092: the `Offline` / `Internship Offline` QUALITY not-applicable
--   rule becomes FORWARD-ONLY from its own date (D-081b, Director 2026-07-22).
--
--   The rule was made on 2026-07-11: those functions have no QA evaluation.
--   m089 seeded it with applies_from = 2026-01-01, which retroactively un-scored
--   months that were already published — the Feb and May 2026 SC sheets DO score
--   these blocks (10 pts at 80%, 30 pts at 97.5%). A rule cannot un-score a month
--   that has already gone out; it starts the day it was made.
--
--   Mechanism: move the window start to 2026-07-11. There is deliberately NO
--   undated row for these functions, so any date BEFORE the rule falls through to
--   the KPI's own QUALITY band — which is precisely what "forward-only" means.
--   (`bandFor` asked without a period answers as of TODAY, i.e. the rule applies.)
--
--   Scope note: only `Offline` and `Internship Offline` are moved. The other
--   not-applicable functions in the same rule (Support, Team Leader, Customer
--   Care, Administrative, إداري) never appear as scored SC blocks in any of the 6
--   workbooks, so there is no pre-rule evidence to honour and nothing to scope —
--   changing them would invent behaviour instead of recording it.
--
--   IDEMPOTENT (UPDATE keyed on the function, safe to re-run). Source of truth:
--   kpi-seed.ts — the jest spec asserts SQL ↔ TS parity.
-- ═══════════════════════════════════════════════════════════════════════════

-- OV QUALITY Offline@2026-07-11 0
UPDATE kpi_function_config c SET
  applies_from = DATE '2026-07-11',
  weight = 0, target = NULL,
  -- OVBAND QUALITY Offline@2026-07-11
  band = '{"type":"info","note":"QUALITY not applicable — no QA evaluation (Director rule 2026-07-11, forward-only per D-081b)"}'::jsonb,
  updated_at = NOW()
FROM kpi_registry r
WHERE r.id = c.kpi_id AND r.kpi_code = 'QUALITY' AND c.function_name = 'Offline';

-- OV QUALITY Internship Offline@2026-07-11 0
UPDATE kpi_function_config c SET
  applies_from = DATE '2026-07-11',
  weight = 0, target = NULL,
  -- OVBAND QUALITY Internship Offline@2026-07-11
  band = '{"type":"info","note":"QUALITY not applicable — no QA evaluation (Director rule 2026-07-11, forward-only per D-081b)"}'::jsonb,
  updated_at = NOW()
FROM kpi_registry r
WHERE r.id = c.kpi_id AND r.kpi_code = 'QUALITY' AND c.function_name = 'Internship Offline';

-- Audit trail: the rulebook change itself is a formula version.
INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id,
       COALESCE((SELECT MAX(version) FROM scorecard_formula_versions v WHERE v.kpi_id = r.id), 0) + 1,
       r.id,
       'D-081b (Director 2026-07-22): the Offline / Internship Offline QUALITY not-applicable rule is FORWARD-ONLY from 2026-07-11. Feb + May 2026 keep the scores their sheets awarded.',
       jsonb_build_object('decision', 'D-081b', 'applies_from', '2026-07-11',
                          'functions', jsonb_build_array('Offline', 'Internship Offline'),
                          'evidence', 'Feb + May 2026 SC sheets score these blocks (10 pts at 80%, 30 at 97.5%); the rule postdates both months',
                          'pre_rule_band', 'the KPI-level QUALITY band applies before 2026-07-11'),
       DATE '2026-07-11'
FROM kpi_registry r WHERE r.kpi_code = 'QUALITY';
