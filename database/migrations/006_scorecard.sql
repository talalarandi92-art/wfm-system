-- ============================================================================
-- 006 — Scorecard module
--
-- Stores uploaded monthly scorecard data (parsed from the standard Excel
-- workbook used by Boutiqaat WFM: Feb SC 26 sheet structure).
-- Each upload creates a batch; entries hold per-employee per-week KPI scores.
-- ============================================================================

CREATE TABLE IF NOT EXISTS scorecard_batches (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_name   VARCHAR(100) NOT NULL,     -- e.g. "February 2026"
  period_year   SMALLINT     NOT NULL,
  period_month  SMALLINT     NOT NULL,     -- 1-12
  total_employees INT         DEFAULT 0,
  uploaded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at   TIMESTAMPTZ  DEFAULT NOW(),
  status        VARCHAR(20)  DEFAULT 'active',  -- active | archived
  notes         TEXT,
  UNIQUE (tenant_id, period_year, period_month)
);

CREATE TABLE IF NOT EXISTS scorecard_entries (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  batch_id              UUID NOT NULL REFERENCES scorecard_batches(id) ON DELETE CASCADE,

  -- Employee identity
  employee_no           VARCHAR(50),
  employee_name         VARCHAR(255),
  user_id_login         VARCHAR(100),
  function_name         VARCHAR(100),
  team_leader           VARCHAR(100),

  -- Period within the month
  week_label            VARCHAR(10) NOT NULL,   -- W1 W2 W3 W4 Final

  -- Attendance / schedule commitment
  working_days_pct      NUMERIC(6,4),   -- 0–1 fraction of scheduled days worked

  -- Net Points (sum of all component scores)
  net_points            INT,

  -- Quality KPI
  quality_actual        NUMERIC(8,4),   -- 0–1 (fraction; 1 = 100%)
  quality_score         INT,

  -- Response Rate (for some functions)
  response_rate         NUMERIC(8,4),

  -- PRR
  prr_rate              NUMERIC(8,4),
  prr_points            INT,
  prr_bonus             INT DEFAULT 0,

  -- AHT  (stored as Excel day-fraction; multiply × 1440 for minutes)
  aht_actual            NUMERIC(14,10),
  aht_score             INT,

  -- FCR / Success %
  fcr_actual            NUMERIC(8,4),
  fcr_score             INT,

  -- Productivity
  productivity_actual   NUMERIC(8,4),
  productivity_score    INT,

  -- CTR (Call-to-Ticket Ratio)
  ctr_actual            NUMERIC(8,4),
  ctr_score             INT,

  -- Quiz
  quiz_actual           NUMERIC(8,4),
  quiz_score            INT,

  -- Common Mistakes
  mistakes_actual       INT,
  mistakes_score        INT,

  -- Incidents
  incidents_actual      INT,
  incidents_score       INT,

  -- Attendance commitment score
  attendance_actual     NUMERIC(8,4),
  attendance_score      INT,

  -- Response Time  (Chat / SM&Email only; Excel day-fraction)
  response_time_actual  NUMERIC(14,10),
  response_time_score   INT,

  -- Rank within function for this week_label
  function_rank         INT,

  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sc_entries_batch    ON scorecard_entries(batch_id);
CREATE INDEX IF NOT EXISTS idx_sc_entries_tenant   ON scorecard_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sc_entries_fn_week  ON scorecard_entries(batch_id, function_name, week_label);
CREATE INDEX IF NOT EXISTS idx_sc_batches_tenant   ON scorecard_batches(tenant_id, period_year, period_month);
