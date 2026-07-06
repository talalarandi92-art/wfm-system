-- 074: Per-function staffing parameters — the configuration behind the
-- Staffing Requirement Engine (forecast → Erlang → generator chain).
-- Every number the Director named is a first-class, editable column:
-- CPO%, AHT, ACW, Hold, occupancy, shrinkage, productivity (+ SL target,
-- concurrency and the queueing model per channel).
-- aht_sec NULL = "measure it" (28-day actuals from contact_volume_daily).

CREATE TABLE IF NOT EXISTS staffing_params (
  tenant_id          UUID        NOT NULL,
  function_key       TEXT        NOT NULL,             -- canon_fn(function name)
  channel_mix        JSONB       NOT NULL DEFAULT '{}'::jsonb, -- {"chat":0.6,"whatsapp":0.4}
  model              TEXT        NOT NULL DEFAULT 'erlang_c',  -- erlang_c | concurrency | throughput
  cpo_pct            NUMERIC(6,3),                     -- contacts-per-order % (calibration/scenario lever)
  aht_sec            INTEGER,                          -- NULL = measured 28d actuals
  acw_sec            INTEGER     NOT NULL DEFAULT 30,  -- after-contact work
  hold_sec           INTEGER     NOT NULL DEFAULT 0,   -- avg hold per contact
  target_sl          NUMERIC(4,3) NOT NULL DEFAULT 0.80,
  target_answer_sec  INTEGER     NOT NULL DEFAULT 20,
  occupancy_cap      NUMERIC(4,3) NOT NULL DEFAULT 0.85,
  shrinkage          NUMERIC(4,3) NOT NULL DEFAULT 0.25,
  productivity       NUMERIC(4,3) NOT NULL DEFAULT 1.00, -- blended (interns ≈ 0.70)
  concurrency        INTEGER     NOT NULL DEFAULT 1,   -- parallel conversations (chat/WA = 4)
  marginal_eff       NUMERIC(4,3) NOT NULL DEFAULT 0.75, -- efficiency of each extra parallel slot
  is_staffed         BOOLEAN     NOT NULL DEFAULT TRUE,  -- FALSE = supervisory/excluded from demand staffing
  updated_by         UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, function_key)
);

-- Seed Boutiqaat defaults (live canon functions; measured AHT stays NULL = auto).
-- channel_mix values are VOLUME SHARES of that channel routed to the function —
-- the shares of one channel must sum to ≤ 1 ACROSS functions (no double counting):
--   chat/whatsapp → CH-WA only (share 1 each, concurrency 4)
--   voice         → Inbound 0.85 / Customer Care 0.15
--   social        → Social Media & Email (1)
--   email         → Social Media & Email 0.4 / Offline 0.3 / Refund 0.2 / Support 0.1
--   OMT is OUTBOUND (no inbound arrival volume) → fixed staffing, is_staffed FALSE.
INSERT INTO staffing_params
  (tenant_id, function_key, channel_mix, model, target_answer_sec, concurrency, is_staffed)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'CH - WA',               '{"chat":1,"whatsapp":1}',    'concurrency', 60, 4, TRUE),
  ('a0000000-0000-0000-0000-000000000001', 'Inbound',               '{"voice":0.85}',             'erlang_c',    20, 1, TRUE),
  ('a0000000-0000-0000-0000-000000000001', 'Customer Care',         '{"voice":0.15}',             'erlang_c',    20, 1, TRUE),
  ('a0000000-0000-0000-0000-000000000001', 'Social Media & Email',  '{"social":1,"email":0.4}',   'concurrency', 300, 3, TRUE),
  ('a0000000-0000-0000-0000-000000000001', 'Offline',               '{"email":0.3}',              'throughput',  0, 1, TRUE),
  ('a0000000-0000-0000-0000-000000000001', 'Refund',                '{"email":0.2}',              'throughput',  0, 1, TRUE),
  ('a0000000-0000-0000-0000-000000000001', 'OMT',                   '{}',                         'throughput',  0, 1, FALSE),
  ('a0000000-0000-0000-0000-000000000001', 'Support',               '{"email":0.1}',              'throughput',  0, 1, TRUE),
  ('a0000000-0000-0000-0000-000000000001', 'RTA',                   '{}',                         'erlang_c',    20, 1, FALSE),
  ('a0000000-0000-0000-0000-000000000001', 'Team Leader',           '{}',                         'erlang_c',    20, 1, FALSE),
  ('a0000000-0000-0000-0000-000000000001', 'Resolution Specialist', '{}',                         'erlang_c',    20, 1, FALSE)
ON CONFLICT (tenant_id, function_key) DO NOTHING;
