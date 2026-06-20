-- 040_role_access_model.sql
-- Confirmed access model:
--   • Admin (platform_admin) → everything, incl. settings.
--   • RTA + Team Leader → "like admin" (see all + do their operational job:
--     approvals, validations, edits) BUT may NOT change settings / admin config /
--     user accounts.
--   • Agent → only their own data (unchanged; row-level scoping enforced in code).
--
-- Grants RTA + Team Leader every permission EXCEPT the settings/admin/user-mgmt
-- cluster. Idempotent.

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
 WHERE r.code IN ('rta', 'team_leader')
   AND p.code NOT IN (
     'settings.edit',
     'admin.roles', 'admin.functions', 'admin.shift_codes',
     'users.create', 'users.edit', 'users.deactivate', 'users.view'
   )
ON CONFLICT (role_id, permission_id) DO NOTHING;
