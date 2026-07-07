-- 078: Skill expiry activation (EXECUTION_BRIEF bug #11) — expires_at was NULL on
-- 709/709 employee_skills rows because 18/19 skills had no expiry_months, so the
-- skill-expiry auto-alerts never fired once.
--
-- RECOMMENDED DEFAULT (editable per skill): 12-month refresh cycle — the contact-
-- center industry standard for skill recertification. The Director can change any
-- skill's expiry_months; alerts key off the derived expires_at.

-- 1. Default refresh cycle for skills that never had one.
UPDATE skills SET expiry_months = 12 WHERE expiry_months IS NULL;

-- 2. Backfill: expires_at = certified_at + expiry_months (only where derivable and empty).
UPDATE employee_skills es
SET expires_at = (es.certified_at + (s.expiry_months || ' months')::interval)::date,
    updated_at = NOW()
FROM skills s
WHERE s.id = es.skill_id
  AND es.expires_at IS NULL
  AND es.certified_at IS NOT NULL
  AND s.expiry_months IS NOT NULL;
