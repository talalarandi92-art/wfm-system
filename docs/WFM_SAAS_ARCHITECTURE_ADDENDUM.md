# WFM SaaS Architecture & Multi-Tenancy Addendum

## Purpose

This document defines SaaS-readiness requirements for the Boutiqaat WFM System.

Even if the first version will be used internally by Boutiqaat only, the system should be designed in a way that can later support:
- Multiple companies
- Multiple departments
- Multiple contact centers
- Multiple countries/timezones
- Subscription plans
- Licensing
- Tenant isolation
- White-labeling
- Controlled feature access

This prevents rebuilding the system from scratch if it becomes a SaaS product later.

---

# 1. SaaS Readiness Decision

The system should be built as **SaaS-ready from day one**, even if MVP is single-company.

This means:
- Do not hardcode Boutiqaat everywhere.
- Do not hardcode one timezone only.
- Do not hardcode one company ID.
- Do not assume one tenant forever.
- Add tenant/company structure early.
- Keep tenant isolation in database and backend queries.
- Make branding configurable.

Recommended approach:
- MVP can run as a single tenant.
- Database should still include `tenant_id` / `organization_id` where needed.
- Backend should enforce tenant isolation.
- UI should allow future tenant branding.

---

# 2. Multi-Tenancy Model

## 2.1 Recommended Model

Use **shared database, shared schema, tenant_id isolation** for MVP and early SaaS.

Why:
- Easier to build
- Lower cost
- Easier reporting
- Easier maintenance
- Good enough if tenant isolation is enforced carefully

Future enterprise option:
- Dedicated database per large customer if needed.

## 2.2 Required Tenant Tables

Add tables such as:

### tenants
Stores company/account level.

Fields:
- id
- name
- legal_name
- slug
- status
- timezone
- default_locale
- logo_url
- primary_color
- created_at
- updated_at

### tenant_settings
Stores tenant-specific settings.

Examples:
- working_week_start
- default_timezone
- max_concurrent_users
- allowed_modules
- security_settings
- notification_settings
- schedule_rules
- attendance_rules

### tenant_subscriptions
If SaaS commercial model is needed.

Fields:
- tenant_id
- plan_id
- status
- started_at
- expires_at
- max_users
- max_agents
- max_storage_gb

### plans
Stores SaaS plans:
- Starter
- Professional
- Enterprise
- Internal

### plan_features
Controls feature availability by plan.

Examples:
- schedule_generator
- scorecard
- outage_management
- erlang_capacity
- advanced_reports
- api_access
- white_labeling
- sso

---

# 3. Tenant Isolation Rules

Every tenant-owned table should include `tenant_id`, for example:
- users
- employees
- teams
- functions
- schedules
- attendance_records
- requests
- approvals
- outages
- technical_issues
- scorecards
- coaching
- notifications
- audit_logs
- attachments
- import_batches

Backend rule:
- Every query must be scoped by tenant_id.
- Never trust tenant_id from frontend directly.
- Tenant must come from authenticated user/session/token.
- Super Admin can access across tenants only with explicit permission.
- Audit logs must include tenant_id.

Security risk:
- Missing tenant_id filters can leak data between companies.
- Add tests for tenant isolation.

---

# 4. SaaS Roles

Separate platform roles from tenant roles.

## 4.1 Platform-Level Roles
Used by the SaaS owner/operator:
- Platform Super Admin
- Platform Support
- Platform Billing Admin
- Platform Security Auditor

## 4.2 Tenant-Level Roles
Used inside each tenant/company:
- Tenant Admin
- Operations Manager
- WFM Supervisor
- WFM Analyst
- RTA
- Team Leader
- HR
- IT Admin
- Agent

Important:
- A user may belong to one or multiple tenants.
- A user may have different roles per tenant.
- Do not assume one global role is enough in SaaS mode.

---

# 5. SaaS Authentication

Support future:
- Email/password
- SSO per tenant
- SAML/OIDC
- MFA
- Tenant-specific login URL or slug

Examples:
- `/login?tenant=boutiqaat`
- `boutiqaat.wfm-system.com`
- `company-name.wfm-system.com`

MVP can start with single login, but architecture should allow tenant identification.

---

# 6. Feature Flags / Module Access

Use feature flags to enable/disable modules per tenant or plan.

Examples:
- Attendance
- Schedule Generator
- Scorecard
- Coaching
- Outage Management
- Technical Issues
- Capacity Planning
- RTA Command Center
- Advanced Reports
- API Integrations
- White Labeling
- SSO

This allows:
- MVP vs Enterprise features
- Paid plans
- Controlled rollout
- Beta features
- Tenant-specific customization

---

# 7. White Labeling

If used as SaaS, each tenant may need:
- Logo
- Company name
- Primary color
- Secondary color
- Login background
- Language defaults
- Timezone
- Footer text
- Email template branding

Important:
- Do not hardcode Boutiqaat name in UI components.
- Put branding in tenant settings.

---

# 8. Subscription / Licensing

If commercial SaaS is planned, support:

## Plans
Example:
- Internal
- Starter
- Professional
- Enterprise

## Limits
- Max users
- Max agents
- Max functions
- Max schedules/month
- Max imports/month
- Max storage
- Max API calls
- Max dashboards
- Advanced modules allowed

## Enforcement
Backend must enforce limits, not frontend only.

## License Check
Optional:
- Tenant license status
- Expiry date
- Trial mode
- Grace period
- Disabled status
- Billing contact

---

# 9. SaaS Security Requirements

SaaS security must include:
- Tenant isolation tests
- RBAC per tenant
- Audit logs per tenant
- Platform admin audit
- Data export restrictions
- Backup isolation
- Secure deletion process
- Encryption in transit
- Encryption at rest where possible
- Secrets per environment
- Rate limits per tenant
- Abuse protection
- File storage access control

Critical:
- One tenant must never access another tenant’s data.

---

# 10. SaaS Database Design Rules

When adding new tables, ask:
1. Is this tenant-owned data?
2. Should it include tenant_id?
3. Should it be global/platform data?
4. Does it need plan/feature restrictions?
5. Does it need audit logs?
6. Does it need soft delete?
7. Does it need created_by/updated_by?

Tenant-owned examples:
- employees
- schedules
- attendance
- requests
- reports
- scorecards
- outages
- technical issues

Global examples:
- platform plans
- global feature definitions
- system-wide migrations
- platform admin users

---

# 11. SaaS API Design Rules

All tenant APIs must:
- Use authenticated tenant context
- Scope queries by tenant_id
- Validate permissions within tenant
- Avoid exposing cross-tenant IDs
- Support pagination
- Support rate limits
- Log sensitive actions

Example pattern:
- `GET /api/v1/schedules` returns schedules for current tenant only.
- Platform admin endpoint can use `/api/platform/tenants/:tenantId/schedules`, protected by platform role.

---

# 12. SaaS Reporting

Reports should be tenant-scoped by default.

Tenant admin sees only their company data.

Platform super admin may see:
- Tenant usage
- Storage usage
- Active users
- Failed login count
- API usage
- Billing metrics
- System health

Do not mix tenant operational data unless explicitly authorized.

---

# 13. SaaS Deployment

Recommended environments:
- Development
- Staging
- Production

For SaaS:
- Use domain per environment
- Use secure environment variables
- Use private database
- Use centralized logging
- Use monitoring
- Use backups
- Use migration strategy
- Use rollback strategy

Optional future:
- Subdomain per tenant
- Region-specific deployment
- Dedicated database for Enterprise clients

---

# 14. SaaS Acceptance Criteria

The system is SaaS-ready when:

1. Tenant model exists.
2. Tenant_id is applied to tenant-owned tables.
3. Backend enforces tenant isolation.
4. UI can display tenant branding.
5. Feature flags exist.
6. Role permissions are tenant-scoped.
7. Audit logs include tenant_id.
8. Tests verify tenant A cannot access tenant B data.
9. Plans/subscriptions can be added without redesign.
10. Hardcoded Boutiqaat references are moved to tenant settings where appropriate.

---

# 15. Recommended MVP Approach

For the current project:

## Build Now
- Add tenant table
- Add tenant_id to core tables
- Seed Boutiqaat as first tenant
- Add tenant context to auth
- Add tenant-aware RBAC
- Add tenant_id to audit logs
- Add tenant settings table
- Keep UI branded as Boutiqaat through settings

## Defer
- Billing
- Payments
- Public signup
- Multi-tenant self-service onboarding
- Subdomain routing
- White-label editor
- Plan upgrade/downgrade
- Marketplace/API billing

This gives SaaS readiness without delaying MVP too much.