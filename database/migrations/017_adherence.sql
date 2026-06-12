-- 017_adherence.sql
-- Schedule Adherence Engine: scheduled shift vs actual Sprinklr activity.
--
-- adherence_pct   = in-adherence minutes / tracked scheduled minutes
--                   (in-adherence = online: available/idle/busy during the shift)
-- conformance_pct = total online minutes that day / scheduled minutes
--                   (worked the right AMOUNT, regardless of WHEN)
-- Untracked minutes (extension offline, no snapshots) are excluded from the
-- denominator and reported separately — never silently counted either way.

CREATE TABLE IF NOT EXISTS adherence_daily (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stat_date             date NOT NULL,
  employee_id           uuid REFERENCES employees(id) ON DELETE CASCADE,
  sprinklr_agent_id     varchar(100),
  agent_name            varchar(200),
  shift_code            varchar(20),
  scheduled_start       timestamptz,
  scheduled_end         timestamptz,

  scheduled_minutes     integer NOT NULL DEFAULT 0,
  tracked_minutes       integer NOT NULL DEFAULT 0,  -- scheduled minutes covered by snapshots
  in_adherence_minutes  integer NOT NULL DEFAULT 0,  -- online during shift
  break_in_shift_minutes integer NOT NULL DEFAULT 0, -- break/away during shift
  offline_in_shift_minutes integer NOT NULL DEFAULT 0,
  worked_total_minutes  integer NOT NULL DEFAULT 0,  -- online whole day (for conformance)

  adherence_pct         numeric(5,1),
  conformance_pct       numeric(5,1),

  deviations            jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{from,to,state}] out-of-adherence segments
  computed_at           timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, stat_date, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_adherence_date ON adherence_daily (tenant_id, stat_date);
CREATE INDEX IF NOT EXISTS idx_adherence_emp  ON adherence_daily (tenant_id, employee_id, stat_date);
