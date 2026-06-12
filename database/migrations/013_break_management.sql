-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 013: Break Management System
-- Full enterprise break scheduling, requests, adherence, and coverage impact
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Break Types (configurable per tenant) ────────────────────────────────
CREATE TABLE IF NOT EXISTS break_types (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           VARCHAR(100) NOT NULL,
  name_ar        VARCHAR(100),
  duration_minutes INT NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 240),
  color          VARCHAR(20) DEFAULT '#6366f1',
  icon           VARCHAR(10) DEFAULT '☕',
  is_mandatory   BOOLEAN DEFAULT FALSE,
  is_prayer      BOOLEAN DEFAULT FALSE,         -- special handling for prayer times
  is_paid        BOOLEAN DEFAULT TRUE,
  applies_gender VARCHAR(10) CHECK (applies_gender IN ('male','female','all')) DEFAULT 'all',
  max_per_shift  INT DEFAULT 1,
  sort_order     INT DEFAULT 0,
  is_active      BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

-- ─── Prayer Times (per day, per location) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS prayer_times (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prayer_date DATE NOT NULL,
  location    VARCHAR(100) DEFAULT 'Kuwait City',
  fajr        TIME,
  dhuhr       TIME,
  asr         TIME,
  maghrib     TIME,
  isha        TIME,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, prayer_date, location)
);

-- ─── Break Policies (rules per function / shift code) ─────────────────────
CREATE TABLE IF NOT EXISTS break_policies (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                    VARCHAR(150) NOT NULL,
  function_id             UUID REFERENCES functions(id) ON DELETE SET NULL,
  shift_code              VARCHAR(30),          -- NULL = applies to all shifts
  break_type_id           UUID NOT NULL REFERENCES break_types(id),
  allowed_count           INT NOT NULL DEFAULT 1,
  -- Window: minutes from shift start / before shift end
  earliest_start_offset   INT NOT NULL DEFAULT 60,   -- earliest: 60 min after shift start
  latest_start_offset     INT NOT NULL DEFAULT 120,  -- latest: 120 min before shift end
  min_gap_between_breaks  INT DEFAULT 90,            -- min minutes between breaks
  priority                INT DEFAULT 0,              -- higher = scheduled first
  notes                   TEXT,
  is_active               BOOLEAN DEFAULT TRUE,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Break Schedule (generated slots per employee per day) ────────────────
CREATE TABLE IF NOT EXISTS break_slots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id    UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  schedule_date  DATE NOT NULL,
  break_type_id  UUID NOT NULL REFERENCES break_types(id),
  slot_number    INT NOT NULL DEFAULT 1,         -- 1st break, 2nd break of day
  planned_start  TIME NOT NULL,
  planned_end    TIME NOT NULL,
  actual_start   TIME,
  actual_end     TIME,
  status         VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled','active','completed','missed','swapped','cancelled','overridden')),
  -- Who generated this slot
  generated_by   VARCHAR(20) DEFAULT 'auto'     CHECK (generated_by IN ('auto','manual','rta')),
  created_by_id  UUID REFERENCES users(id),
  -- Swap/override tracking
  swapped_with_employee_id UUID REFERENCES employees(id),
  override_reason TEXT,
  -- Adherence metrics (computed after the fact)
  late_minutes   INT DEFAULT 0,
  early_end_minutes INT DEFAULT 0,
  is_missed      BOOLEAN DEFAULT FALSE,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, employee_id, schedule_date, slot_number)
);

-- ─── Break Requests (agent requesting to change break time) ───────────────
CREATE TABLE IF NOT EXISTS break_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employees(id),
  break_slot_id        UUID REFERENCES break_slots(id),        -- if changing existing slot
  schedule_date        DATE NOT NULL,
  break_type_id        UUID NOT NULL REFERENCES break_types(id),
  -- What the agent wants
  requested_start      TIME NOT NULL,
  requested_end        TIME NOT NULL,
  reason               TEXT,
  -- Coverage snapshot at time of request
  coverage_before_json JSONB,   -- { interval: { required, scheduled, available } }[]
  coverage_after_json  JSONB,
  min_coverage_gap     INT,     -- minimum coverage during requested window (negative = undercoverage)
  -- Approval chain
  status               VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected','cancelled','auto_approved')),
  reviewed_by_id       UUID REFERENCES users(id),
  reviewed_at          TIMESTAMPTZ,
  review_comment       TEXT,
  -- Auto-approval if coverage is safe
  auto_approve_eligible BOOLEAN DEFAULT FALSE,
  -- After approval: the new slot reference
  resulting_slot_id    UUID REFERENCES break_slots(id),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Break Fairness Ledger (track who gets preferred slots) ───────────────
CREATE TABLE IF NOT EXISTS break_fairness (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employees(id),
  period_year          INT NOT NULL,
  period_month         INT NOT NULL,
  -- Slot quality counts
  early_slot_count     INT DEFAULT 0,    -- preferred early break
  mid_slot_count       INT DEFAULT 0,
  late_slot_count      INT DEFAULT 0,
  prayer_break_count   INT DEFAULT 0,
  lunch_break_count    INT DEFAULT 0,
  total_breaks         INT DEFAULT 0,
  missed_breaks        INT DEFAULT 0,
  -- Adherence
  total_late_minutes   INT DEFAULT 0,
  total_early_end_min  INT DEFAULT 0,
  adherence_pct        NUMERIC(5,2),
  -- Fairness score (lower = this employee should get priority next time)
  fairness_score       NUMERIC(8,4) DEFAULT 0,
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, employee_id, period_year, period_month)
);

-- ─── Break Coverage Snapshots (for reporting & impact analysis) ───────────
CREATE TABLE IF NOT EXISTS break_coverage_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_date     DATE NOT NULL,
  function_id       UUID REFERENCES functions(id),
  interval_start    TIME NOT NULL,
  interval_end      TIME NOT NULL,
  required_hc       INT,
  scheduled_hc      INT,
  on_break_count    INT DEFAULT 0,
  available_hc      INT,        -- scheduled_hc - on_break_count
  coverage_gap      INT,        -- available_hc - required_hc (negative = risk)
  risk_level        VARCHAR(10) CHECK (risk_level IN ('ok','warn','critical')) DEFAULT 'ok',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_break_slots_emp_date     ON break_slots(tenant_id, employee_id, schedule_date);
CREATE INDEX IF NOT EXISTS idx_break_slots_date_status  ON break_slots(tenant_id, schedule_date, status);
CREATE INDEX IF NOT EXISTS idx_break_requests_emp       ON break_requests(tenant_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_break_requests_date      ON break_requests(tenant_id, schedule_date, status);
CREATE INDEX IF NOT EXISTS idx_break_fairness_emp       ON break_fairness(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_prayer_times_date        ON prayer_times(tenant_id, prayer_date);
CREATE INDEX IF NOT EXISTS idx_break_coverage_date_fn   ON break_coverage_snapshots(tenant_id, snapshot_date, function_id);

-- ─── Seed: Default Break Types for Boutiqaat ─────────────────────────────
INSERT INTO break_types (tenant_id, name, name_ar, duration_minutes, color, icon, is_mandatory, is_prayer, is_paid, applies_gender, max_per_shift, sort_order)
SELECT
  t.id,
  bt.name, bt.name_ar, bt.duration_minutes, bt.color, bt.icon,
  bt.is_mandatory, bt.is_prayer, bt.is_paid, bt.applies_gender,
  bt.max_per_shift, bt.sort_order
FROM tenants t,
(VALUES
  ('prayer',    'صلاة',         30,  '#7c3aed', '🕌', TRUE,  TRUE,  TRUE, 'all',    5, 1),
  ('lunch',     'غداء',         45,  '#ef4444', '🍽', TRUE,  FALSE, TRUE, 'all',    1, 2),
  ('coffee',    'قهوة',         15,  '#f59e0b', '☕', FALSE, FALSE, TRUE, 'all',    2, 3),
  ('bio',       'بيو',          10,  '#10b981', '🚻', FALSE, FALSE, TRUE, 'all',    3, 4),
  ('training',  'تدريب',        60,  '#6366f1', '📚', FALSE, FALSE, TRUE, 'all',    1, 5),
  ('medical',   'طبي',          30,  '#ec4899', '🩺', FALSE, FALSE, TRUE, 'all',    1, 6),
  ('emergency', 'طارئ',         15,  '#64748b', '⚡', FALSE, FALSE, TRUE, 'all',    1, 7)
) AS bt(name, name_ar, duration_minutes, color, icon, is_mandatory, is_prayer, is_paid, applies_gender, max_per_shift, sort_order)
WHERE t.id = 'a0000000-0000-0000-0000-000000000001'::uuid
ON CONFLICT (tenant_id, name) DO NOTHING;

-- ─── Seed: Default Break Policies (CH-WA 9-hr shift example) ─────────────
INSERT INTO break_policies (tenant_id, name, function_id, shift_code, break_type_id, allowed_count, earliest_start_offset, latest_start_offset, min_gap_between_breaks, priority)
SELECT
  t.id,
  'CH-WA Prayer Policy',
  NULL,  -- applies to all functions
  NULL,  -- applies to all shifts
  bt.id,
  5,     -- up to 5 prayer breaks per shift (max possible prayers in a 9-hr shift)
  30,    -- earliest 30 min after shift start
  30,    -- latest 30 min before shift end
  0,
  10
FROM tenants t
CROSS JOIN break_types bt
WHERE t.id = 'a0000000-0000-0000-0000-000000000001'::uuid
  AND bt.name = 'prayer'
  AND bt.tenant_id = t.id
ON CONFLICT DO NOTHING;

INSERT INTO break_policies (tenant_id, name, function_id, shift_code, break_type_id, allowed_count, earliest_start_offset, latest_start_offset, min_gap_between_breaks, priority)
SELECT
  t.id,
  'Standard Lunch Policy',
  NULL,
  NULL,
  bt.id,
  1,
  120,   -- earliest lunch: 2 hrs after shift start
  150,   -- latest: 2.5 hrs before shift end
  0,
  5
FROM tenants t
CROSS JOIN break_types bt
WHERE t.id = 'a0000000-0000-0000-0000-000000000001'::uuid
  AND bt.name = 'lunch'
  AND bt.tenant_id = t.id
ON CONFLICT DO NOTHING;

INSERT INTO break_policies (tenant_id, name, function_id, shift_code, break_type_id, allowed_count, earliest_start_offset, latest_start_offset, min_gap_between_breaks, priority)
SELECT
  t.id,
  'Coffee Break Policy',
  NULL,
  NULL,
  bt.id,
  2,    -- 2 coffee breaks per shift
  60,
  60,
  180,  -- at least 3 hrs between coffee breaks
  3
FROM tenants t
CROSS JOIN break_types bt
WHERE t.id = 'a0000000-0000-0000-0000-000000000001'::uuid
  AND bt.name = 'coffee'
  AND bt.tenant_id = t.id
ON CONFLICT DO NOTHING;

-- ─── Helper view: break slots with employee info ───────────────────────────
CREATE OR REPLACE VIEW v_break_slots_detail AS
SELECT
  bs.id, bs.tenant_id, bs.schedule_date,
  bs.planned_start, bs.planned_end,
  bs.actual_start, bs.actual_end,
  bs.status, bs.slot_number, bs.generated_by,
  bs.late_minutes, bs.is_missed,
  e.id          AS employee_id,
  e.employee_no,
  e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS employee_name,
  e.gender,
  f.name        AS function_name,
  f.id          AS function_id,
  bt.name       AS break_type,
  bt.name_ar    AS break_type_ar,
  bt.duration_minutes,
  bt.color,
  bt.icon,
  bt.is_mandatory,
  bt.is_prayer
FROM break_slots bs
JOIN employees   e  ON e.id  = bs.employee_id
LEFT JOIN functions f ON f.id = e.function_id
JOIN break_types bt ON bt.id = bs.break_type_id;
