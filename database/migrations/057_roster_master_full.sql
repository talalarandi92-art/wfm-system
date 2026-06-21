-- 057_roster_master_full.sql
-- Full WFM master fields: week/month context, original shift behind SL/A codes,
-- OT classification (off-day/holiday/comp), late category, data-quality flags +
-- per-7-day validation log.

ALTER TABLE roster_days
  ADD COLUMN IF NOT EXISTS week_number            INTEGER,     -- Saturday-start business week of year
  ADD COLUMN IF NOT EXISTS month_name             TEXT,
  ADD COLUMN IF NOT EXISTS attendance_status      TEXT,        -- human: Present / WFH / Sick Leave / Absence / OFF / Holiday / Annual Leave / COMP / Left
  ADD COLUMN IF NOT EXISTS original_shift_code     TEXT,       -- base shift behind a SL/A code (MS→M)
  ADD COLUMN IF NOT EXISTS original_shift_start_min INTEGER,
  ADD COLUMN IF NOT EXISTS original_shift_end_min   INTEGER,
  ADD COLUMN IF NOT EXISTS offday_ot_min          INTEGER NOT NULL DEFAULT 0,   -- worked on an OFF day
  ADD COLUMN IF NOT EXISTS holiday_ot_min         INTEGER NOT NULL DEFAULT 0,   -- worked on a Holiday
  ADD COLUMN IF NOT EXISTS comp_worked_min        INTEGER NOT NULL DEFAULT 0,   -- worked on a COMP day
  ADD COLUMN IF NOT EXISTS crosses_midnight       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS late_category          TEXT,        -- On time / 1-5 / 6-15 / 16-20 / 21-29 / 30-59 / 60+ / No show
  ADD COLUMN IF NOT EXISTS missing_punch          BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS missing_system         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS worked_min_system      INTEGER,
  ADD COLUMN IF NOT EXISTS data_quality           TEXT;

CREATE TABLE IF NOT EXISTS roster_validation_log (
  tenant_id   UUID NOT NULL,
  week_start  DATE NOT NULL,
  week_end    DATE NOT NULL,
  agents INTEGER, scheduled INTEGER, worked INTEGER, matched INTEGER, mismatches INTEGER,
  missing_punch INTEGER, missing_system INTEGER, wfh INTEGER, absent INTEGER, sick INTEGER,
  permissions INTEGER, comp INTEGER, ot_days INTEGER, tardy_days INTEGER, hr_mismatch INTEGER,
  data_quality_issues INTEGER, unknown_codes TEXT, created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tenant_id, week_start)
);
