-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 079: Smart Break Management — B1 data model + policy engine v2
--   • break_policies_v2  — entitlement/pattern/protected-hours policy matrix.
--       Resolution is MOST-SPECIFIC WINS: function+shift_type > function > default
--       (employment_type adds specificity at every level; NULL column = wildcard).
--       Per-function rows OVERRIDE the tenant-wide default row (all-NULL selectors).
--   • break_daily_balance — per-employee per-day entitlement ledger (full
--       TIMESTAMPTZ shift window → cross-midnight safe), maintained transactionally
--       on slot completion.
--   • break_slots — lifecycle columns for the dynamic engine (earliest/latest
--       window, planned_date fixing cross-midnight day loss, release tracking)
--       + additive status values.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Policy matrix v2 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS break_policies_v2 (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  function_name               VARCHAR(150),   -- CANON function name (canon_fn); NULL = all functions (tenant default)
  shift_type                  VARCHAR(30),    -- shift code or category (e.g. 'M','N','MD','R'); NULL = all shifts
  employment_type             VARCHAR(30),    -- 'full_time' | 'intern' | 'part_time' | ...; NULL = all
  total_daily_minutes         INT  NOT NULL DEFAULT 60  CHECK (total_daily_minutes > 0 AND total_daily_minutes <= 240),
  max_sessions                INT  NOT NULL DEFAULT 4   CHECK (max_sessions BETWEEN 1 AND 10),
  duration_pattern            JSONB NOT NULL DEFAULT '[15,15,15,15]'::jsonb,  -- session durations, order = generation order
  protected_first_min         INT  NOT NULL DEFAULT 60  CHECK (protected_first_min >= 0),
  protected_last_min          INT  NOT NULL DEFAULT 60  CHECK (protected_last_min  >= 0),
  min_gap_between_breaks_min  INT  NOT NULL DEFAULT 90  CHECK (min_gap_between_breaks_min >= 0),
  min_work_before_first_min   INT  NOT NULL DEFAULT 60  CHECK (min_work_before_first_min >= 0),
  max_delay_min               INT  NOT NULL DEFAULT 45  CHECK (max_delay_min >= 0),
  release_mode                VARCHAR(12) NOT NULL DEFAULT 'hybrid'
                              CHECK (release_mode IN ('auto','supervisor','hybrid','freeze')),
  -- Live-release thresholds (B3 reads these; B2 uses max_simultaneous*):
  --   coverage_ratio            min fraction of required HC that must stay available (default 0.7)
  --   queue_waiting_max         max total waiting contacts before releases freeze (default 50)
  --   occupancy_max             max occupancy before releases freeze (default 0.9)
  --   min_available_hc          absolute floor of available agents after release (default 3)
  --   max_simultaneous          per-function per-interval simultaneous-break cap (null = computed)
  --   max_simultaneous_per_team per team_manager simultaneous cap (default 1)
  thresholds                  JSONB NOT NULL DEFAULT
    '{"coverage_ratio":0.7,"queue_waiting_max":50,"occupancy_max":0.9,"min_available_hc":3,"max_simultaneous":null,"max_simultaneous_per_team":1}'::jsonb,
  active                      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE break_policies_v2 IS
  'Smart Break Management policy matrix. Resolution: most-specific active row wins — function_name+shift_type > function_name > tenant default (all-NULL). employment_type adds specificity at each level. Per-function rows override the default row.';

-- One active row per selector combination (NULLs folded so wildcards are unique too)
CREATE UNIQUE INDEX IF NOT EXISTS uq_break_policies_v2_selector
  ON break_policies_v2 (tenant_id, COALESCE(function_name,''), COALESCE(shift_type,''), COALESCE(employment_type,''))
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_break_policies_v2_tenant ON break_policies_v2 (tenant_id) WHERE active;

-- ─── 2. Per-employee daily entitlement ledger ──────────────────────────────
CREATE TABLE IF NOT EXISTS break_daily_balance (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  balance_date     DATE NOT NULL,                 -- the schedule day the shift belongs to
  shift_start      TIMESTAMPTZ,                   -- full datetimes → cross-midnight safe
  shift_end        TIMESTAMPTZ,
  entitled_minutes INT NOT NULL DEFAULT 60,
  used_minutes     INT NOT NULL DEFAULT 0 CHECK (used_minutes >= 0),
  sessions_used    INT NOT NULL DEFAULT 0 CHECK (sessions_used >= 0),
  last_break_end   TIMESTAMPTZ,
  carry_flags      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, employee_id, balance_date)
);

CREATE INDEX IF NOT EXISTS idx_break_daily_balance_date ON break_daily_balance (tenant_id, balance_date);

-- ─── 3. break_slots lifecycle columns (additive) ───────────────────────────
ALTER TABLE break_slots ADD COLUMN IF NOT EXISTS earliest_start        TIME NULL;
ALTER TABLE break_slots ADD COLUMN IF NOT EXISTS latest_start          TIME NULL;
ALTER TABLE break_slots ADD COLUMN IF NOT EXISTS planned_date          DATE NULL;   -- the DATE planned_start belongs to (cross-midnight fix)
ALTER TABLE break_slots ADD COLUMN IF NOT EXISTS generated_reason      TEXT NULL;
ALTER TABLE break_slots ADD COLUMN IF NOT EXISTS optimization_version  INT  NULL;
ALTER TABLE break_slots ADD COLUMN IF NOT EXISTS priority_score        NUMERIC NULL;
ALTER TABLE break_slots ADD COLUMN IF NOT EXISTS released_at           TIMESTAMPTZ NULL;
ALTER TABLE break_slots ADD COLUMN IF NOT EXISTS release_source        VARCHAR(16) NULL;
ALTER TABLE break_slots ADD COLUMN IF NOT EXISTS delay_min             INT NULL;
ALTER TABLE break_slots ADD COLUMN IF NOT EXISTS delay_reason          TEXT NULL;

-- Backfill: existing rows were all same-day → planned_date = schedule_date
UPDATE break_slots SET planned_date = schedule_date WHERE planned_date IS NULL;

-- release_source constraint (NULL allowed)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'break_slots_release_source_check') THEN
    ALTER TABLE break_slots ADD CONSTRAINT break_slots_release_source_check
      CHECK (release_source IS NULL OR release_source IN ('auto','supervisor','exception'));
  END IF;
END $$;

-- Extend status CHECK — keep ALL existing values, add dynamic-engine states (additive)
ALTER TABLE break_slots DROP CONSTRAINT IF EXISTS break_slots_status_check;
ALTER TABLE break_slots ADD CONSTRAINT break_slots_status_check
  CHECK (status IN ('scheduled','active','completed','missed','swapped','cancelled','overridden',
                    'eligible','waiting_capacity','delayed','released','overdue','exception_pending'));

CREATE INDEX IF NOT EXISTS idx_break_slots_planned_date ON break_slots (tenant_id, planned_date, status);

-- ─── 4. Seed: ONE tenant-wide default policy (60 min / 4 × 15 / hybrid) ────
-- Per-function or per-shift rows added later override this row (most-specific wins).
INSERT INTO break_policies_v2
  (tenant_id, function_name, shift_type, employment_type,
   total_daily_minutes, max_sessions, duration_pattern,
   protected_first_min, protected_last_min, min_gap_between_breaks_min,
   min_work_before_first_min, max_delay_min, release_mode, active)
SELECT t.id, NULL, NULL, NULL,
       60, 4, '[15,15,15,15]'::jsonb,
       60, 60, 90,
       60, 45, 'hybrid', TRUE
FROM tenants t
WHERE t.id = 'a0000000-0000-0000-0000-000000000001'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM break_policies_v2 p
    WHERE p.tenant_id = t.id AND p.function_name IS NULL
      AND p.shift_type IS NULL AND p.employment_type IS NULL AND p.active
  );
