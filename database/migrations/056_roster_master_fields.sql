-- 056_roster_master_fields.sql
-- Extend roster_days to the full ROSTER "Shifts" schema so the reconciliation
-- mirrors the user's master sheet exactly, plus the convention-driven fields.

ALTER TABLE roster_days
  ADD COLUMN IF NOT EXISTS location          TEXT,        -- Office | WFH | ...
  ADD COLUMN IF NOT EXISTS shift_category    TEXT,        -- "Shift Time": Morning/Night/Midnight/Evening...
  ADD COLUMN IF NOT EXISTS shift_start2_min  INTEGER,     -- split-shift second segment
  ADD COLUMN IF NOT EXISTS shift_end2_min    INTEGER,
  ADD COLUMN IF NOT EXISTS sys_login2_min    INTEGER,     -- second system session (split)
  ADD COLUMN IF NOT EXISTS sys_logout2_min   INTEGER,
  ADD COLUMN IF NOT EXISTS total_work_sys_min INTEGER,    -- total system working minutes
  ADD COLUMN IF NOT EXISTS permission_type   TEXT,
  ADD COLUMN IF NOT EXISTS permission_duration TEXT,
  ADD COLUMN IF NOT EXISTS permission_status TEXT,
  ADD COLUMN IF NOT EXISTS attendance_code   TEXT,        -- report code: M / MS / MA / WFH / OFF / L ...
  ADD COLUMN IF NOT EXISTS hr_code           TEXT,        -- HR-matrix code: SL / A / WFH / OFF / L / H / <shift>
  ADD COLUMN IF NOT EXISTS ot_before_min     INTEGER NOT NULL DEFAULT 0,  -- OT before shift start
  ADD COLUMN IF NOT EXISTS ot_after_min      INTEGER NOT NULL DEFAULT 0,  -- OT after shift end
  ADD COLUMN IF NOT EXISTS is_7h             BOOLEAN DEFAULT FALSE,       -- mother / 7-hour shift
  ADD COLUMN IF NOT EXISTS is_20             BOOLEAN DEFAULT FALSE,       -- responsible/supervisor 8h "20"
  ADD COLUMN IF NOT EXISTS daily_note        TEXT,
  ADD COLUMN IF NOT EXISTS campaign          TEXT,
  ADD COLUMN IF NOT EXISTS source_sheet      TEXT DEFAULT 'shifts';
