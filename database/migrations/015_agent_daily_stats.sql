-- 015_agent_daily_stats.sql
-- Sprinklr agent ↔ system employee mapping + daily per-agent performance rollups.
-- Lookup chain: sprinklr agent email → users.email → users.employee_id → employees.

-- ── Sprinklr agent → system user/employee map ────────────────────────────────
CREATE TABLE IF NOT EXISTS sprinklr_agent_map (
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sprinklr_agent_id  varchar(100) NOT NULL,
  agent_name         varchar(200),
  agent_email        varchar(255),
  user_id            uuid REFERENCES users(id)     ON DELETE SET NULL,
  employee_id        uuid REFERENCES employees(id) ON DELETE SET NULL,
  first_seen         timestamptz NOT NULL DEFAULT now(),
  last_seen          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sprinklr_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_map_email
  ON sprinklr_agent_map (tenant_id, lower(agent_email));

-- ── Daily per-agent stats (computed from integration_snapshots timeline) ─────
CREATE TABLE IF NOT EXISTS agent_daily_stats (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stat_date              date NOT NULL,
  sprinklr_agent_id      varchar(100) NOT NULL,
  agent_name             varchar(200),
  agent_email            varchar(255),
  employee_id            uuid REFERENCES employees(id) ON DELETE SET NULL,

  first_login            timestamptz,
  last_logout            timestamptz,

  total_working_minutes  integer NOT NULL DEFAULT 0,  -- idle + busy
  idle_no_case_minutes   integer NOT NULL DEFAULT 0,  -- available, no case assigned
  idle_with_case_minutes integer NOT NULL DEFAULT 0,  -- available but holding case(s)
  busy_minutes           integer NOT NULL DEFAULT 0,
  break_minutes          integer NOT NULL DEFAULT 0,
  offline_minutes        integer NOT NULL DEFAULT 0,

  contacts_received      integer,
  aht_seconds            numeric(10,2),
  avg_response_seconds   numeric(10,2),

  status_minutes         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- raw per-status breakdown
  extra                  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- any extra Sprinklr measurements
  computed_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, stat_date, sprinklr_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_daily_date ON agent_daily_stats (tenant_id, stat_date);
CREATE INDEX IF NOT EXISTS idx_agent_daily_emp  ON agent_daily_stats (tenant_id, employee_id);
