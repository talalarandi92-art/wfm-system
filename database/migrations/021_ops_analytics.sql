-- ═══════════════════════════════════════════════════════════════════════════
-- 021 — Operations Analytics
-- Uploaded operations/contact-center data files → normalized contact rows
-- powering hourly heatmaps, payment/reason breakdowns, survey funnel,
-- rating sentiment, and per-agent ranking.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ops_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  file_name     TEXT,
  period_from   DATE,
  period_to     DATE,
  total_rows    INT DEFAULT 0,
  column_map    JSONB,                -- detected header → field mapping (for audit)
  uploaded_by   UUID,
  uploaded_at   TIMESTAMPTZ DEFAULT NOW(),
  status        TEXT DEFAULT 'committed',
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_ops_batches_tenant ON ops_batches (tenant_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS ops_contacts (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        UUID NOT NULL,
  batch_id         UUID NOT NULL REFERENCES ops_batches(id) ON DELETE CASCADE,
  contact_ts       TIMESTAMPTZ,
  contact_date     DATE,
  contact_hour     SMALLINT,          -- 0-23, derived from contact_ts
  channel          TEXT,
  payment_method   TEXT,
  contact_reason   TEXT,
  agent_name       TEXT,
  agent_login      TEXT,
  survey_sent      BOOLEAN DEFAULT FALSE,
  survey_clicked   BOOLEAN DEFAULT FALSE,
  rating_raw       TEXT,              -- original rating value as text
  rating_sentiment TEXT,              -- positive | negative | neutral | NULL
  raw              JSONB              -- full original row for future re-analysis
);

CREATE INDEX IF NOT EXISTS idx_ops_contacts_batch    ON ops_contacts (tenant_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_ops_contacts_date     ON ops_contacts (tenant_id, contact_date);
CREATE INDEX IF NOT EXISTS idx_ops_contacts_agent    ON ops_contacts (tenant_id, agent_login);
CREATE INDEX IF NOT EXISTS idx_ops_contacts_reason   ON ops_contacts (tenant_id, batch_id, contact_reason);
