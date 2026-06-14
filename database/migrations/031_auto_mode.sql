-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 031: Auto Mode — the Chief auto-decides requests by live coverage.
-- OFF by default. Auto-approve and auto-reject are independent toggles (reject is
-- the riskier one — left off unless explicitly enabled). Every automated action is
-- logged to automode_decisions AND audit_logs, attributed to whoever enabled it,
-- and fully reversible.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS automode_settings (
  tenant_id      UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled        BOOLEAN NOT NULL DEFAULT false,
  auto_approve   BOOLEAN NOT NULL DEFAULT true,    -- within the master switch
  auto_reject    BOOLEAN NOT NULL DEFAULT false,   -- HR-sensitive — opt-in only
  allowed_types  JSONB NOT NULL DEFAULT '["permission"]'::jsonb,
  updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automode_decisions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id    UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  request_type  VARCHAR(40),
  decision      VARCHAR(12) NOT NULL,             -- approve, reject, hold
  reason        VARCHAR(300),
  function_name VARCHAR(120),
  scope_date    DATE,
  metrics       JSONB,
  reverted      BOOLEAN NOT NULL DEFAULT false,
  reverted_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  reverted_at   TIMESTAMPTZ,
  decided_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automode_dec_recent ON automode_decisions(tenant_id, decided_at DESC);
-- One acted decision per request (don't re-decide the same request).
CREATE UNIQUE INDEX IF NOT EXISTS uq_automode_request
  ON automode_decisions(request_id) WHERE decision IN ('approve','reject');

COMMENT ON TABLE automode_settings IS 'Per-tenant Auto Mode switches (off by default; reject opt-in).';
COMMENT ON TABLE automode_decisions IS 'Audit of every automated request decision — reversible.';
