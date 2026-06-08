-- ============================================================
-- WFM PLATFORM — INITIAL SCHEMA MIGRATION
-- Migration:    001
-- Date:         2026-06-08
-- Description:  Core foundation schema.
--               35 tables covering: tenant model, RBAC,
--               organization, employees, shift codes, schedule
--               grid, attendance, workbook import, requests,
--               headcount intervals, outages, technical issues,
--               audit log, attachments, and notifications.
--
-- Design principles:
--   - SaaS-ready: all tenant-owned tables include tenant_id
--   - Security: append-only audit_log via trigger, UUID PKs
--   - Scalability: indexes on all FKs and common filter columns
--   - No synchronize: schema managed by migrations only
--   - S/A suffix derived from attendance_marker, not stored
--   - Dynamic lists in tables, not hardcoded enums
--
-- PROPRIETARY AND CONFIDENTIAL — ALL RIGHTS RESERVED
-- ============================================================

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid(), pgp functions
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- trigram text search (future use)

-- ============================================================
-- ENUMERATIONS
-- ============================================================

CREATE TYPE tenant_status_enum          AS ENUM ('active', 'trial', 'suspended', 'cancelled');
CREATE TYPE user_status_enum            AS ENUM ('active', 'inactive', 'pending', 'locked');
CREATE TYPE employee_status_enum        AS ENUM ('active', 'inactive', 'resigned', 'terminated', 'on_leave');
CREATE TYPE gender_enum                 AS ENUM ('male', 'female');
CREATE TYPE employment_type_enum        AS ENUM ('full_time', 'part_time', 'intern', 'contractor', 'secondment');
CREATE TYPE shift_category_enum         AS ENUM ('morning', 'evening', 'night', 'midnight', 'wfh', 'leave', 'absence', 'rest', 'other');
CREATE TYPE schedule_status_enum        AS ENUM ('draft', 'generated', 'reviewed', 'published', 'locked', 'archived');
CREATE TYPE schedule_period_enum        AS ENUM ('daily', 'weekly', 'monthly');
CREATE TYPE attendance_marker_enum      AS ENUM ('present', 'sick', 'absent', 'leave', 'holiday', 'off', 'comp', 'unknown');
CREATE TYPE request_status_enum         AS ENUM ('pending', 'peer_pending', 'approved', 'rejected', 'cancelled', 'withdrawn', 'expired');
CREATE TYPE import_status_enum          AS ENUM ('uploaded', 'processing', 'validated', 'committed', 'failed', 'cancelled');
CREATE TYPE import_row_status_enum      AS ENUM ('valid', 'error', 'warning', 'skipped', 'committed');
CREATE TYPE import_type_enum            AS ENUM (
    'timing_sheet', 'shifts_sheet', 'monthly_matrix',
    'hc_sheet', 'outage_sheet', 'user_import',
    'employee_import', 'scorecard_import'
);
CREATE TYPE outage_severity_enum        AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE outage_status_enum          AS ENUM ('reported', 'validated', 'in_progress', 'resolved', 'closed');
CREATE TYPE tech_issue_status_enum      AS ENUM ('reported', 'validating', 'validated', 'escalated', 'resolved', 'closed');
CREATE TYPE skill_proficiency_enum      AS ENUM ('beginner', 'intermediate', 'advanced', 'expert');
CREATE TYPE skill_status_enum           AS ENUM ('active', 'expired', 'in_training', 'suspended');

-- ============================================================
-- SECTION 1: TENANT (SaaS FOUNDATION)
-- ============================================================

CREATE TABLE tenants (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(200) NOT NULL,
    legal_name      VARCHAR(200),
    slug            VARCHAR(100) NOT NULL UNIQUE,  -- URL-safe: "boutiqaat"
    status          tenant_status_enum NOT NULL DEFAULT 'active',
    timezone        VARCHAR(100) NOT NULL DEFAULT 'Asia/Kuwait',
    default_locale  VARCHAR(10)  NOT NULL DEFAULT 'ar',
    logo_url        TEXT,
    primary_color   VARCHAR(7),                    -- hex: "#1A3C8F"
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE tenant_settings (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    setting_key     VARCHAR(100) NOT NULL,
    setting_value   JSONB        NOT NULL,
    setting_group   VARCHAR(50),   -- 'schedule', 'attendance', 'capacity', 'security', 'branding'
    description     TEXT,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, setting_key)
);

CREATE INDEX idx_tenant_settings_tenant  ON tenant_settings(tenant_id);
CREATE INDEX idx_tenant_settings_group   ON tenant_settings(tenant_id, setting_group);

-- ============================================================
-- SECTION 2: RBAC
-- ============================================================

CREATE TABLE roles (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = platform role
    name            VARCHAR(100) NOT NULL,
    code            VARCHAR(50)  NOT NULL,   -- 'agent', 'team_leader', 'rta', 'wfm_analyst'
    description     TEXT,
    is_system_role  BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, code)
);

CREATE INDEX idx_roles_tenant_id ON roles(tenant_id);

CREATE TABLE permissions (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(150) NOT NULL UNIQUE,  -- 'schedule.edit', 'request.approve'
    module      VARCHAR(50)  NOT NULL,          -- 'schedule', 'requests', 'attendance'
    action      VARCHAR(50)  NOT NULL,          -- 'view', 'create', 'edit', 'delete', 'approve'
    description TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_permissions_module ON permissions(module);

CREATE TABLE role_permissions (
    role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_role       ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id);

-- ============================================================
-- SECTION 3: ORGANIZATION
-- Note: users table is defined after employees (FK dependency).
-- ============================================================

CREATE TABLE functions (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name            VARCHAR(150) NOT NULL,
    name_ar         VARCHAR(150),
    code            VARCHAR(50)  NOT NULL,   -- 'inbound_voice', 'chat', 'email', 'whatsapp'
    channel_type    VARCHAR(50),             -- 'voice', 'chat', 'email', 'social', 'whatsapp'
    concurrency     INTEGER,                 -- max concurrent conversations per agent
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, code)
);

CREATE INDEX idx_functions_tenant_id ON functions(tenant_id);

-- manager_id FK added after employees table is created
CREATE TABLE teams (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    function_id     UUID         NOT NULL REFERENCES functions(id) ON DELETE RESTRICT,
    name            VARCHAR(150) NOT NULL,
    name_ar         VARCHAR(150),
    manager_id      UUID,          -- FK to employees added below
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_teams_tenant_id   ON teams(tenant_id);
CREATE INDEX idx_teams_function_id ON teams(function_id);

CREATE TABLE employees (
    id                  UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID                   NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    employee_no         VARCHAR(50)            NOT NULL,  -- company ID from workbook (use for matching)
    first_name_en       VARCHAR(100)           NOT NULL,
    last_name_en        VARCHAR(100),
    first_name_ar       VARCHAR(100),
    last_name_ar        VARCHAR(100),
    gender              gender_enum            NOT NULL,
    function_id         UUID                   REFERENCES functions(id) ON DELETE SET NULL,
    team_id             UUID                   REFERENCES teams(id) ON DELETE SET NULL,
    employment_type     employment_type_enum   NOT NULL DEFAULT 'full_time',
    status              employee_status_enum   NOT NULL DEFAULT 'active',
    hire_date           DATE,
    termination_date    DATE,
    nationality         VARCHAR(50),
    direct_manager_id   UUID                   REFERENCES employees(id) ON DELETE SET NULL,
    is_supervisor       BOOLEAN                NOT NULL DEFAULT FALSE,  -- eligible for 20-code shifts
    productivity_factor NUMERIC(4,2)           NOT NULL DEFAULT 1.00,  -- 0.70 for interns
    notes               TEXT,
    created_at          TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, employee_no)
);

CREATE INDEX idx_employees_tenant_id  ON employees(tenant_id);
CREATE INDEX idx_employees_no         ON employees(tenant_id, employee_no);
CREATE INDEX idx_employees_function   ON employees(function_id);
CREATE INDEX idx_employees_team       ON employees(team_id);
CREATE INDEX idx_employees_status     ON employees(tenant_id, status);
CREATE INDEX idx_employees_gender     ON employees(tenant_id, gender);

-- Now add teams.manager_id FK (employees exists)
ALTER TABLE teams ADD CONSTRAINT fk_teams_manager
    FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL;
CREATE INDEX idx_teams_manager_id ON teams(manager_id);

-- users defined after employees (employee_id FK)
CREATE TABLE users (
    id                       UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID             NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    employee_id              UUID             REFERENCES employees(id) ON DELETE SET NULL,
    email                    VARCHAR(255)     NOT NULL,
    username                 VARCHAR(100),
    password_hash            VARCHAR(255)     NOT NULL,
    first_name               VARCHAR(100),
    last_name                VARCHAR(100),
    status                   user_status_enum NOT NULL DEFAULT 'pending',
    last_login_at            TIMESTAMPTZ,
    last_login_ip            INET,
    failed_attempts          INTEGER          NOT NULL DEFAULT 0,
    locked_at                TIMESTAMPTZ,
    password_changed_at      TIMESTAMPTZ,
    must_change_password     BOOLEAN          NOT NULL DEFAULT TRUE,
    refresh_token_hash       VARCHAR(255),    -- bcrypt hash of current refresh token
    refresh_token_expires_at TIMESTAMPTZ,
    created_at               TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, email)
);

CREATE INDEX idx_users_tenant_id  ON users(tenant_id);
CREATE INDEX idx_users_email      ON users(tenant_id, email);
CREATE INDEX idx_users_employee   ON users(employee_id);
CREATE INDEX idx_users_status     ON users(tenant_id, status);

CREATE TABLE user_roles (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);

CREATE TABLE skills (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name            VARCHAR(100) NOT NULL,
    name_ar         VARCHAR(100),
    code            VARCHAR(50)  NOT NULL,   -- 'voice', 'chat', 'email', 'whatsapp', 'refund', 'nps'
    channel_type    VARCHAR(50),
    expiry_months   INTEGER,                 -- NULL = no expiry
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, code)
);

CREATE INDEX idx_skills_tenant_id ON skills(tenant_id);

CREATE TABLE employee_skills (
    id              UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID                   NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    employee_id     UUID                   NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    skill_id        UUID                   NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
    proficiency     skill_proficiency_enum NOT NULL DEFAULT 'intermediate',
    status          skill_status_enum      NOT NULL DEFAULT 'active',
    certified_at    DATE,
    expires_at      DATE,
    training_notes  TEXT,
    created_at      TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, skill_id)
);

CREATE INDEX idx_emp_skills_tenant    ON employee_skills(tenant_id);
CREATE INDEX idx_emp_skills_employee  ON employee_skills(employee_id);
CREATE INDEX idx_emp_skills_skill     ON employee_skills(skill_id);
CREATE INDEX idx_emp_skills_status    ON employee_skills(tenant_id, status);
CREATE INDEX idx_emp_skills_expires   ON employee_skills(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================
-- SECTION 4: SHIFT CODE DICTIONARY
-- Populated from real Timing sheet via workbook import.
-- Do not hardcode shift codes — all codes come from the import.
-- ============================================================

CREATE TABLE shift_categories (
    id              UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID               NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name            VARCHAR(50)        NOT NULL,
    name_ar         VARCHAR(50),
    code            shift_category_enum NOT NULL,
    sort_order      INTEGER            NOT NULL DEFAULT 0,
    display_color   VARCHAR(7),        -- hex color for schedule grid UI
    is_working      BOOLEAN            NOT NULL DEFAULT TRUE,  -- FALSE for rest/leave/absence
    UNIQUE (tenant_id, code)
);

CREATE INDEX idx_shift_categories_tenant ON shift_categories(tenant_id);

-- shift_codes: populated from Timing sheet parser.
-- Source of truth for all shift logic — never hardcode values.
CREATE TABLE shift_codes (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID         NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    code                VARCHAR(30)  NOT NULL,   -- 'M', 'B9', 'EE20', 'WFH-N', 'MD', 'COMP'
    description         VARCHAR(200),
    description_ar      VARCHAR(200),
    category_id         UUID         REFERENCES shift_categories(id) ON DELETE SET NULL,
    -- Timing data (from Timing sheet)
    start_time          TIME,                    -- NULL for leave/rest codes
    end_time            TIME,                    -- NULL for leave/rest codes
    start_time_2        TIME,                    -- split shift second segment
    end_time_2          TIME,
    working_hours       NUMERIC(4,2),            -- net working hours (excl. break)
    break_hours         NUMERIC(4,2),
    total_hours         NUMERIC(4,2),
    -- Classification flags
    is_split_shift      BOOLEAN      NOT NULL DEFAULT FALSE,
    is_cross_midnight   BOOLEAN      NOT NULL DEFAULT FALSE,
    is_wfh              BOOLEAN      NOT NULL DEFAULT FALSE,
    is_ramadan          BOOLEAN      NOT NULL DEFAULT FALSE,
    is_supervisor_shift BOOLEAN      NOT NULL DEFAULT FALSE,  -- 20-suffix codes (8h)
    is_working_shift    BOOLEAN      NOT NULL DEFAULT TRUE,   -- FALSE for OFF/H/L/COMP etc.
    is_leave_code       BOOLEAN      NOT NULL DEFAULT FALSE,
    is_absence_code     BOOLEAN      NOT NULL DEFAULT FALSE,
    -- Gender rule (configurable per code)
    allows_female       BOOLEAN      NOT NULL DEFAULT TRUE,
    -- UI
    display_color       VARCHAR(7),
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    sort_order          INTEGER      NOT NULL DEFAULT 0,
    -- Import tracking
    source              VARCHAR(20)  NOT NULL DEFAULT 'manual',  -- 'timing_sheet' | 'manual'
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, code)
);

CREATE INDEX idx_shift_codes_tenant    ON shift_codes(tenant_id);
CREATE INDEX idx_shift_codes_code      ON shift_codes(tenant_id, code);
CREATE INDEX idx_shift_codes_working   ON shift_codes(tenant_id, is_working_shift);
CREATE INDEX idx_shift_codes_category  ON shift_codes(category_id);

-- ============================================================
-- SECTION 5: SCHEDULE
-- ============================================================

CREATE TABLE schedule_versions (
    id              UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID                 NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    period_type     schedule_period_enum NOT NULL DEFAULT 'weekly',
    period_start    DATE                 NOT NULL,
    period_end      DATE                 NOT NULL,
    function_id     UUID                 REFERENCES functions(id) ON DELETE SET NULL,  -- NULL = all
    status          schedule_status_enum NOT NULL DEFAULT 'draft',
    version_number  INTEGER              NOT NULL DEFAULT 1,
    label           VARCHAR(100),        -- 'Week 23 Draft 2', 'June 2025 Published'
    notes           TEXT,
    -- Generation metadata
    generated_at    TIMESTAMPTZ,
    generated_by    UUID                 REFERENCES users(id) ON DELETE SET NULL,
    coverage_gaps   JSONB,               -- {function_id: [{interval, required, scheduled, gap}]}
    fairness_score  NUMERIC(5,2),
    -- Publish / lock lifecycle
    published_at    TIMESTAMPTZ,
    published_by    UUID                 REFERENCES users(id) ON DELETE SET NULL,
    locked_at       TIMESTAMPTZ,
    locked_by       UUID                 REFERENCES users(id) ON DELETE SET NULL,
    -- Stats
    total_employees INTEGER,
    total_working_entries INTEGER,
    -- Audit
    created_at      TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    created_by      UUID                 REFERENCES users(id) ON DELETE SET NULL,
    -- A published/locked schedule CANNOT have a new generation overwrite it.
    -- Enforced at application layer + audit log.
    CONSTRAINT chk_period_order CHECK (period_end >= period_start)
);

CREATE INDEX idx_sched_versions_tenant   ON schedule_versions(tenant_id);
CREATE INDEX idx_sched_versions_period   ON schedule_versions(tenant_id, period_start, period_end);
CREATE INDEX idx_sched_versions_status   ON schedule_versions(tenant_id, status);
CREATE INDEX idx_sched_versions_function ON schedule_versions(function_id);

-- The schedule grid: one row per employee per date per version
CREATE TABLE schedule_entries (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    schedule_version_id     UUID        NOT NULL REFERENCES schedule_versions(id) ON DELETE CASCADE,
    employee_id             UUID        NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    entry_date              DATE        NOT NULL,
    -- Shift assignment
    shift_code_id           UUID        REFERENCES shift_codes(id) ON DELETE RESTRICT,
    shift_code_display      VARCHAR(30),            -- denormalized for fast grid rendering
    -- S/A suffix: derived from attendance — not stored as a mutated shift code
    attendance_marker       VARCHAR(5),             -- 'S' (sick) or 'A' (absent), NULL if normal
    -- Manual edit tracking
    is_manual_edit          BOOLEAN     NOT NULL DEFAULT FALSE,
    edit_reason             TEXT,
    edit_by                 UUID        REFERENCES users(id) ON DELETE SET NULL,
    edit_at                 TIMESTAMPTZ,
    original_shift_code_id  UUID        REFERENCES shift_codes(id) ON DELETE SET NULL,
    -- Validation
    validation_flags        JSONB,  -- [{type:'rest_violation', severity:'error', message:'...'}]
    is_locked               BOOLEAN     NOT NULL DEFAULT FALSE,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (schedule_version_id, employee_id, entry_date)
);

CREATE INDEX idx_sched_entries_tenant   ON schedule_entries(tenant_id);
CREATE INDEX idx_sched_entries_version  ON schedule_entries(schedule_version_id);
CREATE INDEX idx_sched_entries_employee ON schedule_entries(employee_id);
CREATE INDEX idx_sched_entries_date     ON schedule_entries(entry_date);
CREATE INDEX idx_sched_entries_emp_date ON schedule_entries(employee_id, entry_date);
CREATE INDEX idx_sched_entries_shift    ON schedule_entries(shift_code_id);
-- Composite for schedule grid display (version + date range)
CREATE INDEX idx_sched_entries_grid     ON schedule_entries(schedule_version_id, entry_date, employee_id);

-- Immutable edit history for published schedule cells
-- Every manual change to a published schedule writes here.
CREATE TABLE schedule_entry_edits (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    entry_id            UUID        NOT NULL REFERENCES schedule_entries(id) ON DELETE CASCADE,
    old_shift_code_id   UUID        REFERENCES shift_codes(id) ON DELETE SET NULL,
    new_shift_code_id   UUID        REFERENCES shift_codes(id) ON DELETE SET NULL,
    old_shift_display   VARCHAR(30),
    new_shift_display   VARCHAR(30),
    old_marker          VARCHAR(5),
    new_marker          VARCHAR(5),
    -- Before/after impact snapshots (stored at time of edit)
    shift_rate_before   JSONB,  -- {morning:N, evening:N, night:N, midnight:N, wfh:N}
    shift_rate_after    JSONB,
    hc_impact_before    JSONB,  -- [{interval_start, function_id, available_hc}]
    hc_impact_after     JSONB,
    edit_reason         TEXT,
    edited_by           UUID        REFERENCES users(id) ON DELETE SET NULL,
    edited_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at — this table is append-only (edit history never changes)
);

CREATE INDEX idx_entry_edits_entry     ON schedule_entry_edits(entry_id);
CREATE INDEX idx_entry_edits_tenant    ON schedule_entry_edits(tenant_id);
CREATE INDEX idx_entry_edits_edited_at ON schedule_entry_edits(edited_at);

-- ============================================================
-- SECTION 6: ATTENDANCE
-- ============================================================

CREATE TABLE attendance_records (
    id                          UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID                   NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    employee_id                 UUID                   NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    attendance_date             DATE                   NOT NULL,
    -- Scheduled shift (from schedule grid)
    scheduled_shift_code_id     UUID                   REFERENCES shift_codes(id) ON DELETE SET NULL,
    scheduled_start             TIME,
    scheduled_end               TIME,
    scheduled_start_2           TIME,   -- split shift second segment
    scheduled_end_2             TIME,
    -- Actual attendance (from Shifts sheet / punch system)
    punch_in                    TIMESTAMPTZ,
    punch_out                   TIMESTAMPTZ,
    system_login                TIMESTAMPTZ,
    system_logout               TIMESTAMPTZ,
    -- Computed metrics (calculated by attendance engine after import)
    punch_late_minutes          INTEGER     NOT NULL DEFAULT 0,
    punch_early_out_minutes     INTEGER     NOT NULL DEFAULT 0,
    system_late_minutes         INTEGER     NOT NULL DEFAULT 0,
    system_early_out_minutes    INTEGER     NOT NULL DEFAULT 0,
    ot_minutes                  INTEGER     NOT NULL DEFAULT 0,
    -- Flags
    is_missing_punch            BOOLEAN     NOT NULL DEFAULT FALSE,
    is_missing_system           BOOLEAN     NOT NULL DEFAULT FALSE,
    is_wfh                      BOOLEAN     NOT NULL DEFAULT FALSE,
    -- Status
    attendance_marker           attendance_marker_enum NOT NULL DEFAULT 'present',
    absence_reason              TEXT,
    -- Import tracking (FK added after import_batches is created)
    import_batch_id             UUID,
    notes                       TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, employee_id, attendance_date)
);

CREATE INDEX idx_attendance_tenant    ON attendance_records(tenant_id);
CREATE INDEX idx_attendance_employee  ON attendance_records(employee_id);
CREATE INDEX idx_attendance_date      ON attendance_records(attendance_date);
CREATE INDEX idx_attendance_emp_date  ON attendance_records(employee_id, attendance_date);
CREATE INDEX idx_attendance_marker    ON attendance_records(tenant_id, attendance_marker);

-- ============================================================
-- SECTION 7: IMPORT BATCHES
-- Every workbook import goes through preview -> validate -> commit.
-- Raw row data is stored for audit and re-processing.
-- ============================================================

CREATE TABLE import_batches (
    id                  UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID             NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    import_type         import_type_enum NOT NULL,
    original_filename   VARCHAR(255)     NOT NULL,
    stored_filename     VARCHAR(255),
    file_path           TEXT,
    file_size_bytes     BIGINT,
    status              import_status_enum NOT NULL DEFAULT 'uploaded',
    -- Row counts (populated after parsing)
    total_rows          INTEGER,
    valid_rows          INTEGER,
    error_rows          INTEGER,
    warning_rows        INTEGER,
    skipped_rows        INTEGER,
    -- Lifecycle
    committed_at        TIMESTAMPTZ,
    committed_by        UUID             REFERENCES users(id) ON DELETE SET NULL,
    cancelled_at        TIMESTAMPTZ,
    cancelled_by        UUID             REFERENCES users(id) ON DELETE SET NULL,
    -- Summary
    error_summary       JSONB,           -- [{row, field, message}]
    metadata            JSONB,           -- {sheet_names:[], period_detected:'2023-01', ...}
    notes               TEXT,
    created_at          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    created_by          UUID             NOT NULL REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_import_batches_tenant     ON import_batches(tenant_id);
CREATE INDEX idx_import_batches_status     ON import_batches(tenant_id, status);
CREATE INDEX idx_import_batches_type       ON import_batches(tenant_id, import_type);
CREATE INDEX idx_import_batches_created    ON import_batches(created_at);

CREATE TABLE import_rows (
    id              UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
    import_batch_id UUID                   NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    tenant_id       UUID                   NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    row_number      INTEGER                NOT NULL,
    sheet_name      VARCHAR(100),
    raw_data        JSONB                  NOT NULL,   -- original Excel row as-parsed
    parsed_data     JSONB,                             -- normalized/interpreted row
    status          import_row_status_enum NOT NULL DEFAULT 'valid',
    errors          JSONB,   -- [{field:'employee_no', message:'Not found', severity:'error'}]
    warnings        JSONB,   -- [{field:'shift_code', message:'Unknown code XYZ', severity:'warning'}]
    created_at      TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
    UNIQUE (import_batch_id, row_number)
);

CREATE INDEX idx_import_rows_batch  ON import_rows(import_batch_id);
CREATE INDEX idx_import_rows_tenant ON import_rows(tenant_id);
CREATE INDEX idx_import_rows_status ON import_rows(import_batch_id, status);

-- Now add FK from attendance_records to import_batches
ALTER TABLE attendance_records
    ADD CONSTRAINT fk_attendance_import_batch
    FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL;
CREATE INDEX idx_attendance_import_batch
    ON attendance_records(import_batch_id) WHERE import_batch_id IS NOT NULL;

-- ============================================================
-- SECTION 8: REQUESTS & APPROVALS
-- Envelope + extension pattern:
--   requests (base) + request_permissions / request_leaves /
--   request_shift_swaps / request_overtimes (extensions)
-- ============================================================

CREATE TABLE request_types (
    id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID         NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    code                    VARCHAR(50)  NOT NULL,   -- 'permission', 'annual_leave', 'shift_swap'
    name                    VARCHAR(100) NOT NULL,
    name_ar                 VARCHAR(100),
    requires_peer_acceptance BOOLEAN     NOT NULL DEFAULT FALSE,  -- shift/OFF swaps
    requires_coverage_check BOOLEAN      NOT NULL DEFAULT FALSE,
    requires_attachment     BOOLEAN      NOT NULL DEFAULT FALSE,
    sla_hours               INTEGER,                              -- NULL = no SLA
    approval_levels         INTEGER      NOT NULL DEFAULT 1,
    is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
    sort_order              INTEGER      NOT NULL DEFAULT 0,
    UNIQUE (tenant_id, code)
);

CREATE INDEX idx_request_types_tenant ON request_types(tenant_id);

CREATE TABLE requests (
    id                  UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID                 NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    request_type_id     UUID                 NOT NULL REFERENCES request_types(id) ON DELETE RESTRICT,
    requester_id        UUID                 NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    employee_id         UUID                 REFERENCES employees(id) ON DELETE SET NULL,
    status              request_status_enum  NOT NULL DEFAULT 'pending',
    is_urgent           BOOLEAN              NOT NULL DEFAULT FALSE,
    -- Approval chain
    current_approver_id UUID                 REFERENCES users(id) ON DELETE SET NULL,
    approver_l1_id      UUID                 REFERENCES users(id) ON DELETE SET NULL,
    approver_l2_id      UUID                 REFERENCES users(id) ON DELETE SET NULL,
    approved_l1_at      TIMESTAMPTZ,
    approved_l2_at      TIMESTAMPTZ,
    rejected_at         TIMESTAMPTZ,
    rejected_by         UUID                 REFERENCES users(id) ON DELETE SET NULL,
    rejection_reason    TEXT,
    -- SLA and HC impact
    sla_due_at          TIMESTAMPTZ,
    hc_impact           JSONB,  -- {before:{interval:[{function_id,required,scheduled,available}]}, after:...}
    notes               TEXT,
    submitted_at        TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_requests_tenant      ON requests(tenant_id);
CREATE INDEX idx_requests_requester   ON requests(requester_id);
CREATE INDEX idx_requests_employee    ON requests(employee_id);
CREATE INDEX idx_requests_status      ON requests(tenant_id, status);
CREATE INDEX idx_requests_type        ON requests(tenant_id, request_type_id);
CREATE INDEX idx_requests_approver    ON requests(current_approver_id) WHERE current_approver_id IS NOT NULL;
CREATE INDEX idx_requests_submitted   ON requests(submitted_at);
CREATE INDEX idx_requests_sla_pending ON requests(sla_due_at) WHERE status = 'pending';

-- Extension: Permission (early leave / permission request)
CREATE TABLE request_permissions (
    request_id         UUID    PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
    permission_date    DATE    NOT NULL,
    start_time         TIME    NOT NULL,
    end_time           TIME    NOT NULL,
    duration_minutes   INTEGER NOT NULL,
    reason             VARCHAR(200) NOT NULL,
    function_id        UUID    REFERENCES functions(id) ON DELETE SET NULL,
    hc_interval_impact JSONB   -- [{interval_start, function_id, required_hc, scheduled_hc, after_hc, gap}]
);

CREATE INDEX idx_req_perm_date ON request_permissions(permission_date);

-- Extension: Leave (annual / sick / death / comp / university)
CREATE TABLE request_leaves (
    request_id                    UUID     PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
    leave_type                    VARCHAR(30) NOT NULL,  -- 'annual', 'sick', 'death', 'comp', 'university'
    start_date                    DATE     NOT NULL,
    end_date                      DATE     NOT NULL,
    duration_days                 NUMERIC(4,1) NOT NULL,
    is_half_day                   BOOLEAN  NOT NULL DEFAULT FALSE,
    medical_certificate_required  BOOLEAN  NOT NULL DEFAULT FALSE,
    attachment_submitted          BOOLEAN  NOT NULL DEFAULT FALSE,
    CONSTRAINT chk_leave_dates CHECK (end_date >= start_date)
);

CREATE INDEX idx_req_leave_dates ON request_leaves(start_date, end_date);

-- Extension: Shift / OFF swap (peer acceptance required first)
CREATE TABLE request_shift_swaps (
    request_id               UUID     PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
    swap_type                VARCHAR(20) NOT NULL,  -- 'shift_swap' | 'off_swap'
    requester_entry_id       UUID     REFERENCES schedule_entries(id) ON DELETE SET NULL,
    requester_date           DATE     NOT NULL,
    requester_shift_code_id  UUID     REFERENCES shift_codes(id) ON DELETE SET NULL,
    target_employee_id       UUID     REFERENCES employees(id) ON DELETE SET NULL,
    target_entry_id          UUID     REFERENCES schedule_entries(id) ON DELETE SET NULL,
    target_date              DATE     NOT NULL,
    target_shift_code_id     UUID     REFERENCES shift_codes(id) ON DELETE SET NULL,
    -- Step 1: peer acceptance before TL/WFM approval
    peer_accepted_at         TIMESTAMPTZ,
    peer_rejected_at         TIMESTAMPTZ,
    peer_rejection_reason    TEXT,
    -- Validation results
    coverage_check_passed    BOOLEAN,
    rest_check_passed        BOOLEAN,
    gender_check_passed      BOOLEAN,
    -- Before/after shift rate for both employees
    shift_rate_impact        JSONB   -- {requester:{before,after}, target:{before,after}}
);

CREATE INDEX idx_req_swap_target ON request_shift_swaps(target_employee_id);

-- Extension: Overtime
CREATE TABLE request_overtimes (
    request_id       UUID     PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
    ot_date          DATE     NOT NULL,
    start_time       TIME     NOT NULL,
    end_time         TIME     NOT NULL,
    duration_minutes INTEGER  NOT NULL,
    ot_reason        TEXT,
    function_id      UUID     REFERENCES functions(id) ON DELETE SET NULL
);

-- ============================================================
-- SECTION 9: HEADCOUNT INTERVALS
-- Snapshot table for live Hour × Function HC visibility.
-- Powers: RTA dashboard, permission impact, coverage gaps.
-- ============================================================

CREATE TABLE headcount_intervals (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    snapshot_date       DATE        NOT NULL,
    interval_start      TIMESTAMPTZ NOT NULL,
    interval_end        TIMESTAMPTZ NOT NULL,
    function_id         UUID        NOT NULL REFERENCES functions(id) ON DELETE RESTRICT,
    required_hc         INTEGER     NOT NULL DEFAULT 0,
    scheduled_hc        INTEGER     NOT NULL DEFAULT 0,
    actual_hc           INTEGER     NOT NULL DEFAULT 0,
    on_permission_hc    INTEGER     NOT NULL DEFAULT 0,
    on_sick_hc          INTEGER     NOT NULL DEFAULT 0,
    on_leave_hc         INTEGER     NOT NULL DEFAULT 0,
    -- Computed: available = scheduled - on_permission - on_sick - on_leave
    available_hc        INTEGER     GENERATED ALWAYS AS (
                            scheduled_hc - on_permission_hc - on_sick_hc - on_leave_hc
                        ) STORED,
    -- Computed: gap = max(0, required - available)
    gap_hc              INTEGER     GENERATED ALWAYS AS (
                            GREATEST(0, required_hc - (
                                scheduled_hc - on_permission_hc - on_sick_hc - on_leave_hc
                            ))
                        ) STORED,
    schedule_version_id UUID        REFERENCES schedule_versions(id) ON DELETE SET NULL,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hc_tenant     ON headcount_intervals(tenant_id);
CREATE INDEX idx_hc_date       ON headcount_intervals(snapshot_date);
CREATE INDEX idx_hc_function   ON headcount_intervals(function_id);
CREATE INDEX idx_hc_interval   ON headcount_intervals(interval_start, interval_end);
CREATE INDEX idx_hc_func_date  ON headcount_intervals(function_id, snapshot_date);

-- ============================================================
-- SECTION 10: OUTAGES
-- ============================================================

CREATE TABLE outage_types (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID         NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name        VARCHAR(100) NOT NULL,
    name_ar     VARCHAR(100),
    code        VARCHAR(50)  NOT NULL,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    sort_order  INTEGER      NOT NULL DEFAULT 0,
    UNIQUE (tenant_id, code)
);

CREATE INDEX idx_outage_types_tenant ON outage_types(tenant_id);

CREATE TABLE outages (
    id                          UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID                  NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    outage_type_id              UUID                  REFERENCES outage_types(id) ON DELETE SET NULL,
    title                       VARCHAR(255)          NOT NULL,
    description                 TEXT,
    severity                    outage_severity_enum  NOT NULL DEFAULT 'medium',
    status                      outage_status_enum    NOT NULL DEFAULT 'reported',
    impacted_function_ids       UUID[]                NOT NULL DEFAULT '{}',
    started_at                  TIMESTAMPTZ           NOT NULL,
    ended_at                    TIMESTAMPTZ,
    -- Computed duration in minutes
    duration_minutes            INTEGER               GENERATED ALWAYS AS (
                                    CASE WHEN ended_at IS NOT NULL
                                    THEN EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER / 60
                                    ELSE NULL END
                                ) STORED,
    reported_by                 UUID                  REFERENCES users(id) ON DELETE SET NULL,
    validated_by                UUID                  REFERENCES users(id) ON DELETE SET NULL,
    validated_at                TIMESTAMPTZ,
    assigned_to                 UUID                  REFERENCES users(id) ON DELETE SET NULL,
    resolved_by                 UUID                  REFERENCES users(id) ON DELETE SET NULL,
    resolved_at                 TIMESTAMPTZ,
    root_cause                  TEXT,
    resolution                  TEXT,
    impact_description          TEXT,
    hc_impact                   JSONB,
    sla_due_at                  TIMESTAMPTZ,
    email_notifications_sent    BOOLEAN               NOT NULL DEFAULT FALSE,
    created_at                  TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outages_tenant    ON outages(tenant_id);
CREATE INDEX idx_outages_status    ON outages(tenant_id, status);
CREATE INDEX idx_outages_started   ON outages(started_at);
CREATE INDEX idx_outages_severity  ON outages(tenant_id, severity);

-- ============================================================
-- SECTION 11: TECHNICAL ISSUES
-- Agent/TL raises issue → RTA validates → IT escalation → resolve.
-- CX issue flag triggered at repeated_count >= 20.
-- SLA target: 48 hours.
-- ============================================================

CREATE TABLE technical_issues (
    id                  UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID                    NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    title               VARCHAR(255)            NOT NULL,
    description         TEXT,
    original_case_id    VARCHAR(100),           -- CRM case reference
    issue_reason        VARCHAR(200)            NOT NULL,
    function_id         UUID                    REFERENCES functions(id) ON DELETE SET NULL,
    channel             VARCHAR(50),
    customer_impact     TEXT,
    sku                 VARCHAR(100),           -- product SKU if defect-related
    status              tech_issue_status_enum  NOT NULL DEFAULT 'reported',
    reported_by         UUID                    REFERENCES users(id) ON DELETE SET NULL,
    validated_by        UUID                    REFERENCES users(id) ON DELETE SET NULL,
    validated_at        TIMESTAMPTZ,
    escalated_to        UUID                    REFERENCES users(id) ON DELETE SET NULL,
    escalated_at        TIMESTAMPTZ,
    resolved_by         UUID                    REFERENCES users(id) ON DELETE SET NULL,
    resolved_at         TIMESTAMPTZ,
    resolution          TEXT,
    repeated_count      INTEGER                 NOT NULL DEFAULT 1,
    is_cx_issue         BOOLEAN                 NOT NULL DEFAULT FALSE,  -- true when >= 20
    sla_due_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tech_issues_tenant  ON technical_issues(tenant_id);
CREATE INDEX idx_tech_issues_status  ON technical_issues(tenant_id, status);
CREATE INDEX idx_tech_issues_reason  ON technical_issues(tenant_id, issue_reason);
CREATE INDEX idx_tech_issues_cx      ON technical_issues(tenant_id, is_cx_issue) WHERE is_cx_issue = TRUE;

-- ============================================================
-- SECTION 12: AUDIT LOG (APPEND-ONLY)
-- Every sensitive action must be recorded here.
-- No UPDATE or DELETE is ever allowed on this table.
-- ============================================================

CREATE TABLE audit_logs (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID         NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    actor_id    UUID         REFERENCES users(id) ON DELETE SET NULL,
    actor_email VARCHAR(255),           -- denormalized: survives user record deletion
    action      VARCHAR(100) NOT NULL,  -- 'schedule.published', 'request.approved', 'user.created'
    module      VARCHAR(50)  NOT NULL,  -- 'schedule', 'requests', 'attendance', 'users'
    entity_type VARCHAR(50)  NOT NULL,  -- 'schedule_version', 'request', 'employee'
    entity_id   UUID,
    old_value   JSONB,
    new_value   JSONB,
    metadata    JSONB,                  -- extra context: reason, ip, etc.
    ip_address  INET,
    user_agent  TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    -- Intentionally NO updated_at — this table is append-only
);

CREATE INDEX idx_audit_tenant    ON audit_logs(tenant_id);
CREATE INDEX idx_audit_actor     ON audit_logs(actor_id);
CREATE INDEX idx_audit_entity    ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_action    ON audit_logs(tenant_id, action);
CREATE INDEX idx_audit_created   ON audit_logs(created_at);
CREATE INDEX idx_audit_module    ON audit_logs(tenant_id, module);

-- Enforce append-only: block UPDATE and DELETE at database level
CREATE OR REPLACE FUNCTION fn_audit_log_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION
        'audit_logs is append-only. UPDATE and DELETE operations are not permitted.';
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_log_no_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log_immutable();

CREATE TRIGGER trg_audit_log_no_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log_immutable();

-- ============================================================
-- SECTION 13: ATTACHMENTS (POLYMORPHIC)
-- ============================================================

CREATE TABLE attachments (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID         NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    entity_type       VARCHAR(50)  NOT NULL,  -- 'request', 'outage', 'technical_issue', 'coaching'
    entity_id         UUID         NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename   VARCHAR(255) NOT NULL,
    file_path         TEXT         NOT NULL,
    file_size_bytes   BIGINT,
    mime_type         VARCHAR(100),
    uploaded_by       UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attachments_tenant ON attachments(tenant_id);
CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);

-- ============================================================
-- SECTION 14: NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID         NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    recipient_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type VARCHAR(50)  NOT NULL,  -- 'request.approved', 'schedule.published', 'outage.opened'
    title             VARCHAR(255) NOT NULL,
    title_ar          VARCHAR(255),
    body              TEXT,
    body_ar           TEXT,
    entity_type       VARCHAR(50),
    entity_id         UUID,
    action_url        TEXT,
    is_read           BOOLEAN      NOT NULL DEFAULT FALSE,
    read_at           TIMESTAMPTZ,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_tenant    ON notifications(tenant_id);
CREATE INDEX idx_notif_recipient ON notifications(recipient_id, is_read);
CREATE INDEX idx_notif_unread    ON notifications(recipient_id) WHERE is_read = FALSE;
CREATE INDEX idx_notif_created   ON notifications(created_at);

-- ============================================================
-- END OF SCHEMA
-- Total tables: 35
-- Enums: 20
-- Triggers: 2 (audit_log immutability)
-- Generated columns: 3 (available_hc, gap_hc, duration_minutes)
-- ============================================================
