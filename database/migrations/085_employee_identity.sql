-- 085_employee_identity.sql — Scorecard program wave B2: EMPLOYEE IDENTITY foundation (spec §10)
--
-- A canonical WFM identity spine ALREADY exists: `employee_identity` (built by
-- recon/backfill-identity.js) collapses every employee_no → one canonical
-- person_no with clean_name / function / role. It has NO cross-system links
-- (no email / odoo_id / sprinklr_agent_id).
--
-- This migration adds the CROSS-SYSTEM MAP as a resolved EXTENSION over that
-- spine — it does NOT compete with or duplicate employee_identity:
--   * employee_identity_map  — one resolved row per canonical person, carrying
--                              the Odoo / WFM / Sprinklr / email links.
--   * identity_unresolved    — raw external signals that could not be hard-linked
--                              (the review queue). Fuzzy name-only matches land
--                              here with a suggested_person_no, NEVER auto-linked.
--   * identity_transfer_log  — function-transfer history per person (from roster).
--
-- NOTE on person_no type: the existing canonical `employee_identity.person_no`
-- is TEXT (values like '13019', intern '6283'). The spec text says BIGINT, but
-- to stay byte-compatible with the live spine and its joins we keep TEXT here.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS employee_identity_map (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  person_no       TEXT NOT NULL,                 -- canonical WFM key (employee_identity.person_no)
  employee_id     UUID,                          -- employees.id (uuid FK)
  employee_no     TEXT,                          -- canonical employee_no
  full_name       TEXT,
  email           TEXT,
  odoo_id         BIGINT,                        -- employees.odoo_id / odoo_staging
  sprinklr_agent_id  TEXT,
  sprinklr_user_id   TEXT,
  sprinklr_email     TEXT,
  ameyo_username     TEXT,
  status          TEXT,
  resolved        BOOLEAN NOT NULL DEFAULT TRUE, -- true = at least one hard cross-system link
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  resolve_method  TEXT,                          -- exact_email | sprinklr_agent_id | canonical | manual
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_identity_map_person UNIQUE (tenant_id, person_no)
);
CREATE INDEX IF NOT EXISTS ix_identity_map_email     ON employee_identity_map (tenant_id, lower(email));
CREATE INDEX IF NOT EXISTS ix_identity_map_sprinklr  ON employee_identity_map (tenant_id, sprinklr_agent_id);
CREATE INDEX IF NOT EXISTS ix_identity_map_odoo      ON employee_identity_map (tenant_id, odoo_id);

CREATE TABLE IF NOT EXISTS identity_unresolved (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  source             TEXT NOT NULL,              -- sprinklr | odoo | survey | login
  raw_key            TEXT NOT NULL,              -- the email / agent_id / name that could not map
  raw_kind           TEXT,                       -- email | agent_id | name
  raw_name           TEXT,
  suggested_person_no TEXT,                      -- best fuzzy guess (NOT a hard link)
  suggested_confidence NUMERIC(4,3),
  occurrences        INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'open', -- open | resolved | ignored
  note               TEXT,
  first_seen         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_person_no TEXT,
  resolved_by        UUID,
  resolved_at        TIMESTAMPTZ,
  CONSTRAINT uq_identity_unresolved UNIQUE (tenant_id, source, raw_key)
);
CREATE INDEX IF NOT EXISTS ix_identity_unresolved_status ON identity_unresolved (tenant_id, status);

CREATE TABLE IF NOT EXISTS identity_transfer_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  person_no      TEXT NOT NULL,
  from_function  TEXT,
  to_function    TEXT,
  effective_date DATE,
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_identity_transfer UNIQUE (tenant_id, person_no, effective_date, to_function)
);
CREATE INDEX IF NOT EXISTS ix_identity_transfer_person ON identity_transfer_log (tenant_id, person_no);
