-- 054_roster_days_adherence.sql
-- Add scheduled-shift context + adherence to roster_days, so the roster shows
-- system late-in / early-out measured AGAINST the scheduled shift and a per-day
-- conformance %, plus flags when system login/logout doesn't match the punch.

ALTER TABLE roster_days
  ADD COLUMN IF NOT EXISTS shift_code      TEXT,
  ADD COLUMN IF NOT EXISTS shift_start_min INTEGER,
  ADD COLUMN IF NOT EXISTS shift_end_min   INTEGER,   -- +1440 when the shift crosses midnight
  ADD COLUMN IF NOT EXISTS sys_late_min    INTEGER NOT NULL DEFAULT 0,   -- system login after shift start
  ADD COLUMN IF NOT EXISTS sys_early_min   INTEGER NOT NULL DEFAULT 0,   -- system logout before shift end
  ADD COLUMN IF NOT EXISTS adherence_pct   NUMERIC(5,1),                 -- per-day conformance %
  ADD COLUMN IF NOT EXISTS mismatch        TEXT;                         -- e.g. 'no-system','sys-late','early-logout','punch≠system'
