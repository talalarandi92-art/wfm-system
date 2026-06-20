-- 042_automode_hold_dedup.sql
-- BUG: Auto Mode re-inserted a 'hold' decision row on every tick (the existing
-- unique index only covered approve/reject), so holds accumulated unboundedly —
-- 6 real held requests had grown to 6946 rows (~1158 ticks). The Chief panel then
-- showed a phantom "6946 held for review".
--
-- Fix: collapse duplicate holds to the latest per request, then add a partial
-- unique index so future ticks upsert one current hold per request.

-- 1) Keep only the most recent hold row per (tenant, request).
DELETE FROM automode_decisions WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY tenant_id, request_id ORDER BY decided_at DESC, id DESC
    ) AS rn
    FROM automode_decisions WHERE decision = 'hold'
  ) t WHERE t.rn > 1
);

-- 2) Prevent re-accumulation: at most one 'hold' row per request.
CREATE UNIQUE INDEX IF NOT EXISTS uq_automode_hold_request
  ON automode_decisions (request_id) WHERE decision = 'hold';
