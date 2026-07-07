-- 075: Event/period forecast uploads — the Director fills an Excel template with
-- the expected demand for a date range (event, campaign, Ramadan, sale…) and the
-- currently-available agents per function; the staffing engine computes hourly
-- requirements from the UPLOADED volumes and answers: how many interns to hire
-- per function to close the gap and hit the SL target.

CREATE TABLE IF NOT EXISTS forecast_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL,
  name          TEXT        NOT NULL,
  date_from     DATE        NOT NULL,
  date_to       DATE        NOT NULL,
  -- uploaded inputs, kept verbatim for audit/re-compute:
  -- daily:      [{date, orders, contacts:{fn: n}}]  (contacts per FUNCTION per day)
  -- available:  {fn: {agents, internProductivity?}}
  inputs        JSONB       NOT NULL,
  -- computed verdict at upload time (re-computable): per function —
  -- requiredPeak, availableAgents, gapAgents, internsToHire, slNow, slAfterHire
  results       JSONB,
  file_name     TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_forecast_events_tenant ON forecast_events (tenant_id, date_from);
