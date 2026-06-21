-- 046_attrition_events.sql
-- Attrition leavers extracted from RES/TER shift codes in the schedule. Stored
-- standalone (NOT via employees FK) because leavers are often already removed
-- from the active employee roster — we still need them for multi-year attrition.

CREATE TABLE IF NOT EXISTS attrition_events (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        UUID NOT NULL,
  employee_no      TEXT NOT NULL,
  name             TEXT,
  function_name    TEXT,
  type             TEXT NOT NULL,             -- 'resignation' (RES) | 'termination' (TER)
  leave_date       DATE NOT NULL,             -- the RES/TER date
  last_working_day DATE,                      -- last real shift before the marker
  year             INTEGER NOT NULL,
  source           TEXT DEFAULT 'schedule',
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, employee_no, leave_date)
);

CREATE INDEX IF NOT EXISTS idx_attrition_year ON attrition_events (tenant_id, year);

-- Per-year headcount (distinct employees that actually worked that year, from the
-- schedule) — the denominator for the attrition rate of historical years.
CREATE TABLE IF NOT EXISTS attrition_headcount_yearly (
  tenant_id  UUID NOT NULL,
  year       INTEGER NOT NULL,
  headcount  INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, year)
);
