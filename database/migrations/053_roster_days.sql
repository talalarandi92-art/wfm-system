-- 053_roster_days.sql
-- Correct per-employee-per-day roster, combining ALL real sources the validated
-- way (see roster-reconcile): Odoo FingerPrint punch + Ameyo & Sprinklr system
-- login/logout (earliest login / latest logout, Sprinklr = Kuwait LOCAL) + Odoo
-- permission / comp-off / sick. Replaces the empty/incorrect recon roster.
-- Times stored as minutes-from-midnight (NULL = none); durations in minutes.

CREATE TABLE IF NOT EXISTS roster_days (
  tenant_id      UUID NOT NULL,
  employee_no    TEXT NOT NULL,
  name           TEXT,
  function_name  TEXT,
  work_date      DATE NOT NULL,
  day_name       TEXT,
  status         TEXT,                      -- raw FingerPrint status (WFH/Off/Absence/Leave/Late In/…)
  presence       TEXT,                      -- office | wfh | absent | leave | off | holiday | present
  punch_in_min   INTEGER, punch_out_min  INTEGER,
  sys_login_min  INTEGER, sys_logout_min INTEGER,
  login_src      TEXT,                      -- Ameyo | Sprinklr | Ameyo+Sprinklr
  late_min       INTEGER NOT NULL DEFAULT 0,
  early_min      INTEGER NOT NULL DEFAULT 0,
  ot_min         INTEGER NOT NULL DEFAULT 0,
  permission     TEXT, comp_off TEXT, sick TEXT,
  conforming     BOOLEAN,
  PRIMARY KEY (tenant_id, employee_no, work_date)
);
CREATE INDEX IF NOT EXISTS idx_roster_days_date ON roster_days (tenant_id, work_date);
CREATE INDEX IF NOT EXISTS idx_roster_days_emp  ON roster_days (tenant_id, employee_no);
CREATE INDEX IF NOT EXISTS idx_roster_days_pres ON roster_days (tenant_id, presence);
