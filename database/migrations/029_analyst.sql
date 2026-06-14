-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 029: WFM Analyst guard — recommendation log + adaptive thresholds
-- The analyst assesses coverage / schedule / breaks / queues / compliance, then
-- records its recommendations. When the operator accepts/rejects a recommendation
-- the decision is logged and the relevant threshold is nudged — so the analyst's
-- judgement adapts to this operation over time (the "learning" loop).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS analyst_recommendations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope_date     DATE NOT NULL,
  area           VARCHAR(30) NOT NULL,          -- coverage, schedule, breaks, queues, compliance
  function_id    UUID REFERENCES functions(id) ON DELETE SET NULL,
  function_name  VARCHAR(120),
  severity       VARCHAR(10) NOT NULL DEFAULT 'info',  -- ok, info, caution, risk
  verdict        VARCHAR(20),                   -- approve, caution, danger (for capacity decisions)
  title          VARCHAR(160) NOT NULL,
  summary        TEXT,                          -- what is happening
  recommendation TEXT,                          -- what should happen / best decision
  metrics        JSONB,                         -- supporting numbers
  decision       VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, accepted, rejected
  decided_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at     TIMESTAMPTZ,
  note           VARCHAR(300),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One recommendation per area+title+date (idempotent re-assessment). Keyed on
-- title (not function_id) because queues/schedule/compliance recs have a NULL
-- function_id but multiple distinct rows per area.
CREATE UNIQUE INDEX IF NOT EXISTS uq_analyst_rec
  ON analyst_recommendations(tenant_id, scope_date, area, title);

CREATE INDEX IF NOT EXISTS idx_analyst_rec_decision
  ON analyst_recommendations(tenant_id, decision, scope_date DESC);

-- Adaptive thresholds the analyst tunes from operator feedback.
CREATE TABLE IF NOT EXISTS analyst_thresholds (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key         VARCHAR(40) NOT NULL,
  value       NUMERIC NOT NULL,
  samples     INT NOT NULL DEFAULT 0,          -- how many feedback events shaped this
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, key)
);

COMMENT ON TABLE analyst_recommendations IS 'WFM analyst assessments + operator decisions (training signal).';
COMMENT ON TABLE analyst_thresholds IS 'Per-tenant thresholds the analyst adapts from accept/reject feedback.';
