-- AI Workforce W0 (2026-07-06, AI_WORKFORCE_ARCHITECTURE.md §3): the append-only agent
-- event bus — the pub/sub backbone that lets the guard team scale 15 → 35 agents without a
-- hardcoded exchange graph. Every agent PUBLISHES its findings here and CONSUMES relevant
-- events from here; subject_ref dedupes work on the same subject; severity drives routing.
-- Explainability: every material AI decision lands as an event (payload carries the evidence),
-- satisfying the no-black-box mandate alongside audit_logs.
CREATE TABLE IF NOT EXISTS agent_events (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid        NOT NULL,
  agent       text        NOT NULL,             -- publisher: health-guard | analyst | chief | wfm-copilot | ...
  event_type  text        NOT NULL,             -- finding | recommendation | decision | alert | learning | sync
  subject_ref text,                             -- what it is about (e.g. 'person:13311|2026-07-02', 'endpoint:/roster-v2/hourly')
  severity    text        NOT NULL DEFAULT 'info',  -- info | warn | critical
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- the evidence + the explanation (explainable AI)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_events_stream  ON agent_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_agent   ON agent_events (tenant_id, agent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_subject ON agent_events (tenant_id, subject_ref) WHERE subject_ref IS NOT NULL;
