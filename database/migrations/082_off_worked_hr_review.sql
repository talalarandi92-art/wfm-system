-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 082: OFF-worked → HR clarification, NOT auto-OT (Director decision 1, 2026-07-11)
--   When someone works on their scheduled OFF day (also worked-same-day on a
--   COMP or LEAVE day), the day STAYS an OFF day. We no longer auto-credit
--   payable off-day OT from that evidence. Instead the computed net hours are
--   parked in a NON-payable column (off_worked_min) and the row is flagged
--   off_worked_hr_review for HR to clarify ("scheduled OFF but worked this day").
--   Payable TRUE_OT (ot_min + offday_ot_min + holiday_ot_min) EXCLUDES these.
--   HOLIDAY-worked is unchanged (holiday_ot_min is a real policy, not this case).
--   Written by scripts/recon-build.js → recon-ingest.js on every rebuild.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE roster_days ADD COLUMN IF NOT EXISTS off_worked_min integer NOT NULL DEFAULT 0;
ALTER TABLE roster_days ADD COLUMN IF NOT EXISTS off_worked_hr_review boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_roster_off_worked ON roster_days (tenant_id, work_date) WHERE off_worked_hr_review;
