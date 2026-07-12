-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 090: Enforce one-user-per-employee at the DATABASE level.
--
--   Today `users` carries only a NON-unique index (idx_users_employee, m001) on
--   employee_id, and the "one login per employee" invariant is enforced ONLY in
--   application code (users.controller.ts). Before any bulk account provisioning
--   this MUST become a real constraint — a race between two concurrent create
--   calls, or a direct/script insert, can otherwise double-link an employee.
--
--   PARTIAL unique index: uniqueness applies only to rows WHERE employee_id IS
--   NOT NULL, so multiple users with a NULL employee_id (platform/admin accounts
--   not tied to an employee) remain allowed. Scoped by tenant_id to stay correct
--   under the multi-tenant model.
--
--   IDEMPOTENT: CREATE UNIQUE INDEX IF NOT EXISTS. The non-unique m001 index is
--   left in place — Postgres uses the unique one for employee_id lookups too, and
--   dropping it is out of scope for this safety change.
--
--   Risk study, 2026-07-12. Verified no duplicate (tenant_id, employee_id) pair
--   exists before applying.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_tenant_employee
  ON users (tenant_id, employee_id)
  WHERE employee_id IS NOT NULL;
