-- ═══════════════════════════════════════════════════════════════════════════
-- 084 — BUILDER v2 (universal self-service report/dashboard engine)
--
-- The data-source CATALOG lives in TypeScript (backend/src/modules/report-builder-v2/
-- data-sources.ts) as static, allowlist-safe config — nothing to store in SQL. Only
-- the user's SAVED artifacts need persistence: saved reports and saved dashboards.
-- Idempotent (IF NOT EXISTS) so it can be applied directly by a small node runner.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rb_saved_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  owner_user   UUID NOT NULL,                 -- users.id who created it
  name         TEXT NOT NULL,
  description  TEXT,
  source_key   TEXT NOT NULL,                 -- data-source catalog key (e.g. 'overtime')
  config       JSONB NOT NULL DEFAULT '{}',   -- {dimensions,metrics,filters,dateFrom,dateTo,granularity,viz,columns,sort}
  viz          TEXT DEFAULT 'table',          -- table|bar|line|donut|stat|pivot (mirror of config.viz for quick listing)
  shared       BOOLEAN NOT NULL DEFAULT false,-- visible to whole tenant when true
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rb_saved_reports_tenant   ON rb_saved_reports (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rb_saved_reports_owner    ON rb_saved_reports (tenant_id, owner_user);
CREATE INDEX IF NOT EXISTS idx_rb_saved_reports_shared   ON rb_saved_reports (tenant_id, shared);

CREATE TABLE IF NOT EXISTS rb_saved_dashboards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  owner_user   UUID NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  sections     JSONB NOT NULL DEFAULT '[]',   -- [{title, widgets:[{sourceKey,viz,dimensions,metrics,filters,granularity,...}]}]
  date_range   JSONB,                         -- dashboard-level {preset|from|to}
  filters      JSONB DEFAULT '[]',            -- dashboard-level cascading filters
  shared       BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rb_saved_dashboards_tenant ON rb_saved_dashboards (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rb_saved_dashboards_owner  ON rb_saved_dashboards (tenant_id, owner_user);
CREATE INDEX IF NOT EXISTS idx_rb_saved_dashboards_shared ON rb_saved_dashboards (tenant_id, shared);
