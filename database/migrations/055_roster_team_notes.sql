-- 055_roster_team_notes.sql
-- Restore the roster detail the old page had: team / team-manager / gender, and
-- total worked hours per day. Manager notes live in a SEPARATE table so they
-- survive a roster_days re-import (which is delete+insert).

ALTER TABLE roster_days
  ADD COLUMN IF NOT EXISTS team_manager TEXT,
  ADD COLUMN IF NOT EXISTS team_group   TEXT,
  ADD COLUMN IF NOT EXISTS gender       TEXT,
  ADD COLUMN IF NOT EXISTS worked_min   INTEGER;   -- actual worked minutes (punch, else system)

CREATE TABLE IF NOT EXISTS roster_notes (
  tenant_id   UUID NOT NULL,
  employee_no TEXT NOT NULL,
  work_date   DATE NOT NULL,
  note        TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tenant_id, employee_no, work_date)
);
