-- ============================================================
-- WFM PLATFORM — BOUTIQAAT TENANT SEED DATA
-- Migration:    002
-- Date:         2026-06-08
-- Depends on:   001_initial_schema.sql
--
-- Contents:
--   1. Boutiqaat tenant (tenant_id fixed — used as FK in all tables)
--   2. Tenant settings (business rules, scheduling, security)
--   3. System permissions (full RBAC permission set)
--   4. System roles (6 core roles + role_permissions)
--   5. Functions (Inbound Voice, Chat, WhatsApp, Email, Back Office)
--   6. Shift categories (Morning, Evening, Night, Midnight, WFH, etc.)
--   7. Request types (6 core types)
--   8. Outage types (6 core types)
--   9. Skills (6 core skills)
--  10. Platform admin user
--
-- NOTE: Shift codes (145+) are NOT seeded here.
--       They are imported from the real Timing sheet workbook.
--       See: docs/WFM_AI_SKILLS_ROUTER.md, Skill 05 (Import Specialist)
--
-- PROPRIETARY AND CONFIDENTIAL — ALL RIGHTS RESERVED
-- ============================================================

BEGIN;

-- ============================================================
-- 1. BOUTIQAAT TENANT
-- Fixed UUID so all subsequent migrations and seeds can reference
-- it predictably without a lookup.
-- ============================================================

INSERT INTO tenants (
    id, name, legal_name, slug, status,
    timezone, default_locale, primary_color
) VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'Boutiqaat',
    'Boutiqaat Company K.S.C.P.',
    'boutiqaat',
    'active',
    'Asia/Kuwait',
    'ar',
    '#1A3C8F'
) ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- 2. TENANT SETTINGS
-- Covers: scheduling constraints, attendance rules, security
-- policy, and capacity model defaults.
-- ============================================================

INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, setting_group, description)
VALUES

-- === Scheduling ===
('a0000000-0000-0000-0000-000000000001',
 'min_rest_between_shifts_hours',
 '11',
 'schedule',
 'Minimum rest hours between two consecutive shifts'),

('a0000000-0000-0000-0000-000000000001',
 'max_consecutive_working_days',
 '6',
 'schedule',
 'Maximum allowed consecutive working days before a rest day is required'),

('a0000000-0000-0000-0000-000000000001',
 'female_forbidden_hours',
 '{"after": "21:00", "before": "06:00"}',
 'schedule',
 'Female agents may not be scheduled for shifts ending after 21:00 or starting before 06:00'),

('a0000000-0000-0000-0000-000000000001',
 'supervisor_shift_codes_suffix',
 '"20"',
 'schedule',
 'Shift code suffix that identifies supervisor shifts (e.g. EE20, M20). Only is_supervisor=true employees may be assigned these.'),

('a0000000-0000-0000-0000-000000000001',
 'wfh_max_days_per_week',
 '2',
 'schedule',
 'Maximum WFH shift days per agent per week'),

('a0000000-0000-0000-0000-000000000001',
 'intern_productivity_factor',
 '0.70',
 'schedule',
 'Interns count as 0.70 FTE in HC calculations'),

('a0000000-0000-0000-0000-000000000001',
 'published_schedule_lock_enabled',
 'true',
 'schedule',
 'Published schedule versions cannot be overwritten by a new generation — only manual cell edits are allowed and must be audited'),

('a0000000-0000-0000-0000-000000000001',
 'schedule_default_period',
 '"weekly"',
 'schedule',
 'Default schedule period type: weekly | monthly | daily'),

-- === Attendance ===
('a0000000-0000-0000-0000-000000000001',
 'late_threshold_minutes',
 '5',
 'attendance',
 'Minutes after scheduled start before punch-in is marked as late'),

('a0000000-0000-0000-0000-000000000001',
 'early_out_threshold_minutes',
 '15',
 'attendance',
 'Minutes before scheduled end that punch-out is flagged as early leave'),

('a0000000-0000-0000-0000-000000000001',
 'sick_marker_code',
 '"S"',
 'attendance',
 'Attendance marker appended to shift code display when agent is on sick leave (e.g. M → MS)'),

('a0000000-0000-0000-0000-000000000001',
 'absent_marker_code',
 '"A"',
 'attendance',
 'Attendance marker appended to shift code display when agent is absent (e.g. M → MA)'),

-- === Capacity (Erlang defaults) ===
('a0000000-0000-0000-0000-000000000001',
 'voice_service_level_target',
 '{"percent": 80, "within_seconds": 20}',
 'capacity',
 'Voice SLA target: 80% of calls answered within 20 seconds (standard Erlang-C input)'),

('a0000000-0000-0000-0000-000000000001',
 'voice_avg_handle_time_seconds',
 '300',
 'capacity',
 'Default AHT for voice channel used in Erlang-C calculation (seconds). Override per function.'),

('a0000000-0000-0000-0000-000000000001',
 'chat_concurrency',
 '4',
 'capacity',
 'Maximum simultaneous chat conversations per agent (used in concurrent capacity model)'),

('a0000000-0000-0000-0000-000000000001',
 'whatsapp_concurrency',
 '4',
 'capacity',
 'Maximum simultaneous WhatsApp conversations per agent'),

('a0000000-0000-0000-0000-000000000001',
 'email_backlog_model',
 'true',
 'capacity',
 'Email channel uses backlog capacity model (not Erlang-C; not concurrency)'),

('a0000000-0000-0000-0000-000000000001',
 'hc_interval_minutes',
 '30',
 'capacity',
 'Interval granularity for headcount planning (30-minute intervals)'),

('a0000000-0000-0000-0000-000000000001',
 'shrinkage_percent',
 '{"default": 25, "ramadan": 35}',
 'capacity',
 'Default shrinkage percentage applied in HC required calculation'),

-- === Security ===
('a0000000-0000-0000-0000-000000000001',
 'max_failed_login_attempts',
 '5',
 'security',
 'Account lock after N consecutive failed login attempts'),

('a0000000-0000-0000-0000-000000000001',
 'session_timeout_minutes',
 '480',
 'security',
 'Idle session timeout (8 hours for contact center operations)'),

('a0000000-0000-0000-0000-000000000001',
 'password_min_length',
 '12',
 'security',
 'Minimum password length'),

-- === Technical Issues SLA ===
('a0000000-0000-0000-0000-000000000001',
 'tech_issue_sla_hours',
 '48',
 'technical_issues',
 'SLA target: technical issues must be resolved within 48 hours'),

('a0000000-0000-0000-0000-000000000001',
 'tech_issue_cx_threshold',
 '20',
 'technical_issues',
 'Repeated issue count that triggers automatic CX Issue flag')

ON CONFLICT (tenant_id, setting_key) DO NOTHING;

-- ============================================================
-- 3. SYSTEM PERMISSIONS
-- One row per atomic action — module:action pattern.
-- These are platform-wide and not tenant-scoped.
-- ============================================================

INSERT INTO permissions (id, code, module, action, description) VALUES

-- Schedule
(gen_random_uuid(), 'schedule.view',             'schedule',   'view',     'View published schedules'),
(gen_random_uuid(), 'schedule.view_draft',        'schedule',   'view',     'View draft schedule versions'),
(gen_random_uuid(), 'schedule.create',            'schedule',   'create',   'Create a new schedule version'),
(gen_random_uuid(), 'schedule.edit',              'schedule',   'edit',     'Edit individual schedule cells'),
(gen_random_uuid(), 'schedule.generate',          'schedule',   'create',   'Trigger auto-schedule generation'),
(gen_random_uuid(), 'schedule.publish',           'schedule',   'approve',  'Publish a schedule version'),
(gen_random_uuid(), 'schedule.lock',              'schedule',   'approve',  'Lock a published schedule'),
(gen_random_uuid(), 'schedule.delete_draft',      'schedule',   'delete',   'Delete a draft schedule version'),
(gen_random_uuid(), 'schedule.import',            'schedule',   'create',   'Import schedule from workbook'),

-- Attendance
(gen_random_uuid(), 'attendance.view_own',        'attendance', 'view',     'View own attendance record'),
(gen_random_uuid(), 'attendance.view_team',       'attendance', 'view',     'View team attendance records'),
(gen_random_uuid(), 'attendance.view_all',        'attendance', 'view',     'View all attendance records'),
(gen_random_uuid(), 'attendance.edit',            'attendance', 'edit',     'Manually correct attendance records'),
(gen_random_uuid(), 'attendance.import',          'attendance', 'create',   'Import attendance from Shifts sheet'),
(gen_random_uuid(), 'attendance.export',          'attendance', 'view',     'Export attendance report'),

-- Requests
(gen_random_uuid(), 'requests.create',            'requests',   'create',   'Submit a new request'),
(gen_random_uuid(), 'requests.view_own',          'requests',   'view',     'View own requests'),
(gen_random_uuid(), 'requests.view_team',         'requests',   'view',     'View team requests'),
(gen_random_uuid(), 'requests.view_all',          'requests',   'view',     'View all requests'),
(gen_random_uuid(), 'requests.approve_l1',        'requests',   'approve',  'First-level request approval (TL)'),
(gen_random_uuid(), 'requests.approve_l2',        'requests',   'approve',  'Second-level request approval (WFM)'),
(gen_random_uuid(), 'requests.cancel',            'requests',   'delete',   'Cancel or withdraw a request'),

-- Employees
(gen_random_uuid(), 'employees.view',             'employees',  'view',     'View employee list'),
(gen_random_uuid(), 'employees.create',           'employees',  'create',   'Create employee records'),
(gen_random_uuid(), 'employees.edit',             'employees',  'edit',     'Edit employee records'),
(gen_random_uuid(), 'employees.deactivate',       'employees',  'delete',   'Deactivate an employee'),
(gen_random_uuid(), 'employees.import',           'employees',  'create',   'Bulk import employees'),

-- Users
(gen_random_uuid(), 'users.view',                 'users',      'view',     'View system user accounts'),
(gen_random_uuid(), 'users.create',               'users',      'create',   'Create system user accounts'),
(gen_random_uuid(), 'users.edit',                 'users',      'edit',     'Edit user accounts and roles'),
(gen_random_uuid(), 'users.deactivate',           'users',      'delete',   'Deactivate user accounts'),

-- Headcount / Capacity
(gen_random_uuid(), 'hc.view',                    'hc',         'view',     'View headcount intervals and capacity plans'),
(gen_random_uuid(), 'hc.edit',                    'hc',         'edit',     'Edit required HC values'),
(gen_random_uuid(), 'hc.import',                  'hc',         'create',   'Import HC plan from workbook'),
(gen_random_uuid(), 'hc.export',                  'hc',         'view',     'Export HC report'),

-- RTA / Live Operations
(gen_random_uuid(), 'rta.view',                   'rta',        'view',     'View RTA live dashboard'),
(gen_random_uuid(), 'rta.view_adherence',         'rta',        'view',     'View agent adherence state'),
(gen_random_uuid(), 'rta.override',               'rta',        'edit',     'Override RTA agent state'),

-- Outages
(gen_random_uuid(), 'outages.view',               'outages',    'view',     'View outage records'),
(gen_random_uuid(), 'outages.create',             'outages',    'create',   'Report a new outage'),
(gen_random_uuid(), 'outages.validate',           'outages',    'approve',  'Validate a reported outage'),
(gen_random_uuid(), 'outages.edit',               'outages',    'edit',     'Edit outage details'),
(gen_random_uuid(), 'outages.resolve',            'outages',    'approve',  'Mark outage resolved'),

-- Technical Issues
(gen_random_uuid(), 'tech_issues.view',           'tech_issues','view',     'View technical issues'),
(gen_random_uuid(), 'tech_issues.create',         'tech_issues','create',   'Report a new technical issue'),
(gen_random_uuid(), 'tech_issues.validate',       'tech_issues','approve',  'Validate a technical issue'),
(gen_random_uuid(), 'tech_issues.escalate',       'tech_issues','approve',  'Escalate a technical issue to IT'),
(gen_random_uuid(), 'tech_issues.resolve',        'tech_issues','approve',  'Resolve a technical issue'),

-- Scorecard / Coaching
(gen_random_uuid(), 'scorecard.view_own',         'scorecard',  'view',     'View own scorecard'),
(gen_random_uuid(), 'scorecard.view_team',        'scorecard',  'view',     'View team scorecard'),
(gen_random_uuid(), 'scorecard.view_all',         'scorecard',  'view',     'View all scorecards'),
(gen_random_uuid(), 'scorecard.edit',             'scorecard',  'edit',     'Edit scorecard entries'),
(gen_random_uuid(), 'scorecard.import',           'scorecard',  'create',   'Import scorecard from workbook'),
(gen_random_uuid(), 'coaching.view',              'coaching',   'view',     'View coaching sessions'),
(gen_random_uuid(), 'coaching.create',            'coaching',   'create',   'Create coaching session'),
(gen_random_uuid(), 'coaching.edit',              'coaching',   'edit',     'Edit coaching session notes'),

-- Reports
(gen_random_uuid(), 'reports.view',               'reports',    'view',     'Run and view standard reports'),
(gen_random_uuid(), 'reports.export',             'reports',    'view',     'Export reports to Excel/PDF'),
(gen_random_uuid(), 'reports.custom',             'reports',    'create',   'Build custom reports'),

-- Audit
(gen_random_uuid(), 'audit.view',                 'audit',      'view',     'View audit log entries'),

-- Settings / Admin
(gen_random_uuid(), 'settings.view',              'settings',   'view',     'View tenant configuration'),
(gen_random_uuid(), 'settings.edit',              'settings',   'edit',     'Edit tenant configuration and settings'),
(gen_random_uuid(), 'admin.roles',                'admin',      'edit',     'Manage roles and permissions'),
(gen_random_uuid(), 'admin.functions',            'admin',      'edit',     'Manage functions and teams'),
(gen_random_uuid(), 'admin.shift_codes',          'admin',      'edit',     'Manage shift code dictionary'),

-- Notifications
(gen_random_uuid(), 'notifications.view',         'notifications','view',   'View own notifications'),
(gen_random_uuid(), 'notifications.manage',       'notifications','edit',   'Manage notification settings'),

-- Import / Export (global)
(gen_random_uuid(), 'import.view',                'import',     'view',     'View import batch history'),
(gen_random_uuid(), 'import.cancel',              'import',     'delete',   'Cancel an in-progress import')

ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 4. SYSTEM ROLES
-- Tenant-scoped for Boutiqaat. is_system_role = true means
-- these cannot be renamed or deleted through the UI.
-- ============================================================

INSERT INTO roles (id, tenant_id, name, code, description, is_system_role, is_active) VALUES

('b0000000-0000-0000-0000-000000000001',
 'a0000000-0000-0000-0000-000000000001',
 'Platform Admin', 'platform_admin',
 'Full access to all modules. Manages users, roles, settings, and audit log.',
 TRUE, TRUE),

('b0000000-0000-0000-0000-000000000002',
 'a0000000-0000-0000-0000-000000000001',
 'WFM Analyst', 'wfm_analyst',
 'Full WFM access: scheduling, HC planning, capacity, imports, reports.',
 TRUE, TRUE),

('b0000000-0000-0000-0000-000000000003',
 'a0000000-0000-0000-0000-000000000001',
 'Team Leader', 'team_leader',
 'Team-level access: view team schedule, approve requests L1, view attendance, create outages/issues.',
 TRUE, TRUE),

('b0000000-0000-0000-0000-000000000004',
 'a0000000-0000-0000-0000-000000000001',
 'RTA Agent', 'rta',
 'Real-time analyst: live dashboard, adherence monitoring, outage and issue management.',
 TRUE, TRUE),

('b0000000-0000-0000-0000-000000000005',
 'a0000000-0000-0000-0000-000000000001',
 'Agent', 'agent',
 'Standard agent: view own schedule, own attendance, own requests, own scorecard, submit requests.',
 TRUE, TRUE),

('b0000000-0000-0000-0000-000000000006',
 'a0000000-0000-0000-0000-000000000001',
 'HR Specialist', 'hr_specialist',
 'HR: employee management, attendance view, request view and override, scorecard view.',
 TRUE, TRUE)

ON CONFLICT (tenant_id, code) DO NOTHING;

-- ============================================================
-- 4b. ROLE PERMISSIONS
-- Assign permissions to roles by code lookups.
-- ============================================================

-- platform_admin: all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT
    'b0000000-0000-0000-0000-000000000001',
    id
FROM permissions
ON CONFLICT DO NOTHING;

-- wfm_analyst: all ops except admin role management and user deactivation
INSERT INTO role_permissions (role_id, permission_id)
SELECT
    'b0000000-0000-0000-0000-000000000002',
    id
FROM permissions
WHERE code NOT IN (
    'admin.roles',
    'users.deactivate',
    'employees.deactivate',
    'audit.view',
    'settings.edit'
)
ON CONFLICT DO NOTHING;

-- team_leader
INSERT INTO role_permissions (role_id, permission_id)
SELECT
    'b0000000-0000-0000-0000-000000000003',
    id
FROM permissions
WHERE code IN (
    'schedule.view',
    'schedule.view_draft',
    'attendance.view_own',
    'attendance.view_team',
    'attendance.export',
    'requests.view_own',
    'requests.view_team',
    'requests.approve_l1',
    'requests.cancel',
    'employees.view',
    'hc.view',
    'rta.view',
    'rta.view_adherence',
    'outages.view',
    'outages.create',
    'outages.validate',
    'tech_issues.view',
    'tech_issues.create',
    'tech_issues.validate',
    'scorecard.view_own',
    'scorecard.view_team',
    'coaching.view',
    'coaching.create',
    'coaching.edit',
    'reports.view',
    'reports.export',
    'notifications.view'
)
ON CONFLICT DO NOTHING;

-- rta
INSERT INTO role_permissions (role_id, permission_id)
SELECT
    'b0000000-0000-0000-0000-000000000004',
    id
FROM permissions
WHERE code IN (
    'schedule.view',
    'attendance.view_all',
    'hc.view',
    'rta.view',
    'rta.view_adherence',
    'rta.override',
    'outages.view',
    'outages.create',
    'outages.validate',
    'outages.edit',
    'outages.resolve',
    'tech_issues.view',
    'tech_issues.create',
    'tech_issues.validate',
    'tech_issues.escalate',
    'tech_issues.resolve',
    'reports.view',
    'notifications.view'
)
ON CONFLICT DO NOTHING;

-- agent: own data only + submit requests
INSERT INTO role_permissions (role_id, permission_id)
SELECT
    'b0000000-0000-0000-0000-000000000005',
    id
FROM permissions
WHERE code IN (
    'schedule.view',
    'attendance.view_own',
    'requests.create',
    'requests.view_own',
    'requests.cancel',
    'scorecard.view_own',
    'notifications.view',
    'tech_issues.create'
)
ON CONFLICT DO NOTHING;

-- hr_specialist
INSERT INTO role_permissions (role_id, permission_id)
SELECT
    'b0000000-0000-0000-0000-000000000006',
    id
FROM permissions
WHERE code IN (
    'schedule.view',
    'attendance.view_all',
    'attendance.edit',
    'attendance.export',
    'requests.view_all',
    'requests.approve_l2',
    'employees.view',
    'employees.create',
    'employees.edit',
    'employees.deactivate',
    'employees.import',
    'scorecard.view_all',
    'reports.view',
    'reports.export',
    'notifications.view'
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. FUNCTIONS (CHANNELS)
-- Boutiqaat contact center channels.
-- concurrency values are used in capacity model.
-- ============================================================

INSERT INTO functions (
    id, tenant_id, name, name_ar, code, channel_type, concurrency, is_active, sort_order
) VALUES

('c0000000-0000-0000-0000-000000000001',
 'a0000000-0000-0000-0000-000000000001',
 'Inbound Voice', 'المكالمات الواردة',
 'inbound_voice', 'voice', NULL, TRUE, 1),

('c0000000-0000-0000-0000-000000000002',
 'a0000000-0000-0000-0000-000000000001',
 'Live Chat', 'الدردشة المباشرة',
 'chat', 'chat', 4, TRUE, 2),

('c0000000-0000-0000-0000-000000000003',
 'a0000000-0000-0000-0000-000000000001',
 'WhatsApp', 'واتساب',
 'whatsapp', 'whatsapp', 4, TRUE, 3),

('c0000000-0000-0000-0000-000000000004',
 'a0000000-0000-0000-0000-000000000001',
 'Email Support', 'البريد الإلكتروني',
 'email', 'email', NULL, TRUE, 4),

('c0000000-0000-0000-0000-000000000005',
 'a0000000-0000-0000-0000-000000000001',
 'Back Office', 'العمليات الخلفية',
 'back_office', 'backoffice', NULL, TRUE, 5)

ON CONFLICT (tenant_id, code) DO NOTHING;

-- ============================================================
-- 6. SHIFT CATEGORIES
-- Maps the enum values to display labels and UI colors.
-- Actual shift codes (M, B9, EE, etc.) are imported from
-- the Timing sheet workbook — NOT seeded here.
-- ============================================================

INSERT INTO shift_categories (tenant_id, name, name_ar, code, sort_order, display_color, is_working) VALUES

('a0000000-0000-0000-0000-000000000001', 'Morning',   'صباحي',     'morning',   1, '#4A90D9', TRUE),
('a0000000-0000-0000-0000-000000000001', 'Evening',   'مسائي',     'evening',   2, '#F5A623', TRUE),
('a0000000-0000-0000-0000-000000000001', 'Night',     'ليلي',      'night',     3, '#7B68EE', TRUE),
('a0000000-0000-0000-0000-000000000001', 'Midnight',  'منتصف الليل','midnight',  4, '#2C3E50', TRUE),
('a0000000-0000-0000-0000-000000000001', 'WFH',       'عمل من المنزل','wfh',   5, '#27AE60', TRUE),
('a0000000-0000-0000-0000-000000000001', 'Leave',     'إجازة',     'leave',     6, '#E8F8FF', FALSE),
('a0000000-0000-0000-0000-000000000001', 'Absence',   'غياب',      'absence',   7, '#FFE5E5', FALSE),
('a0000000-0000-0000-0000-000000000001', 'Rest',      'راحة',      'rest',      8, '#F0F0F0', FALSE),
('a0000000-0000-0000-0000-000000000001', 'Other',     'أخرى',      'other',     9, '#CCCCCC', FALSE)

ON CONFLICT (tenant_id, code) DO NOTHING;

-- ============================================================
-- 7. REQUEST TYPES
-- ============================================================

INSERT INTO request_types (
    tenant_id, code, name, name_ar,
    requires_peer_acceptance, requires_coverage_check,
    requires_attachment, sla_hours, approval_levels,
    is_active, sort_order
) VALUES

('a0000000-0000-0000-0000-000000000001',
 'permission',
 'Permission (Early Leave)',
 'استئذان',
 FALSE, TRUE, FALSE, 4, 2, TRUE, 1),

('a0000000-0000-0000-0000-000000000001',
 'annual_leave',
 'Annual Leave',
 'إجازة سنوية',
 FALSE, TRUE, FALSE, 24, 2, TRUE, 2),

('a0000000-0000-0000-0000-000000000001',
 'sick_leave',
 'Sick Leave',
 'إجازة مرضية',
 FALSE, FALSE, TRUE, 4, 1, TRUE, 3),

('a0000000-0000-0000-0000-000000000001',
 'shift_swap',
 'Shift Swap',
 'تبادل شيفت',
 TRUE, TRUE, FALSE, 24, 2, TRUE, 4),

('a0000000-0000-0000-0000-000000000001',
 'off_swap',
 'Day Off Swap',
 'تبادل أوف',
 TRUE, TRUE, FALSE, 24, 2, TRUE, 5),

('a0000000-0000-0000-0000-000000000001',
 'overtime',
 'Overtime',
 'أوفرتايم',
 FALSE, FALSE, FALSE, 24, 2, TRUE, 6)

ON CONFLICT (tenant_id, code) DO NOTHING;

-- ============================================================
-- 8. OUTAGE TYPES
-- ============================================================

INSERT INTO outage_types (tenant_id, name, name_ar, code, is_active, sort_order) VALUES

('a0000000-0000-0000-0000-000000000001', 'System Outage',          'انقطاع نظام',         'system_outage',         TRUE, 1),
('a0000000-0000-0000-0000-000000000001', 'Internet Outage',        'انقطاع إنترنت',       'internet_outage',       TRUE, 2),
('a0000000-0000-0000-0000-000000000001', 'Phone System Outage',    'انقطاع هاتفي',        'phone_outage',          TRUE, 3),
('a0000000-0000-0000-0000-000000000001', 'CRM Outage',             'انقطاع CRM',          'crm_outage',            TRUE, 4),
('a0000000-0000-0000-0000-000000000001', 'Power Outage',           'انقطاع كهرباء',       'power_outage',          TRUE, 5),
('a0000000-0000-0000-0000-000000000001', 'Partial Service Degradation', 'تدهور جزئي',      'partial_degradation',  TRUE, 6)

ON CONFLICT (tenant_id, code) DO NOTHING;

-- ============================================================
-- 9. SKILLS
-- ============================================================

INSERT INTO skills (tenant_id, name, name_ar, code, channel_type, expiry_months, is_active) VALUES

('a0000000-0000-0000-0000-000000000001', 'Inbound Voice',    'مهارة المكالمات',    'voice',     'voice',     NULL,  TRUE),
('a0000000-0000-0000-0000-000000000001', 'Live Chat',        'مهارة الدردشة',      'chat',      'chat',      NULL,  TRUE),
('a0000000-0000-0000-0000-000000000001', 'WhatsApp',         'مهارة واتساب',       'whatsapp',  'whatsapp',  NULL,  TRUE),
('a0000000-0000-0000-0000-000000000001', 'Email Support',    'مهارة البريد',       'email',     'email',     NULL,  TRUE),
('a0000000-0000-0000-0000-000000000001', 'Refund Handling',  'معالجة الاسترداد',   'refund',    NULL,        12,    TRUE),
('a0000000-0000-0000-0000-000000000001', 'NPS Follow-up',    'متابعة NPS',         'nps',       NULL,        NULL,  TRUE)

ON CONFLICT (tenant_id, code) DO NOTHING;

-- ============================================================
-- 10. PLATFORM ADMIN USER (SEED)
-- Password is the bcrypt/argon2 placeholder — MUST be changed
-- via application seeder that reads SEED_ADMIN_PASSWORD from env.
-- This SQL row uses a sentinel; the real hash is injected by
-- the NestJS seed script in Step 2.
--
-- This row uses a fixed UUID so Step 2 seed script can upsert it.
-- ============================================================

-- NOTE: The actual password hash is NOT set here (it requires the
-- NestJS bcrypt service reading SEED_ADMIN_PASSWORD from .env).
-- This row is intentionally incomplete and will be populated /
-- updated by the backend seed command in Step 2.
-- The must_change_password flag ensures the admin sets a real password
-- on first login.

INSERT INTO users (
    id, tenant_id, employee_id,
    email, username, password_hash,
    first_name, last_name,
    status, must_change_password
) VALUES (
    'd0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    NULL,
    'admin@boutiqaat.wfm',
    'admin',
    -- Sentinel: this MUST be replaced by NestJS seeder before use.
    -- It is NOT a valid hash — login will fail until backend seed runs.
    'REPLACE_WITH_HASHED_PASSWORD',
    'WFM',
    'Admin',
    'active',
    TRUE
) ON CONFLICT (tenant_id, email) DO NOTHING;

-- Assign platform_admin role to seed admin
INSERT INTO user_roles (user_id, role_id)
VALUES (
    'd0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001'
) ON CONFLICT DO NOTHING;

COMMIT;

-- ============================================================
-- POST-SEED SUMMARY
-- ============================================================
-- Tenant:         Boutiqaat (id: a0000000-0000-0000-0000-000000000001)
-- Settings:       25 configuration keys
-- Permissions:    68 permission records
-- Roles:          6 (platform_admin, wfm_analyst, team_leader, rta, agent, hr_specialist)
-- Functions:      5 (voice, chat, whatsapp, email, back_office)
-- Shift categories: 9 (morning through other)
-- Request types:  6 (permission, annual_leave, sick_leave, shift_swap, off_swap, overtime)
-- Outage types:   6 (system, internet, phone, CRM, power, partial)
-- Skills:         6 (voice, chat, whatsapp, email, refund, nps)
-- Shift codes:    0 — imported from Timing sheet workbook (Step 4)
-- Admin user:     admin@boutiqaat.wfm (password set by NestJS seeder in Step 2)
-- ============================================================
