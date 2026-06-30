-- 065_fairness_night_team.sql
-- Shift-fairness: optionally designate a dedicated NIGHT TEAM. Members are expected
-- to carry night/midnight, so the fair-rotation fairness score is computed over the
-- REST of the pool (and weekend-OFF fairness is measured within the team separately).
-- The user controls membership (his choice: fixed team vs fair distribution).
CREATE TABLE IF NOT EXISTS fairness_night_team (
  tenant_id  uuid        NOT NULL,
  person_no  text        NOT NULL,
  clean_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, person_no)
);
