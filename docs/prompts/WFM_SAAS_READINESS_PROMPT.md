# PROMPT — ADD SAAS READINESS TO WFM SYSTEM

Important new requirement:

The WFM System must be designed as SaaS-ready from day one, even if the MVP will be used internally by Boutiqaat only.

Read:
- docs/WFM_SAAS_ARCHITECTURE_ADDENDUM.md
- CLAUDE.md
- PROJECT_CONTEXT.md
- docs/WFM_SECURITY_SCALABILITY_ADDENDUM.md

Before coding, explain how you will update the architecture for SaaS readiness.

Mandatory points:
1. Add tenant/company model.
2. Seed Boutiqaat as the first tenant.
3. Add tenant_id to tenant-owned tables.
4. Enforce tenant isolation in backend queries.
5. Do not trust tenant_id from frontend.
6. Tenant context must come from auth/session/token.
7. Add tenant-aware RBAC.
8. Add tenant_id to audit logs.
9. Add tenant settings for branding, timezone, working week, and module settings.
10. Add feature flags / module access design.
11. Keep billing/subscriptions optional for future.
12. Do not hardcode Boutiqaat in a way that prevents SaaS use.
13. Add tests proving tenant A cannot access tenant B data.

Do not start coding until you provide:
- Required database changes
- Backend auth/RBAC changes
- Frontend branding/settings changes
- Security risks
- Migration strategy
- What is MVP now vs SaaS future