-- 037_tech_reports_rename_and_sla.sql
--
-- FIX (critical): the technical-issues module queries `agent_tech_reports` /
-- `agent_tech_report_attachments`, but migration 012 created them as
-- `technical_issues` / `technical_issue_attachments`. No migration ever created
-- the names the code uses, so every technical-issues endpoint failed at runtime
-- ("relation agent_tech_reports does not exist"). Rename the tables/column to
-- match the code. reports.service is updated in the same change.
--
-- Plus: add the 48h SLA + CX-repeat tracking the workflow requires.

ALTER TABLE IF EXISTS technical_issues             RENAME TO agent_tech_reports;
ALTER TABLE IF EXISTS technical_issue_attachments  RENAME TO agent_tech_report_attachments;
ALTER TABLE agent_tech_report_attachments          RENAME COLUMN issue_id TO report_id;

-- 48h SLA on the issue itself + systemic-CX flag (repeat_count already exists).
ALTER TABLE agent_tech_reports
  ADD COLUMN IF NOT EXISTS sla_target_minutes INTEGER NOT NULL DEFAULT 2880,  -- 48 hours
  ADD COLUMN IF NOT EXISTS sla_due_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_cx_issue        BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill SLA due for existing rows.
UPDATE agent_tech_reports
   SET sla_due_at = created_at + INTERVAL '48 hours'
 WHERE sla_due_at IS NULL;

-- Fast lookup of open + breached issues.
CREATE INDEX IF NOT EXISTS idx_agent_tech_reports_sla
  ON agent_tech_reports(tenant_id, sla_due_at)
  WHERE status NOT IN ('resolved', 'rejected');
