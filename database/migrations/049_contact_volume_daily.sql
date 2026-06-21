-- 049_contact_volume_daily.sql
-- Daily contact volume rolled up from the Ameyo interval summaries (raw intervals
-- NOT stored). One row per (date, channel): offered/handled/abandoned volume,
-- talk seconds (→ AHT), in-SLA count (→ SLA%). Feeds forecasting, the CPO ratio
-- (contacts ÷ orders) and intraday/Erlang planning.

CREATE TABLE IF NOT EXISTS contact_volume_daily (
  tenant_id      UUID NOT NULL,
  vol_date       DATE NOT NULL,
  channel        TEXT NOT NULL,            -- 'voice' | 'chat' | 'whatsapp' | 'social' | 'email'
  offered        INTEGER NOT NULL DEFAULT 0,   -- total received/offered
  handled        INTEGER NOT NULL DEFAULT 0,   -- connected/answered
  abandoned      INTEGER NOT NULL DEFAULT 0,
  in_target      INTEGER NOT NULL DEFAULT 0,   -- answered within SLA target
  talk_seconds   BIGINT  NOT NULL DEFAULT 0,   -- sum talk/handle time → AHT = talk/handled
  source         TEXT DEFAULT 'ameyo',
  PRIMARY KEY (tenant_id, vol_date, channel)
);
CREATE INDEX IF NOT EXISTS idx_cvd_date ON contact_volume_daily (tenant_id, vol_date);

-- Average intraday profile (share of daily volume by half-hour) per channel, for
-- intraday shaping. interval_idx = 0..47 (each = 30 min from 00:00 local).
CREATE TABLE IF NOT EXISTS contact_volume_profile (
  tenant_id      UUID NOT NULL,
  channel        TEXT NOT NULL,
  interval_idx   INTEGER NOT NULL,        -- 0..47
  offered        BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, channel, interval_idx)
);
