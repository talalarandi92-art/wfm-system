-- 016_agent_violations.sql
-- Compliance engine: per-day agent violations + break-type breakdown.
-- Violation types:
--   excess_break             — total daily breaks (tea+lunch+bio+prayer+...) > threshold (60 min)
--   late_login               — first Sprinklr login after scheduled shift start (no permission)
--   early_logout             — last Sprinklr activity before scheduled shift end (no permission)
--   off_schedule             — agent active on Sprinklr with no scheduled shift that day
--   unauthorized_meeting     — meeting status time without an approved request
--   unauthorized_manual_dial — manual/outbound dial status without an approved request

ALTER TABLE agent_daily_stats
  ADD COLUMN IF NOT EXISTS break_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS agent_violations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  violation_date     date NOT NULL,
  sprinklr_agent_id  varchar(100) NOT NULL,
  agent_name         varchar(200),
  agent_email        varchar(255),
  employee_id        uuid REFERENCES employees(id) ON DELETE SET NULL,

  violation_type     varchar(40) NOT NULL,
  severity           varchar(10) NOT NULL DEFAULT 'low',   -- low | medium | high
  minutes            integer,                              -- magnitude (late mins, excess mins…)
  shift_start        timestamptz,
  shift_end          timestamptz,
  actual_at          timestamptz,                          -- actual login/logout/event time
  details            jsonb NOT NULL DEFAULT '{}'::jsonb,

  status             varchar(20) NOT NULL DEFAULT 'open',  -- open | reviewed | justified
  reviewed_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, violation_date, sprinklr_agent_id, violation_type)
);

CREATE INDEX IF NOT EXISTS idx_violations_date ON agent_violations (tenant_id, violation_date);
CREATE INDEX IF NOT EXISTS idx_violations_type ON agent_violations (tenant_id, violation_type, status);
CREATE INDEX IF NOT EXISTS idx_violations_emp  ON agent_violations (tenant_id, employee_id);
