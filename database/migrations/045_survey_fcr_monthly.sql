-- 045_survey_fcr_monthly.sql
-- Monthly FCR (First Contact Resolution) from the Sprinklr survey
-- "Were we able to resolve your issue today?" — aggregated per agent + channel +
-- month (Yes/No, incl. Arabic نعم/لا). employee_id resolved via sprinklr_agent_map
-- (authoritative) where possible; left NULL when not confidently mapped.

CREATE TABLE IF NOT EXISTS survey_fcr_monthly (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  employee_id   UUID,                         -- NULL when email not confidently mapped
  agent_email   TEXT NOT NULL,
  agent_name    TEXT,
  channel       TEXT NOT NULL,                -- normalized: whatsapp / instagram / facebook / x / email
  year_month    DATE NOT NULL,                -- 1st of the month
  resolved_yes  INTEGER NOT NULL DEFAULT 0,
  resolved_no   INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  fcr_pct       NUMERIC(5,1),                 -- resolved_yes / total * 100
  source        TEXT DEFAULT 'sprinklr-survey',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, agent_email, channel, year_month)
);

CREATE INDEX IF NOT EXISTS idx_survey_fcr_emp   ON survey_fcr_monthly (tenant_id, employee_id, year_month);
CREATE INDEX IF NOT EXISTS idx_survey_fcr_month ON survey_fcr_monthly (tenant_id, year_month);
