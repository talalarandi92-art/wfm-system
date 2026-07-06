-- chat.view / chat.manage permission codes (2026-07-06, RBAC deny-by-default flip).
-- The chat module had NO permission codes, so its 13 routes were reachable only via the old
-- allow-by-default hole. chat.view = use the internal comms layer (ALL roles incl. agent);
-- chat.manage = channel administration (admin / WFM / TL / RTA). Real member/admin authorization
-- is enforced at the service level (membership + is_admin checks) — these codes gate the surface.
INSERT INTO permissions (id, code, module, action, description)
SELECT gen_random_uuid(), v.code, 'chat', v.action, v.descr
FROM (VALUES
  ('chat.view',   'view',   'Use internal chat (channels + DMs)'),
  ('chat.manage', 'manage', 'Administer chat channels and members')
) AS v(code, action, descr)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code);

-- chat.view → every role; chat.manage → supervisory tiers.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE p.code = 'chat.view'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE p.code = 'chat.manage' AND r.code IN ('platform_admin', 'wfm_analyst', 'team_leader', 'rta')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Agents track the technical issues they reported: the list/detail routes are now explicitly
-- gated tech_issues.view (deny-by-default flip) — grant it to the agent role (allow-by-default
-- had already exposed these reads; this DECLARES the access instead of widening it).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE p.code = 'tech_issues.view' AND r.code = 'agent'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);
