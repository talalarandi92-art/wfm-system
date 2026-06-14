-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 030: Reporting bot — recipes + generated runs
-- The reporter composes a daily WFM report from the analyst + health guard +
-- core metrics, on a schedule the operator defines (a "recipe"). Each generation
-- is stored as a run (payload kept as JSONB; Excel built on demand from it).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS report_recipes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          VARCHAR(120) NOT NULL,
  sections      JSONB NOT NULL DEFAULT '["coverage","compliance","queues","schedule","requests","health"]'::jsonb,
  schedule_time VARCHAR(5),                      -- "HH:MM" local Kuwait time for the daily run; NULL = manual only
  recipients    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- user ids to notify
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipe_id     UUID REFERENCES report_recipes(id) ON DELETE SET NULL,
  recipe_name   VARCHAR(120),
  run_date      DATE NOT NULL,
  sections      JSONB NOT NULL,
  payload       JSONB NOT NULL,                  -- full computed report (drives view + Excel)
  summary       TEXT,                            -- one-line headline
  trigger       VARCHAR(12) NOT NULL DEFAULT 'manual',  -- manual, scheduled
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_runs_recent
  ON report_runs(tenant_id, generated_at DESC);

-- One scheduled run per recipe per date (idempotent daily loop).
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_run_sched
  ON report_runs(tenant_id, recipe_id, run_date)
  WHERE trigger = 'scheduled';

COMMENT ON TABLE report_recipes IS 'Operator-defined report templates + daily schedule.';
COMMENT ON TABLE report_runs IS 'Generated report instances (payload drives both the view and the Excel export).';
