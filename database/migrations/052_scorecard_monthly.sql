-- 052_scorecard_monthly.sql
-- Per-agent monthly scorecard results extracted from the real monthly Score Card
-- workbooks (Score Card 2025/2026). Stores the reliable weekly Net Points + a
-- transparent monthly average (raw rows / per-KPI scoring stay with the dedicated
-- scorecard module). Feeds score trend, ranking and coaching.

CREATE TABLE IF NOT EXISTS scorecard_monthly (
  tenant_id      UUID NOT NULL,
  year           INTEGER NOT NULL,
  month          INTEGER NOT NULL,
  employee_no    TEXT NOT NULL,
  name           TEXT,
  function_name  TEXT,
  team_manager   TEXT,
  weekly_nets    NUMERIC(6,1)[],            -- raw weekly Net Points (transparency)
  weeks_scored   INTEGER NOT NULL DEFAULT 0,
  avg_net_points NUMERIC(6,1),             -- mean of non-null weekly nets
  best_net       NUMERIC(6,1),
  worst_net      NUMERIC(6,1),
  source_file    TEXT,
  PRIMARY KEY (tenant_id, year, month, employee_no)
);
CREATE INDEX IF NOT EXISTS idx_sc_month ON scorecard_monthly (tenant_id, year, month);
CREATE INDEX IF NOT EXISTS idx_sc_emp   ON scorecard_monthly (tenant_id, employee_no);
