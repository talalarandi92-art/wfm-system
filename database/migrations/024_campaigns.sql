-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 024: Campaign / Blackout Calendar
-- Ops adds campaigns by date range + type. During the window, selected request
-- types are restricted/flagged and Required-HC can be uplifted to protect peak.
-- (Transformation Module 01 — confirmed by Ops.)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS campaigns (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                   VARCHAR(150) NOT NULL,
  campaign_type          VARCHAR(60)  NOT NULL DEFAULT 'flash_sale',  -- flash_sale, mega_sale, eid, ramadan, national_day, other
  start_date             DATE NOT NULL,
  end_date               DATE NOT NULL,
  restrict_requests      BOOLEAN NOT NULL DEFAULT TRUE,
  -- which request type-codes are blocked/flagged during the window
  restricted_types       JSONB   NOT NULL DEFAULT '["annual","emergency","shift_swap","off_swap","wfh"]'::jsonb,
  required_hc_uplift_pct INT     NOT NULL DEFAULT 0 CHECK (required_hc_uplift_pct BETWEEN 0 AND 200),
  color                  VARCHAR(20) DEFAULT '#f59e0b',
  notes                  TEXT,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_campaign_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_dates
  ON campaigns(tenant_id, start_date, end_date);

COMMENT ON TABLE  campaigns IS 'Campaign / blackout calendar — peak windows that restrict requests and uplift required HC.';
COMMENT ON COLUMN campaigns.restricted_types IS 'Array of request type-codes blocked or flagged during the window.';
COMMENT ON COLUMN campaigns.required_hc_uplift_pct IS 'Percent uplift applied to required HC during the campaign window.';
