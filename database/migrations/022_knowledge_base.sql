-- ═══════════════════════════════════════════════════════════════════════════
-- 022 — Knowledge Base
-- Internal SOPs / articles / procedures. TL/WFM/Admin publish, everyone reads.
-- Version history kept on every edit. Markdown body, bilingual.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS kb_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  name        TEXT NOT NULL,
  name_ar     TEXT,
  icon        TEXT DEFAULT '📁',
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kb_categories_tenant ON kb_categories (tenant_id, sort_order);

CREATE TABLE IF NOT EXISTS kb_articles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  category_id  UUID REFERENCES kb_categories(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  title_ar     TEXT,
  body         TEXT DEFAULT '',
  body_ar      TEXT DEFAULT '',
  tags         TEXT[] DEFAULT '{}',
  status       TEXT DEFAULT 'draft',          -- draft | published
  author_id    UUID,
  updated_by   UUID,
  published_at TIMESTAMPTZ,
  view_count   INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kb_articles_tenant   ON kb_articles (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_articles_category ON kb_articles (tenant_id, category_id);
-- Full-text-ish search over title + body (English + Arabic stored together)
CREATE INDEX IF NOT EXISTS idx_kb_articles_search   ON kb_articles
  USING gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(title_ar,'') || ' ' || coalesce(body,'') || ' ' || coalesce(body_ar,'')));

CREATE TABLE IF NOT EXISTS kb_article_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  UUID NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  version_no  INT NOT NULL,
  title       TEXT,
  title_ar    TEXT,
  body        TEXT,
  body_ar     TEXT,
  edited_by   UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kb_versions_article ON kb_article_versions (article_id, version_no DESC);

-- ── Permissions ────────────────────────────────────────────────────────────
INSERT INTO permissions (id, code, module, action, description) VALUES
  (gen_random_uuid(), 'kb.view',   'knowledge_base', 'view',   'View knowledge base articles'),
  (gen_random_uuid(), 'kb.manage', 'knowledge_base', 'edit',   'Create, edit, and publish knowledge base articles')
ON CONFLICT (code) DO NOTHING;

-- platform_admin: all (blanket re-run picks up the two new permissions)
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'b0000000-0000-0000-0000-000000000001', id FROM permissions WHERE code IN ('kb.view','kb.manage')
ON CONFLICT DO NOTHING;

-- wfm_analyst + team_leader: view + manage
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.id
FROM (VALUES
  ('b0000000-0000-0000-0000-000000000002'::uuid),
  ('b0000000-0000-0000-0000-000000000003'::uuid)
) AS r(role_id)
CROSS JOIN permissions p
WHERE p.code IN ('kb.view','kb.manage')
ON CONFLICT DO NOTHING;

-- rta + agent + hr_specialist: view only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.id
FROM (VALUES
  ('b0000000-0000-0000-0000-000000000004'::uuid),
  ('b0000000-0000-0000-0000-000000000005'::uuid),
  ('b0000000-0000-0000-0000-000000000006'::uuid)
) AS r(role_id)
CROSS JOIN permissions p
WHERE p.code = 'kb.view'
ON CONFLICT DO NOTHING;

-- ── Seed a few starter categories ────────────────────────────────────────────
INSERT INTO kb_categories (tenant_id, name, name_ar, icon, sort_order) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Returns & Refunds', 'الإرجاع والاسترداد', '🔄', 1),
  ('a0000000-0000-0000-0000-000000000001', 'CRM Guides',        'أدلة CRM',          '💻', 2),
  ('a0000000-0000-0000-0000-000000000001', 'Policies',          'السياسات',          '📋', 3),
  ('a0000000-0000-0000-0000-000000000001', 'Troubleshooting',   'حل المشاكل',        '🔧', 4)
ON CONFLICT DO NOTHING;
