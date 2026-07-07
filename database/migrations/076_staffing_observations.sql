-- 076: The LEARNING STORE — hourly measured workload per channel, rolled up from
-- Sprinklr snapshots (integration_snapshots). avg(inProgress) IS the offered
-- traffic in Erlangs, measured directly (no volume×AHT estimation error).
-- The staffing engine blends these learned curves into its forecast; aht/acw/hold
-- columns are ready for the day the bridge captures per-contact handle stats.

CREATE TABLE IF NOT EXISTS staffing_observations (
  tenant_id       UUID        NOT NULL,
  obs_hour        TIMESTAMPTZ NOT NULL,   -- truncated to the hour (Kuwait wall clock stored as tz)
  channel         TEXT        NOT NULL,
  source          TEXT        NOT NULL DEFAULT 'sprinklr',
  erlangs         NUMERIC(10,3) NOT NULL, -- avg concurrent inProgress across samples
  waiting_avg     NUMERIC(10,3) NOT NULL DEFAULT 0,
  agents_online   NUMERIC(10,2),
  samples         INTEGER     NOT NULL,
  aht_sec         NUMERIC(10,1),          -- NULL until the bridge captures handle stats
  acw_sec         NUMERIC(10,1),
  hold_sec        NUMERIC(10,1),
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, obs_hour, channel, source)
);
CREATE INDEX IF NOT EXISTS idx_staffing_obs_lookup ON staffing_observations (tenant_id, channel, obs_hour);
