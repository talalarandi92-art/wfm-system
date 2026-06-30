-- 062_knowledge_base.sql
-- The Knowledge Base module + tables (kb_articles / kb_categories / kb_article_versions)
-- already exist. This migration only adds an ingestion log so we can show
-- "last synced" for the cckb2 Odoo KB mirror imported by scripts/import-kb.js.
-- Content stays 100% local (no external LLM).

CREATE TABLE IF NOT EXISTS kb_import_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  source      TEXT,
  articles    INT,
  words       INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
