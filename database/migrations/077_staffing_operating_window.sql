-- 077: Operating window per function — the deferred-work model (standard WFM
-- practice): IMMEDIATE channels (voice/chat) staff to arrival 24/7; DEFERRED
-- channels (email/back-office) staff inside their operating window — volume
-- arriving outside the window rolls INTO the window (handled next morning),
-- so the engine stops demanding night staffing for email queues.
-- Defaults are EDITABLE (Staffing Engine UI) — the Director calibrates.

ALTER TABLE staffing_params ADD COLUMN IF NOT EXISTS open_hour  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staffing_params ADD COLUMN IF NOT EXISTS close_hour INTEGER NOT NULL DEFAULT 24;

-- Recommended defaults: back-office/deferred functions work 08:00–20:00.
UPDATE staffing_params SET open_hour = 8, close_hour = 20
 WHERE function_key IN ('Offline', 'Refund', 'Support', 'Social Media & Email', 'Customer Care')
   AND open_hour = 0 AND close_hour = 24;
