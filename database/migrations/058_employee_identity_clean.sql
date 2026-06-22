-- 058_employee_identity_clean.sql
-- ENTERPRISE DATA-INTEGRITY FOUNDATION
-- Root causes fixed by this migration + its backfill:
--   1. The SAME human exists in `employees` under multiple employee_no
--      (old intern 6xxx ID, often status=inactive, AND new full-time 13xxx ID,
--      status=active). The roster referenced different IDs on different dates,
--      so one person was counted as 2-3 people, and resigned/superseded IDs
--      still surfaced. -> collapse to ONE canonical person.
--   2. roster_days.function_name is polluted with SHIFT/LEAVE codes for ~60% of
--      rows (e.g. function="OFF" while shift="NR"). The authoritative function is
--      employees.function_id -> functions.name. -> carry a clean role_function.
--   3. Not all roles are 9h. RTA / Customer Care / Resolution Specialist /
--      Team Leader work 8h; mothers (M7/B7/C7/N7) 7h. They must be records-only
--      in default tardiness KPIs. -> carry expected_hours + include_tardiness.
--   4. Inactive/resigned employees must be excluded from default KPIs but kept
--      for historical audit. -> carry is_active.

-- ── Employee_Master_Clean: one row per real human (canonical identity) ──────────
CREATE TABLE IF NOT EXISTS employee_identity (
  tenant_id         UUID    NOT NULL,
  employee_no       TEXT    NOT NULL,            -- every raw id seen (old + new)
  person_no         TEXT    NOT NULL,            -- canonical id (the active/newest one)
  clean_name        TEXT    NOT NULL,            -- canonical display name
  status            TEXT    NOT NULL DEFAULT 'active',   -- active | inactive
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  is_canonical      BOOLEAN NOT NULL DEFAULT TRUE,       -- false => this id is an alias of person_no
  alias_of          TEXT,                                -- person_no this id collapses into (null if canonical)
  employment_type   TEXT,                                -- full_time | intern
  function_name     TEXT,                                -- AUTHORITATIVE function from master
  role_category     TEXT,                                -- Agent | Intern | Team Leader | RTA | Customer Care | Resolution Specialist | Back Office
  expected_hours    NUMERIC(4,2) NOT NULL DEFAULT 9,     -- 9 / 8 / 7
  include_tardiness  BOOLEAN NOT NULL DEFAULT TRUE,
  include_overtime   BOOLEAN NOT NULL DEFAULT TRUE,
  include_adherence  BOOLEAN NOT NULL DEFAULT TRUE,
  include_kpi        BOOLEAN NOT NULL DEFAULT TRUE,
  is_supervisor     BOOLEAN NOT NULL DEFAULT FALSE,
  gender            TEXT,
  team_leader       TEXT,
  team_group        TEXT,
  last_working_date DATE,
  notes             TEXT,
  PRIMARY KEY (tenant_id, employee_no)
);
CREATE INDEX IF NOT EXISTS idx_emp_identity_person ON employee_identity(tenant_id, person_no);
CREATE INDEX IF NOT EXISTS idx_emp_identity_active ON employee_identity(tenant_id, is_active);

-- ── Role_Working_Hours_Lookup: configurable, not hardcoded ──────────────────────
CREATE TABLE IF NOT EXISTS role_working_hours (
  tenant_id          UUID    NOT NULL,
  role_category      TEXT    NOT NULL,
  default_hours      NUMERIC(4,2) NOT NULL DEFAULT 9,
  include_tardiness  BOOLEAN NOT NULL DEFAULT TRUE,
  include_overtime   BOOLEAN NOT NULL DEFAULT TRUE,
  include_adherence  BOOLEAN NOT NULL DEFAULT TRUE,
  include_kpi        BOOLEAN NOT NULL DEFAULT TRUE,
  notes              TEXT,
  PRIMARY KEY (tenant_id, role_category)
);

-- ── Clean dimensions denormalised onto the fact for fast, simple KPI queries ─────
ALTER TABLE roster_days
  ADD COLUMN IF NOT EXISTS person_no         TEXT,            -- canonical id (joins to employee_identity.person_no)
  ADD COLUMN IF NOT EXISTS clean_name        TEXT,            -- canonical name (dedup display)
  ADD COLUMN IF NOT EXISTS role_function     TEXT,            -- AUTHORITATIVE function (not the polluted function_name)
  ADD COLUMN IF NOT EXISTS role_category     TEXT,            -- Agent / Team Leader / RTA / Customer Care / Resolution Specialist / Intern / Back Office
  ADD COLUMN IF NOT EXISTS expected_hours    NUMERIC(4,2),    -- 9 / 8 / 7 by role + mother shift
  ADD COLUMN IF NOT EXISTS include_tardiness BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS dup_alias         BOOLEAN NOT NULL DEFAULT FALSE;  -- this row's raw id was a superseded alias

CREATE INDEX IF NOT EXISTS idx_roster_person  ON roster_days(tenant_id, person_no);
CREATE INDEX IF NOT EXISTS idx_roster_active  ON roster_days(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_roster_roleinc ON roster_days(tenant_id, include_tardiness);
