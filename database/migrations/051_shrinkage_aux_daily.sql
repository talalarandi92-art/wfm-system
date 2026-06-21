-- 051_shrinkage_aux_daily.sql
-- AUX / break-state shrinkage rolled up from the Ameyo agent session details
-- (raw sessions NOT stored). Per (date, reason): total seconds + session count.
-- Feeds the shrinkage module — breaks, meetings, training, prayer, and
-- cross-channel pulls (Working in Social Media/Email/Chat/Escalation).

CREATE TABLE IF NOT EXISTS shrinkage_aux_daily (
  tenant_id     UUID NOT NULL,
  aux_date      DATE NOT NULL,
  reason        TEXT NOT NULL,
  seconds       BIGINT NOT NULL DEFAULT 0,
  sessions      INTEGER NOT NULL DEFAULT 0,
  source        TEXT DEFAULT 'ameyo',
  PRIMARY KEY (tenant_id, aux_date, reason)
);
CREATE INDEX IF NOT EXISTS idx_shrink_date ON shrinkage_aux_daily (tenant_id, aux_date);
