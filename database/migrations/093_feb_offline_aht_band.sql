-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 093: FEB-2026 `Offline` AHT is scored on the INBOUND band
--   (D-081c, Director 2026-07-22).
--
--   The Director confirmed the February Offline block was deliberately scored on
--   a voice band rather than the email 48h shape. The SHEET decides which voice
--   band, and it is the INBOUND one — its formula references $O$2..$O$8:
--
--     IF(AND(P>=$O$3,P<=$O$6),15, IF(AND(P>$O$6,P<=$O$2),10,
--        IF(AND(P>$O$2,P<$O$8),0, IF(AND(P<$O$4,P>=$O$8),-10,
--           IF(AND(P>=$O$4,P<$O$3),5, IF(P<$O$4,-10,""))))))
--
--   NOT the chat band ($N$ refs): the awarded points prove it — 2:35 → 5, which
--   the chat band would have paid 15. Encoding "chat" literally would have scored
--   those agents HIGHER than the Director's own workbook.
--
--   Scope: February 2026 only. May's Offline block is email-shaped (undated rule,
--   unchanged) and no other 2026 workbook carries an Offline block at all.
--
--   IDEMPOTENT. Needs m091 (applies_to). Source of truth: kpi-seed.ts — the jest
--   spec asserts SQL ↔ TS parity. Apply by direct pg, NOT migrate.js.
-- ═══════════════════════════════════════════════════════════════════════════

-- OV AHT Offline@2026-02-01 15
INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from, applies_to)
SELECT r.tenant_id, r.id, 'Offline', 15, 0.06666666666666667,
  -- OVBAND AHT Offline@2026-02-01
  '{"type":"threshold_hours","transform":"dayfrac_to_hours","bands":[{"lte":0.041666665666666665,"points":-10},{"lte":0.049999999,"points":5},{"lte":0.06666666766666667,"points":15},{"lte":0.075000001,"points":10},{"lte":0.08333333233333333,"points":0}],"default":0}'::jsonb,
  DATE '2026-02-01', DATE '2026-02-28'
FROM kpi_registry r WHERE r.kpi_code = 'AHT'
ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
  weight=EXCLUDED.weight, target=EXCLUDED.target, band=EXCLUDED.band,
  applies_to=EXCLUDED.applies_to, updated_at=NOW();

-- Audit trail: the rulebook change itself is a formula version.
INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from)
SELECT r.tenant_id,
       COALESCE((SELECT MAX(version) FROM scorecard_formula_versions v WHERE v.kpi_id = r.id), 0) + 1,
       r.id,
       'D-081c (Director 2026-07-22): Feb-2026 Offline AHT is scored on the INBOUND band, not email. The sheet formula ($O$2..$O$8) decides the shape — the Director''s "chat" label would have paid 15 where his own sheet pays 5.',
       jsonb_build_object('decision', 'D-081c', 'period', '2026-02-01..2026-02-28', 'function', 'Offline',
                          'band', 'inbound 6-band ($O$2..$O$8)',
                          'evidence', 'Feb sheet AHT formula references $O$ constants; awarded points 2:35 -> 5 (chat band would pay 15), 3:14 -> 15, 3:26 -> 15'),
       DATE '2026-02-01'
FROM kpi_registry r WHERE r.kpi_code = 'AHT';
