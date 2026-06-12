-- Migration 011: Outage Enhancements
-- Adds: notes, attachments, SLA target per record, RTA handler tracking

BEGIN;

-- SLA target per outage record (minutes)
ALTER TABLE outages
  ADD COLUMN IF NOT EXISTS sla_target_minutes INTEGER;

-- Set defaults by severity for existing records
UPDATE outages SET sla_target_minutes = CASE severity::text
  WHEN 'critical' THEN 30
  WHEN 'high'     THEN 60
  WHEN 'medium'   THEN 120
  WHEN 'low'      THEN 240
  ELSE 60
END WHERE sla_target_minutes IS NULL;

-- Set sla_due_at if not already set
UPDATE outages
  SET sla_due_at = started_at + (sla_target_minutes || ' minutes')::interval
WHERE sla_due_at IS NULL AND sla_target_minutes IS NOT NULL;

-- ── Outage Notes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outage_notes (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  outage_id   UUID         NOT NULL REFERENCES outages(id) ON DELETE CASCADE,
  tenant_id   UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  author_id   UUID         REFERENCES users(id) ON DELETE SET NULL,
  author_name VARCHAR(150),
  content     TEXT         NOT NULL,
  is_internal BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outage_notes_outage ON outage_notes(outage_id, created_at DESC);

-- ── Outage Attachments ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outage_attachments (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  outage_id     UUID         NOT NULL REFERENCES outages(id) ON DELETE CASCADE,
  tenant_id     UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  uploaded_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
  uploader_name VARCHAR(150),
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(100),
  file_size     INTEGER,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outage_attachments_outage ON outage_attachments(outage_id, created_at DESC);

COMMENT ON TABLE outage_notes IS 'Threaded notes and status updates on outages';
COMMENT ON TABLE outage_attachments IS 'Images and videos attached to outage records';

COMMIT;
