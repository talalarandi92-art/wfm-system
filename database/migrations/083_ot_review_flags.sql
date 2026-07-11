-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 083: before/after-shift OT review flags (Director decision 2, 2026-07-11)
--   OT logged BEFORE the shift start or AFTER the shift end is a "reserved /
--   uncertain period" — it is NOT auto-added to payable OT. Each such day raises
--   an ALERT next to the employee name with two actions:
--     • Acknowledge → it IS overtime → the acknowledged minutes count as payable.
--     • Ignore      → they just opened early / stayed logged in → does NOT count.
--   Until acted on the flag is 'pending' (never silently paid).
--
--   PRESERVE-ON-REBUILD: recon-ingest.js refreshes only 'pending' rows on every
--   rebuild and NEVER overwrites an 'acknowledged'/'ignored' decision (same
--   pattern as attendance_excuses / gap-review). The payable OT report ADDS
--   SUM(acknowledged minutes) — roster_days.ot_min is never mutated by the API,
--   so the engine stays the single source of truth.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ot_review_flags (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  person_no   text NOT NULL,
  work_date   date NOT NULL,
  kind        text NOT NULL,                 -- 'before' | 'after'
  minutes     integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'pending',  -- 'pending' | 'acknowledged' | 'ignored'
  employee_name text,
  function_name text,
  reviewed_by text,
  reviewed_at timestamptz,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ot_review ON ot_review_flags (tenant_id, person_no, work_date, kind);
CREATE INDEX IF NOT EXISTS idx_ot_review_status ON ot_review_flags (tenant_id, status, work_date);
