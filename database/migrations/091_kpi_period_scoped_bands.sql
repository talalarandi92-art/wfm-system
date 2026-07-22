-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 091: PERIOD-SCOPED KPI bands + the May-2026 `Internship Inbound`
--   ruling (D-081, Director 2026-07-22).
--
--   A function's band is not always constant over time. Proven by the Director's
--   own sheet formulas for `Internship Inbound`:
--     • Jan 26  AHT = the inbound 6-band (`$O$` refs)  · RT = NOT scored (AG empty)
--     • May 26  AHT = `IF(P*24<=48,10,-10)` (email 48h) · RT = email 1h/2h/4h band,
--                all 45 rows carrying the formula
--     • Jun 26  AHT = back to the inbound 6-band       · RT = NOT scored again
--   The Director confirmed May was DELIBERATE, so it is a period rule, not an
--   outlier to be voted away by majority.
--
--   `kpi_function_config` already keys on (tenant, kpi, function_key, applies_from),
--   so a dated row is storable — but with no upper bound the May rule would leak
--   into June and beyond. This migration adds `applies_to` (NULL = open-ended) and
--   seeds the two May-only rows.
--
--   Resolution order (mirrored in kpi-seed/re-scorer `bandFor`): a dated config
--   whose window contains the scoring period wins; otherwise the undated config;
--   otherwise the KPI default. With no period to judge by we never guess a dated
--   rule — we fall back to the undated one.
--
--   IDEMPOTENT. Source of truth: kpi-seed.ts (the jest spec asserts SQL ↔ TS
--   parity). Apply by direct pg (rb-apply style), NOT migrate.js.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE kpi_function_config ADD COLUMN IF NOT EXISTS applies_to DATE NULL;

COMMENT ON COLUMN kpi_function_config.applies_to IS
  'Inclusive last day this config applies (NULL = open-ended). With applies_from it forms the period window for a time-scoped band — see D-081.';

-- ─── AHT · Internship Inbound · MAY 2026 ONLY (email 48h shape) ───
-- OV AHT Internship Inbound@2026-05-01 10
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from, applies_to)
SELECT r.tenant_id, r.id, 'Internship Inbound', 10, 48,
  -- OVBAND AHT Internship Inbound@2026-05-01
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":48,"points":10}],"default":-10}'::jsonb,
  DATE '2026-05-01', DATE '2026-05-31'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band,
  applies_to=EXCLUDED.applies_to, updated_at=NOW();

-- ─── RESPONSE_TIME · Internship Inbound · MAY 2026 ONLY (email 1h/2h/4h) ───
-- OV RESPONSE_TIME Internship Inbound@2026-05-01 15
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from, applies_to)
SELECT r.tenant_id, r.id, 'Internship Inbound', 15, 1,
  -- OVBAND RESPONSE_TIME Internship Inbound@2026-05-01
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":1,"points":15},{"lte":2,"points":10},{"lte":4,"points":5}],"default":-15}'::jsonb,
  DATE '2026-05-01', DATE '2026-05-31'
FROM kpi_registry r WHERE r.kpi_code = 'RESPONSE_TIME'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band,
  applies_to=EXCLUDED.applies_to, updated_at=NOW();

-- Audit trail: the rulebook change itself is a formula version.
INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id,
       COALESCE((SELECT MAX(version) FROM scorecard_formula_versions v WHERE v.kpi_id = r.id), 0) + 1,
       r.id,
       'D-081 (Director 2026-07-22): May-2026 Internship Inbound is scored on the EMAIL shape — a period rule, not an outlier. Jan/June keep the inbound band. Adds period scoping (applies_to).',
       jsonb_build_object('decision', 'D-081', 'period', '2026-05-01..2026-05-31', 'function', 'Internship Inbound',
                          'evidence', 'sheet formulas: May AHT IF(P*24<=48,10,-10); May RT IF(AF<=TIME(1,0,0),15,...); Jan/June use the inbound 6-band and leave AG empty'),
       DATE '2026-05-01'
FROM kpi_registry r WHERE r.kpi_code IN ('AHT', 'RESPONSE_TIME');
