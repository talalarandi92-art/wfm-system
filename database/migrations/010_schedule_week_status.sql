-- Migration 010: Schedule Week Status (Publish / Lock workflow)
-- Tracks the publish/lock state of a schedule week independent of
-- the schedule_versions table (which is for auto-generated schedules).

BEGIN;

CREATE TABLE IF NOT EXISTS schedule_week_status (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  week_start    DATE         NOT NULL,
  status        TEXT         NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft','published','locked')),
  published_at  TIMESTAMPTZ,
  published_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  locked_at     TIMESTAMPTZ,
  locked_by     UUID         REFERENCES users(id) ON DELETE SET NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_sched_week_status_tenant
  ON schedule_week_status(tenant_id, week_start);

COMMENT ON TABLE schedule_week_status IS
  'Publish/lock lifecycle for each schedule week. Imported weeks start as draft.';

COMMIT;
