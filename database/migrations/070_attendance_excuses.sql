-- Attendance excuses — the "excuse layer" that ties requests + technical issues to the roster.
-- An APPROVED Odoo request (permission/sick/leave/comp/OT/official-task) OR a WFM-VALIDATED technical
-- issue that EXCUSES a roster deviation (late/early/absence) for a person-day. The roster reports/recon
-- read this to EXCLUDE the deviation from conformance + penalty and to LABEL the reason
-- (e.g. "late due to a validated technical issue"). Only approved/validated things become excuses;
-- pending stays a notification, refused stays a notification (never an excuse).
CREATE TABLE IF NOT EXISTS attendance_excuses (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  person_no   text NOT NULL,
  work_date   date NOT NULL,
  kind        text NOT NULL,      -- permission_late | permission_early | sick | leave | comp | overtime | official_task | technical
  source      text NOT NULL,      -- odoo | technical_issue
  ref         text,               -- SKL/…, permission id, technical_issue id
  window_from text, window_to text,
  hours       numeric,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_excuse ON attendance_excuses (tenant_id, person_no, work_date, kind, COALESCE(ref, ''));
CREATE INDEX IF NOT EXISTS idx_excuse_pd ON attendance_excuses (tenant_id, person_no, work_date);
