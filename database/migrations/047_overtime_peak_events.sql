-- 047_overtime_peak_events.sql
-- Aggregates from the real Overtime workbooks (Desktop/ALL DATA/Overtime 20xx).
--   • peak_events    — one row per OT event/window (a holiday or peak sale). The
--     OT workbooks are organised one sheet per event, so each event tells us a
--     high-demand date range + how much extra coverage it needed. Powers the
--     "peak days" signal for forecasting / capacity.
--   • ot_monthly     — approved OT hours per employee per month (authoritative,
--     from the consolidated yearly OT files), for OT trend & ranking.
-- Raw rows are NOT stored — only these small aggregates.

CREATE TABLE IF NOT EXISTS peak_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    UUID NOT NULL,
  event_name   TEXT NOT NULL,
  year         INTEGER NOT NULL,
  start_date   DATE,
  end_date     DATE,
  headcount    INTEGER DEFAULT 0,        -- distinct employees who did OT in the event
  ot_hours     NUMERIC(10,2) DEFAULT 0,  -- total OT hours across the event
  source_file  TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, event_name, start_date)
);
CREATE INDEX IF NOT EXISTS idx_peak_events_year ON peak_events (tenant_id, year);

CREATE TABLE IF NOT EXISTS ot_monthly (
  tenant_id    UUID NOT NULL,
  employee_no  TEXT,                      -- nullable: 2024 file is name-only
  name         TEXT,
  year         INTEGER NOT NULL,
  month        INTEGER NOT NULL,          -- 1..12
  ot_hours     NUMERIC(10,2) NOT NULL DEFAULT 0,
  source       TEXT DEFAULT 'consolidated',
  PRIMARY KEY (tenant_id, year, month, name)
);
CREATE INDEX IF NOT EXISTS idx_ot_monthly_emp ON ot_monthly (tenant_id, employee_no);
