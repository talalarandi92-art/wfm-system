-- 067_agent_status_events.sql
-- Per-agent status-change event log, built by diffing consecutive Sprinklr snapshots.
-- Unlocks: live "in current status for X min" counters, live idle/break running timers,
-- and a true per-agent status timeline (vs the point-in-time snapshots we had before).
--
-- One OPEN row per agent at a time (ended_at IS NULL = currently in this status).
-- When the agent's status changes, the open row is closed (ended_at + duration_sec)
-- and a new open row is inserted.

CREATE TABLE IF NOT EXISTS agent_status_events (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  sprinklr_agent_id TEXT NOT NULL,
  agent_name        TEXT,
  email             TEXT,
  employee_id       UUID,
  status            TEXT NOT NULL,         -- normalized: available/idle/busy/break/away/offline/unknown
  status_raw        TEXT,                  -- original Sprinklr label ("Bio Break", "Lunch", "Manual Dial"…)
  started_at        TIMESTAMPTZ NOT NULL,
  ended_at          TIMESTAMPTZ,           -- NULL = still in this status (open)
  duration_sec      INTEGER,               -- filled when the row is closed
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ase_tenant_agent_started
  ON agent_status_events (tenant_id, sprinklr_agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ase_tenant_started
  ON agent_status_events (tenant_id, started_at DESC);

-- At most one OPEN (un-ended) event per agent per tenant — protects against races.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ase_open
  ON agent_status_events (tenant_id, sprinklr_agent_id)
  WHERE ended_at IS NULL;
