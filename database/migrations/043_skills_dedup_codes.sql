-- 043_skills_dedup_codes.sql
-- The skills catalog had case-duplicate codes (chat/CHAT, email/EMAIL, nps/NPS,
-- voice/VOICE, refund/REFUND, whatsapp/WHATSAPP) from two seed sources, which
-- confused the matrix, gap detection and bulk-assign. Consolidate each
-- UPPER(code) group to a single canonical skill. NON-DESTRUCTIVE: losers are
-- deactivated (is_active=false), not deleted — reversible.
--
-- Canonical pick per group: the skill with the most assignments; ties broken
-- toward the UPPER-CASE code (matches the rest of the catalog: CC, ESC, NPS…).

DO $$
DECLARE g RECORD; keep_id uuid;
BEGIN
  FOR g IN
    SELECT tenant_id, UPPER(code) AS uc
    FROM skills
    GROUP BY tenant_id, UPPER(code)
    HAVING COUNT(*) > 1
  LOOP
    -- choose the keeper
    SELECT s.id INTO keep_id
    FROM skills s
    WHERE s.tenant_id = g.tenant_id AND UPPER(s.code) = g.uc
    ORDER BY (SELECT COUNT(*) FROM employee_skills es WHERE es.skill_id = s.id) DESC,
             (s.code = UPPER(s.code)) DESC,
             s.is_active DESC,
             s.id
    LIMIT 1;

    -- repoint assignments from losers to keeper (skip if the employee already has the keeper)
    UPDATE employee_skills es
       SET skill_id = keep_id, updated_at = NOW()
     WHERE es.skill_id IN (SELECT id FROM skills WHERE tenant_id = g.tenant_id AND UPPER(code) = g.uc AND id <> keep_id)
       AND NOT EXISTS (SELECT 1 FROM employee_skills k WHERE k.employee_id = es.employee_id AND k.skill_id = keep_id);

    -- drop any now-duplicate loser assignments that couldn't be repointed
    DELETE FROM employee_skills
     WHERE skill_id IN (SELECT id FROM skills WHERE tenant_id = g.tenant_id AND UPPER(code) = g.uc AND id <> keep_id);

    -- deactivate the loser skills (reversible)
    UPDATE skills
       SET is_active = FALSE
     WHERE tenant_id = g.tenant_id AND UPPER(code) = g.uc AND id <> keep_id;
  END LOOP;
END $$;
