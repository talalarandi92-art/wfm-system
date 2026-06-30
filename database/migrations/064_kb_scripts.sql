-- 064_kb_scripts.sql
-- Individual reply scripts (canned responses) parsed from the KB script libraries
-- (Chat Scripts EN/AR + Sprinklr canned responses). Powers the "Reply Helper":
-- an agent pastes the customer message and gets the matching suggested reply.

CREATE TABLE IF NOT EXISTS kb_scripts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL,
  source     TEXT,                 -- 'chat' | 'sprinklr'
  category   TEXT,
  en         TEXT,
  ar         TEXT,
  code       TEXT,
  keywords   TEXT,                 -- lowercased category + en + ar, for matching
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kb_scripts_tenant ON kb_scripts(tenant_id);
