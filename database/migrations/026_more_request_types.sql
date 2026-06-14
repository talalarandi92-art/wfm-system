-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 026: Phase-1 remaining request types — University/Exam + Schedule Change
-- Completes the Phase-1 new-request-type set.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. New request_types for every tenant (idempotent) ─────────────────────
INSERT INTO request_types
  (tenant_id, code, name, name_ar, requires_peer_acceptance, requires_coverage_check,
   requires_attachment, sla_hours, approval_levels, is_active, sort_order)
SELECT t.id, v.code, v.name, v.name_ar, v.peer, v.cov, v.att, v.sla, v.levels, TRUE, v.sort
FROM tenants t
CROSS JOIN (VALUES
  ('university_exam', 'University / Exam', 'جامعة / امتحان', FALSE, TRUE,  TRUE,  24, 1, 9),
  ('schedule_change', 'Schedule Change',   'تغيير الجدول',   FALSE, TRUE,  FALSE, 24, 1, 10)
) AS v(code, name, name_ar, peer, cov, att, sla, levels, sort)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ── 2. Schedule-change detail (request envelope + this extension) ──────────
CREATE TABLE IF NOT EXISTS request_schedule_changes (
  request_id           UUID PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  change_date          DATE NOT NULL,
  current_shift_code   VARCHAR(30),
  requested_shift_code VARCHAR(30) NOT NULL,
  reason               TEXT NOT NULL,
  applied              BOOLEAN NOT NULL DEFAULT FALSE,
  applied_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_req_sched_change_date
  ON request_schedule_changes(change_date);

COMMENT ON TABLE request_schedule_changes IS
  'Schedule change requests — change an employee shift on a date; applied to attendance_records scheduled times on approval.';
