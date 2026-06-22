-- 060_team_leader_status.sql
-- Editable team-leader status (replaces the hardcoded resolver in code).
-- status: active | director | left.  hidden=true ⇒ suppress the label EVERYWHERE
-- (dropdowns, distributions, audits, roster rows) — used for people who left and
-- should not be mentioned anywhere (e.g. Aya Ruiz, per user 2026-06-22).

CREATE TABLE IF NOT EXISTS team_leader_status (
  tenant_id   UUID NOT NULL,
  name        TEXT NOT NULL,                 -- the team_manager label as it appears in roster_days
  status      TEXT NOT NULL DEFAULT 'active',-- active | director | left
  hidden      BOOLEAN NOT NULL DEFAULT FALSE,-- suppress this label everywhere
  note        TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, name)
);

-- user-confirmed seed (2026-06-22): Aya Ruiz left → hidden everywhere; Talal Arandi
-- is the director (present); Asayel/Dana/Fatme are current line TLs.
INSERT INTO team_leader_status (tenant_id, name, status, hidden, note) VALUES
  ('a0000000-0000-0000-0000-000000000001','Asayel Sameah','active',false,'current TL'),
  ('a0000000-0000-0000-0000-000000000001','Dana Khaled','active',false,'current TL'),
  ('a0000000-0000-0000-0000-000000000001','Fatme Hassan','active',false,'current TL (= Fatma Hasan)'),
  ('a0000000-0000-0000-0000-000000000001','Talal Arandi','director',false,'director / owner — present'),
  ('a0000000-0000-0000-0000-000000000001','Aya Ruiz','left',true,'left/terminated — removed everywhere (user 2026-06-22)')
ON CONFLICT (tenant_id, name) DO NOTHING;
