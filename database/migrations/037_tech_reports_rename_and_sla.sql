-- 037_tech_reports_rename_and_sla.sql
--
-- The technical-issues module queries `agent_tech_reports` /
-- `agent_tech_report_attachments`. Depending on how a database was initialised
-- it may already have those tables (live installs) OR only the migration-012
-- `technical_issues` / `technical_issue_attachments`. This migration converges
-- both states to the names the code uses, idempotently, then adds the 48h SLA +
-- systemic-CX tracking columns. Safe to run on either state.

DO $$
BEGIN
  -- Fresh-from-012 install: adopt the names the code expects.
  IF to_regclass('public.agent_tech_reports') IS NULL
     AND to_regclass('public.technical_issues') IS NOT NULL THEN
    ALTER TABLE technical_issues RENAME TO agent_tech_reports;
  END IF;

  IF to_regclass('public.agent_tech_report_attachments') IS NULL
     AND to_regclass('public.technical_issue_attachments') IS NOT NULL THEN
    ALTER TABLE technical_issue_attachments RENAME TO agent_tech_report_attachments;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'agent_tech_report_attachments' AND column_name = 'issue_id') THEN
      ALTER TABLE agent_tech_report_attachments RENAME COLUMN issue_id TO report_id;
    END IF;
  END IF;
END $$;

-- 48h SLA on the issue itself + systemic-CX flag (repeat_count already exists).
ALTER TABLE agent_tech_reports
  ADD COLUMN IF NOT EXISTS sla_target_minutes INTEGER NOT NULL DEFAULT 2880,  -- 48 hours
  ADD COLUMN IF NOT EXISTS sla_due_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_cx_issue        BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE agent_tech_reports
   SET sla_due_at = created_at + INTERVAL '48 hours'
 WHERE sla_due_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_tech_reports_sla
  ON agent_tech_reports(tenant_id, sla_due_at)
  WHERE status NOT IN ('resolved', 'rejected');
