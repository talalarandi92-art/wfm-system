-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 034: Manual Break request type + Appointments/Exams attachment
--   1. New 'break' request type (employee submits a manual break) + extension table
--   2. Rename 'university_exam' → "Appointments & Exams" / "مواعيد و امتحانات"
--      (it already requires an attachment — now used for the schedule/appointment image)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. New 'break' request_type for every tenant (idempotent) ──────────────
INSERT INTO request_types
  (tenant_id, code, name, name_ar, requires_peer_acceptance, requires_coverage_check,
   requires_attachment, sla_hours, approval_levels, is_active, sort_order)
SELECT t.id, v.code, v.name, v.name_ar, v.peer, v.cov, v.att, v.sla, v.levels, TRUE, v.sort
FROM tenants t
CROSS JOIN (VALUES
  ('break', 'Manual Break', 'بريك يدوي', FALSE, TRUE, FALSE, 2, 1, 11)
) AS v(code, name, name_ar, peer, cov, att, sla, levels, sort)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ── 2. Break detail (request envelope + this extension) ────────────────────
CREATE TABLE IF NOT EXISTS request_breaks (
  request_id       UUID PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  break_date       DATE NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  duration_minutes INTEGER NOT NULL,
  break_type       VARCHAR(30) NOT NULL DEFAULT 'manual',  -- manual, lunch, coffee, prayer, medical, other
  reason           TEXT
);

CREATE INDEX IF NOT EXISTS idx_request_breaks_date
  ON request_breaks(break_date);

COMMENT ON TABLE request_breaks IS
  'Manual break requests submitted by employees through the unified requests envelope.';

-- ── 3. Rename university_exam → Appointments & Exams (keep code for compatibility) ──
UPDATE request_types
   SET name = 'Appointments & Exams',
       name_ar = 'مواعيد و امتحانات',
       requires_attachment = TRUE
 WHERE code = 'university_exam';
