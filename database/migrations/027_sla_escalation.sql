-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 027: SLA auto-escalation tracking on requests
-- A background job escalates pending requests past their sla_due_at and notifies
-- WFM/RTA/Ops. These columns make escalation idempotent (escalate once).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS escalated_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalation_level INT NOT NULL DEFAULT 0;

-- Fast lookup of overdue, not-yet-escalated, still-open requests.
CREATE INDEX IF NOT EXISTS idx_requests_sla_open
  ON requests(sla_due_at)
  WHERE escalated_at IS NULL AND status IN ('pending','peer_pending');

COMMENT ON COLUMN requests.escalated_at IS 'When the SLA-breach escalation fired (NULL = not escalated).';
COMMENT ON COLUMN requests.escalation_level IS 'Escalation tier reached (0 = none, 1 = WFM/RTA/Ops notified).';
