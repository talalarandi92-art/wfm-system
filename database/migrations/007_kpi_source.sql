-- ============================================================================
-- 007 — KPI Source Data (agent performance uploads)
--
-- Stores raw uploaded agent performance data (per-row from telephony/CRM
-- exports) and the weekly aggregated summaries used to feed scorecard.
-- Week boundaries: W1=1-7, W2=8-15, W3=16-22, W4=23-end of month.
-- ============================================================================

CREATE TABLE IF NOT EXISTS kpi_source_batches (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_name   VARCHAR(100) NOT NULL,    -- e.g. "June 2026"
  period_year   SMALLINT     NOT NULL,
  period_month  SMALLINT     NOT NULL,    -- 1-12
  channel_type  VARCHAR(50)  DEFAULT 'voice',  -- voice, chat, email, whatsapp, all
  total_rows    INT          DEFAULT 0,
  total_agents  INT          DEFAULT 0,
  uploaded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at   TIMESTAMPTZ  DEFAULT NOW(),
  status        VARCHAR(20)  DEFAULT 'active',
  notes         TEXT
);

-- Weekly aggregated summaries per agent per week
CREATE TABLE IF NOT EXISTS kpi_weekly_summaries (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  batch_id            UUID NOT NULL REFERENCES kpi_source_batches(id) ON DELETE CASCADE,

  -- Agent identity
  agent_name          VARCHAR(255),
  agent_login         VARCHAR(100),
  agent_no            VARCHAR(50),
  function_name       VARCHAR(100),
  team_leader         VARCHAR(100),

  -- Period
  week_label          VARCHAR(10) NOT NULL,   -- W1 W2 W3 W4 Final
  date_from           DATE,
  date_to             DATE,
  working_days        INT DEFAULT 0,

  -- Volume metrics
  total_contacts      INT DEFAULT 0,          -- calls / chats / emails handled
  total_login_minutes INT DEFAULT 0,          -- total login time in minutes

  -- AHT (Average Handle Time) in seconds
  avg_aht_seconds     NUMERIC(10,2),
  min_aht_seconds     NUMERIC(10,2),
  max_aht_seconds     NUMERIC(10,2),

  -- Response Time (for chat/email/social) in seconds
  avg_response_seconds NUMERIC(10,2),
  min_response_seconds NUMERIC(10,2),
  max_response_seconds NUMERIC(10,2),

  -- Quality / other metrics from file
  avg_quality         NUMERIC(6,4),   -- if present in source file
  avg_csat            NUMERIC(6,4),
  total_transfers     INT DEFAULT 0,
  total_holds         INT DEFAULT 0,

  -- Productivity / utilization
  productivity_pct    NUMERIC(6,4),   -- login_productive / total_login
  working_days_pct    NUMERIC(6,4),   -- working_days / scheduled_days

  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- CPO settings: stored in settings table as key/value, but also
-- a dedicated snapshot table for historical CPO tracking
CREATE TABLE IF NOT EXISTS cpo_settings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  function_name VARCHAR(100) NOT NULL,    -- or 'all' for global
  channel_type  VARCHAR(50)  DEFAULT 'voice',
  cpo_pct       NUMERIC(8,4) NOT NULL,   -- Calls Per Order %  e.g. 0.15 = 15%
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  notes         TEXT,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, function_name, channel_type, effective_from)
);

-- Seed a default global CPO of 15% for voice
INSERT INTO cpo_settings (tenant_id, function_name, channel_type, cpo_pct, notes)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'all', 'voice', 0.15, 'Default global CPO — 15% of orders result in a call'
) ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_kpi_summaries_batch  ON kpi_weekly_summaries(batch_id);
CREATE INDEX IF NOT EXISTS idx_kpi_summaries_agent  ON kpi_weekly_summaries(tenant_id, agent_login);
CREATE INDEX IF NOT EXISTS idx_kpi_batches_tenant   ON kpi_source_batches(tenant_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_cpo_tenant           ON cpo_settings(tenant_id, function_name);
