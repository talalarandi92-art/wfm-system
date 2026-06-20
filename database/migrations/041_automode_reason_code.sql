-- 041_automode_reason_code.sql
-- Auto Mode stored its decision reason as free-text Arabic, which then showed
-- up Arabic inside the English UI. Add a stable, language-neutral reason_code
-- so the frontend can render the reason bilingually. Keep `reason` for audit.

ALTER TABLE automode_decisions ADD COLUMN IF NOT EXISTS reason_code TEXT;

-- Backfill existing rows by matching the known Arabic reason patterns.
UPDATE automode_decisions SET reason_code = CASE
  WHEN reason LIKE 'لا توجد قراءة%'                 THEN 'hold_no_coverage'
  WHEN reason LIKE 'فائض آمن%'                      THEN 'approve_surplus'
  WHEN reason LIKE 'نقص تغطية%'                     THEN 'reject_shortfall'
  WHEN reason LIKE 'تغطية%تُرك للمراجعة%'           THEN 'hold_verdict'
  ELSE 'hold_no_coverage'
END
WHERE reason_code IS NULL;
