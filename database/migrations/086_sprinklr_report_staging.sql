-- Sprinklr REPORT-ROW staging (Auto-Ingest wave A0).
--
-- The Sprinklr chrome extension already intercepts the reportingQuery endpoint for LIVE
-- agent-status polling (queues + presence → /integrations/sprinklr/push → ingestSnapshot).
-- A0 adds a SECOND, separate channel: when a reportingQuery response carries grouped ROW
-- data (a reporting TABLE — login/logout, survey, or agent-performance), the extension
-- harvests those rows and POSTs them to /integrations/sprinklr/report-push, which stages
-- them here. This is the enabler that ends manual Sprinklr Excel uploads: later waves
-- (A1) read this table and emit the recon "Login and Logout sprinklr" shape.
--
-- One row per CAPTURED report payload (row_count = number of data rows inside `payload`).
-- Idempotent via content_hash (sha256 of report_type + the normalized rows) so the same
-- table re-captured on refresh does not duplicate.
--
-- NOTE (honesty): the exact reportingQuery JSON for the login/logout report was NOT captured
-- live (modal/renderer limits during the 2026-07-11 exploration). The parser + harvester are
-- built against a REALISTIC fixture derived from the documented columns
-- (SPRINKLR_LIVE_REPORTING_FINDINGS.md). The Director's live session must confirm the real
-- field mapping; `payload` keeps the raw captured shape so re-mapping needs no re-capture.
CREATE TABLE IF NOT EXISTS sprinklr_report_staging (
  id           bigserial   PRIMARY KEY,
  tenant_id    uuid        NOT NULL,
  report_type  text        NOT NULL,          -- login_logout | survey | agent_perf | unknown
  source_op    text,                          -- reportingQuery | queries | <endpoint>
  captured_at  timestamptz NOT NULL DEFAULT now(),
  day          date,                          -- when the whole report is a single day (else NULL)
  agent_email  text,                          -- when the whole report is a single agent (else NULL)
  payload      jsonb       NOT NULL,          -- { columns:[{key,label}], rows:[{dims,measures}], rawSample? }
  row_count    int         NOT NULL DEFAULT 0,
  content_hash text        NOT NULL,
  CONSTRAINT uq_sprinklr_report_staging_dedup UNIQUE (tenant_id, report_type, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_sprinklr_report_staging_type
  ON sprinklr_report_staging (tenant_id, report_type, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_sprinklr_report_staging_day
  ON sprinklr_report_staging (tenant_id, day);
