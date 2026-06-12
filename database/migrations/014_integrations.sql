-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 014: Integrations — Sprinklr + Odoo
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Sprinklr snapshot history ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source         VARCHAR(30) NOT NULL,   -- 'sprinklr', 'odoo'
  captured_at    TIMESTAMPTZ NOT NULL,
  queues_json    JSONB DEFAULT '[]',
  agents_json    JSONB DEFAULT '[]',
  queue_count    INT DEFAULT 0,
  agent_count    INT DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_snapshots_tenant_source
  ON integration_snapshots(tenant_id, source, captured_at DESC);

-- ─── Integration sync log (Odoo, future others) ────────────────────────────
CREATE TABLE IF NOT EXISTS integration_sync_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source          VARCHAR(30) NOT NULL,   -- 'odoo', 'sprinklr'
  data_type       VARCHAR(50),            -- 'employees', 'leaves', 'queues'
  total_records   INT DEFAULT 0,
  applied_records INT DEFAULT 0,
  error_count     INT DEFAULT 0,
  errors_json     JSONB DEFAULT '[]',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_sync_log_tenant
  ON integration_sync_log(tenant_id, source, created_at DESC);

-- ─── Add Odoo ID column to employees (if not exists) ─────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS odoo_id INT;
CREATE INDEX IF NOT EXISTS idx_employees_odoo_id ON employees(tenant_id, odoo_id);

-- ─── Add live_hc column to headcount_intervals (for Sprinklr live data) ──────
ALTER TABLE headcount_intervals ADD COLUMN IF NOT EXISTS live_hc     INT;
ALTER TABLE headcount_intervals ADD COLUMN IF NOT EXISTS live_updated_at TIMESTAMPTZ;

-- ─── Auto-cleanup: keep only last 7 days of snapshots (avoid bloat) ──────────
CREATE OR REPLACE FUNCTION cleanup_old_snapshots() RETURNS void AS $$
BEGIN
  DELETE FROM integration_snapshots
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;
