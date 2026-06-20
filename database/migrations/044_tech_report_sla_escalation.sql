-- 044_tech_report_sla_escalation.sql
-- The SLA auto-escalation loop only scanned `requests`, so technical issues that
-- breached their 48h SLA were never escalated/notified. Add an idempotency flag
-- so the loop can escalate overdue agent_tech_reports exactly once.

ALTER TABLE agent_tech_reports ADD COLUMN IF NOT EXISTS sla_escalated_at TIMESTAMPTZ;
