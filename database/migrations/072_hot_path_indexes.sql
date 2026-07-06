-- Hot-path indexes (2026-07-06, EXECUTION_BRIEF risks #5 + #13 + week-forecast CTE).
-- The most common roster filter — canon_fn(role_function) = canon_fn($fn) — had NO functional
-- index (role_function had no index at all), so every function-filtered roster-v2 /
-- roster-dashboard / hourly call sequential-scanned roster_days and degraded linearly with
-- growth. Name search used a POSIX regex that cannot use a b-tree. requests' approved-only
-- CTEs (week-forecast lv/pm) scanned all requests.

-- 1) the intern-fold function filter (canon_fn is IMMUTABLE, migration 068)
CREATE INDEX IF NOT EXISTS idx_roster_canon_fn
  ON roster_days (tenant_id, canon_fn(role_function), work_date);

-- 2) covering default scope (range + active)
CREATE INDEX IF NOT EXISTS idx_roster_tenant_date_active
  ON roster_days (tenant_id, work_date, is_active);

-- 3) trigram name search (typeahead) — replaces full scans on lower(clean_name) ~ $n
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_roster_name_trgm
  ON roster_days USING gin (lower(clean_name) gin_trgm_ops);

-- 4) approved-requests partial index (week-forecast leave/permission overlays)
CREATE INDEX IF NOT EXISTS idx_requests_approved
  ON requests (tenant_id, status) WHERE status = 'approved';
