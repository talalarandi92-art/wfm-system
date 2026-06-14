-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 025: Phase-1 new request types — Emergency Leave + Attendance Correction
-- (Transformation roadmap — confirmed Phase 1 scope.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. New request_types for every tenant (idempotent) ─────────────────────
INSERT INTO request_types
  (tenant_id, code, name, name_ar, requires_peer_acceptance, requires_coverage_check,
   requires_attachment, sla_hours, approval_levels, is_active, sort_order)
SELECT t.id, v.code, v.name, v.name_ar, v.peer, v.cov, v.att, v.sla, v.levels, TRUE, v.sort
FROM tenants t
CROSS JOIN (VALUES
  ('emergency_leave',       'Emergency Leave',       'إجازة طارئة',   FALSE, TRUE,  FALSE, 2,  1, 7),
  ('attendance_correction', 'Attendance Correction', 'تصحيح حضور',    FALSE, FALSE, TRUE,  24, 1, 8)
) AS v(code, name, name_ar, peer, cov, att, sla, levels, sort)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ── 2. Attendance-correction detail (request envelope + this extension) ────
CREATE TABLE IF NOT EXISTS request_attendance_corrections (
  request_id       UUID PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  attendance_date  DATE NOT NULL,
  -- what kind of fix
  correction_type  VARCHAR(40) NOT NULL,   -- missing_punch_in, missing_punch_out, missing_login, missing_logout, wrong_time, other
  -- which attendance column to correct
  field            VARCHAR(40),            -- punch_in, punch_out, system_login, system_logout
  requested_value  TIME,                   -- the corrected clock time
  current_value    TIME,                   -- what is there now (optional, for the audit trail)
  reason           TEXT NOT NULL,
  applied          BOOLEAN NOT NULL DEFAULT FALSE,
  applied_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_req_att_corr_date
  ON request_attendance_corrections(attendance_date);

COMMENT ON TABLE request_attendance_corrections IS
  'Attendance correction requests — fix missing/incorrect fingerprint or system login times; applied to attendance_records on approval.';
