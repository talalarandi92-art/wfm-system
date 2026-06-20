-- 035_perf_composite_indexes.sql
-- Performance maintenance: add composite indexes that match the hot query
-- patterns actually issued by the analytics, recon, SLA, coverage and audit
-- modules. All are additive and idempotent (IF NOT EXISTS) — zero data risk.
--
-- Verified against 001_initial_schema.sql so we do NOT duplicate existing
-- indexes. Skipped as already-covered: schedule_entries (idx_sched_entries_grid),
-- chat_messages (idx_chat_messages_channel = channel_id, created_at DESC).
--
-- NOTE on retention (audit_logs / import_rows / integration_snapshots):
-- audit_logs is append-only via an immutability trigger, so age-based DELETE is
-- intentionally blocked — true retention there requires range partitioning and a
-- partition-drop job, deferred to a dedicated migration rather than risked here.

-- attendance_records: analytics/recon filter heavily on (tenant_id, attendance_date BETWEEN …)
CREATE INDEX IF NOT EXISTS idx_attendance_tenant_date
  ON attendance_records(tenant_id, attendance_date);

-- requests: SLA dashboards & request lists filter (tenant_id, status) ordered by submitted_at
CREATE INDEX IF NOT EXISTS idx_requests_tenant_status_submitted
  ON requests(tenant_id, status, submitted_at DESC);

-- headcount_intervals: coverage/forecast queries scope by tenant + function over a date range
CREATE INDEX IF NOT EXISTS idx_hc_tenant_func_date
  ON headcount_intervals(tenant_id, function_id, snapshot_date);

-- audit_logs: audit report & security-guard pull the most-recent entries per tenant
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created
  ON audit_logs(tenant_id, created_at DESC);
