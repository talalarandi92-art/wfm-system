-- 063_kb_whats_new.sql
-- Continuous-learning support for the Knowledge Base: track what is NEW vs UPDATED
-- between KB imports so the app can show a "What's New / Updated" feed and badge
-- changed articles (mirrors the source KB's New/Updated badges, natively).

ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS source_slug  TEXT;
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_kb_articles_source_slug ON kb_articles(tenant_id, source_slug);

CREATE TABLE IF NOT EXISTS kb_changes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  article_id  UUID,
  slug        TEXT,
  title       TEXT,
  category    TEXT,
  change_type TEXT,            -- 'new' | 'updated'
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kb_changes_recent ON kb_changes(tenant_id, changed_at DESC);
