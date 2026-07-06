-- Odoo browser-bridge staging.
-- The chrome-extension-odoo bridge intercepts the Odoo web client's OWN data calls
-- (/web/dataset/call_kw · search_read · web_search_read) and pushes the returned records
-- here — so we can pull Supervisor-Requests (hr.leave / Extra-Hours / Comp-Off / Permissions
-- / hr.attendance) and any model straight from the browser session, WITHOUT an API key.
-- Idempotent by (tenant, model, odoo_id): re-capturing the same record just refreshes it.
CREATE TABLE IF NOT EXISTS odoo_staging (
  tenant_id   uuid        NOT NULL,
  model       text        NOT NULL,
  odoo_id     bigint      NOT NULL,
  data        jsonb       NOT NULL,
  write_date  timestamptz,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, model, odoo_id)
);
CREATE INDEX IF NOT EXISTS idx_odoo_staging_model ON odoo_staging (tenant_id, model, captured_at DESC);
