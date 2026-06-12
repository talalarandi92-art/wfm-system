-- Migration 012: Technical Issues Workflow
-- Agents submit tech issues with photos/videos → RTA validates → converts to outage

BEGIN;

CREATE TABLE IF NOT EXISTS technical_issues (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title             VARCHAR(255) NOT NULL,
  description       TEXT,
  status            VARCHAR(30)  NOT NULL DEFAULT 'pending_rta'
                      CHECK (status IN ('pending_rta','validated','escalated_to_outage','resolved','rejected')),
  severity          VARCHAR(20)  NOT NULL DEFAULT 'medium'
                      CHECK (severity IN ('low','medium','high','critical')),
  function_name     VARCHAR(120),
  channel           VARCHAR(80),
  -- reporter
  reporter_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  reporter_name     VARCHAR(150),
  -- RTA action
  validated_by_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  validated_by_name VARCHAR(150),
  validated_at      TIMESTAMPTZ,
  rejection_reason  TEXT,
  -- escalation
  outage_id         UUID REFERENCES outages(id) ON DELETE SET NULL,
  escalated_at      TIMESTAMPTZ,
  -- resolution
  resolution_notes  TEXT,
  resolved_at       TIMESTAMPTZ,
  -- repeat detection
  repeat_count      INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ti_tenant_status    ON technical_issues(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ti_outage           ON technical_issues(outage_id) WHERE outage_id IS NOT NULL;

-- ── Technical Issue Attachments ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS technical_issue_attachments (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id      UUID         NOT NULL REFERENCES technical_issues(id) ON DELETE CASCADE,
  tenant_id     UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  uploaded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  uploader_name VARCHAR(150),
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(100),
  file_size     INTEGER,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tia_issue ON technical_issue_attachments(issue_id, created_at DESC);

COMMENT ON TABLE technical_issues IS 'Technical issues submitted by agents → RTA validation → outage escalation';
COMMENT ON TABLE technical_issue_attachments IS 'Photos/videos uploaded with tech issue reports';

COMMIT;
