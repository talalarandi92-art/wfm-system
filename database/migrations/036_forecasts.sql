-- 036_forecasts.sql
-- Persist generated volume forecasts + per-interval manual overrides (audited).
-- Lets planners save a forecast, override specific intervals with a reason, and
-- track forecast accuracy over time against actuals.

CREATE TABLE IF NOT EXISTS forecasts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text,
  range_from    date NOT NULL,
  range_to      date NOT NULL,
  channel       text,                 -- NULL = all channels
  history_weeks integer NOT NULL DEFAULT 8,
  model         text,
  target_sl     numeric(4,3),
  target_sec    integer,
  shrinkage     numeric(4,3),
  aht_seconds   numeric(10,2),
  data_points   integer NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_forecasts_tenant ON forecasts(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS forecast_intervals (
  id              bigserial PRIMARY KEY,
  forecast_id     uuid NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL,
  entry_date      date NOT NULL,
  hour            smallint NOT NULL,
  channel         text NOT NULL,
  forecast_volume numeric(10,1) NOT NULL DEFAULT 0,  -- model output (immutable)
  required_hc     integer,                           -- Erlang staffing for forecast_volume
  override_volume numeric(10,1),                     -- planner's manual value (NULL = use model)
  override_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  override_at     timestamptz,
  override_reason text
);
CREATE INDEX IF NOT EXISTS idx_forecast_intervals_fc
  ON forecast_intervals(forecast_id, entry_date, hour);
CREATE UNIQUE INDEX IF NOT EXISTS idx_forecast_intervals_cell
  ON forecast_intervals(forecast_id, entry_date, hour, channel);
