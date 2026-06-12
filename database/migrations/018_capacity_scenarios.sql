-- 018_capacity_scenarios.sql
-- Saved capacity-planning scenarios + daily channel demand history (P50/P90 source).
-- Canon: size to P90 (Cleveland), cap occupancy ≤85% (Reinertsen), Erlang-C (Erlang 1909).

CREATE TABLE IF NOT EXISTS capacity_scenarios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          varchar(120) NOT NULL,
  channel       varchar(20) NOT NULL,           -- voice | chat | whatsapp | email | social
  scenario_type varchar(20) NOT NULL DEFAULT 'base',  -- base | shrinkage | ot | emergency
  inputs        jsonb NOT NULL,                 -- full engine inputs (volumes, AHT, SL, shrinkage…)
  results       jsonb NOT NULL,                 -- computed plan (intervals, totals, gaps)
  notes         text,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name, channel)
);

CREATE INDEX IF NOT EXISTS idx_cap_scenarios ON capacity_scenarios (tenant_id, channel, created_at DESC);

-- Daily demand per channel — accumulated automatically from Sprinklr snapshots
-- so P50/P90/P99 sizing gets real history instead of guesses.
CREATE TABLE IF NOT EXISTS channel_demand_daily (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  demand_date   date NOT NULL,
  channel       varchar(20) NOT NULL,
  contacts      integer NOT NULL DEFAULT 0,     -- handled/received contact count
  peak_waiting  integer NOT NULL DEFAULT 0,     -- max simultaneous waiting observed
  avg_aht_sec   numeric(8,1),
  source        varchar(20) NOT NULL DEFAULT 'sprinklr',
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, demand_date, channel)
);

CREATE INDEX IF NOT EXISTS idx_channel_demand ON channel_demand_daily (tenant_id, channel, demand_date DESC);
