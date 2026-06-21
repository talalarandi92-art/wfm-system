-- 050_agent_productivity_daily.sql
-- Per-agent per-day productivity rolled up from the Ameyo agent productivity
-- interval summary (raw intervals NOT stored — millions of rows → ~daily/agent).
-- Powers real AHT / ACW / occupancy / staffed / AUX-break analytics and adherence.

CREATE TABLE IF NOT EXISTS agent_productivity_daily (
  tenant_id        UUID NOT NULL,
  work_date        DATE NOT NULL,
  agent_login      TEXT NOT NULL,             -- Ameyo User ID (email local part)
  employee_no      TEXT,                       -- resolved via sprinklr_agent_map
  staffed_seconds  BIGINT NOT NULL DEFAULT 0,
  ready_seconds    BIGINT NOT NULL DEFAULT 0,
  break_seconds    BIGINT NOT NULL DEFAULT 0,  -- AUX / break
  idle_seconds     BIGINT NOT NULL DEFAULT 0,
  talk_seconds     BIGINT NOT NULL DEFAULT 0,
  acw_seconds      BIGINT NOT NULL DEFAULT 0,
  inbound_received INTEGER NOT NULL DEFAULT 0,
  wrapped_calls    INTEGER NOT NULL DEFAULT 0,
  source           TEXT DEFAULT 'ameyo',
  PRIMARY KEY (tenant_id, work_date, agent_login)
);
CREATE INDEX IF NOT EXISTS idx_apd_emp  ON agent_productivity_daily (tenant_id, employee_no);
CREATE INDEX IF NOT EXISTS idx_apd_date ON agent_productivity_daily (tenant_id, work_date);
