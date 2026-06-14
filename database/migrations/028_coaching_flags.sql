-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 028: Coaching trigger engine — auto-detected coaching flags
-- A background scan flags employees with repeated attendance issues (late /
-- early-out / missing punch) over a rolling window. Flags feed the coaching
-- workflow (a flag can spawn a scheduled coaching_session).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS coaching_flags (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  trigger_type        VARCHAR(40) NOT NULL,   -- repeated_late, repeated_early_out, missing_punch
  period_days         INT NOT NULL DEFAULT 30,
  occurrences         INT NOT NULL DEFAULT 0,
  detail              VARCHAR(200),
  evidence            JSONB,
  severity            VARCHAR(10) NOT NULL DEFAULT 'low',  -- low, medium, high
  status              VARCHAR(20) NOT NULL DEFAULT 'open',  -- open, addressed, dismissed
  coaching_session_id UUID REFERENCES coaching_sessions(id) ON DELETE SET NULL,
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Only one OPEN flag per employee + trigger type (idempotent scans).
CREATE UNIQUE INDEX IF NOT EXISTS uq_coaching_flag_open
  ON coaching_flags(tenant_id, employee_id, trigger_type)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_coaching_flags_status
  ON coaching_flags(tenant_id, status);

COMMENT ON TABLE coaching_flags IS 'Auto-detected coaching triggers from repeated attendance issues.';
