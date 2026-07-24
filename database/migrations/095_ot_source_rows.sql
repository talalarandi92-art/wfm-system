-- 095_ot_source_rows.sql
-- ============================================================================
-- THE OVERTIME SOURCE LEDGER — the Director's own per-occasion OT workbooks,
-- ingested row-by-row with full provenance, so the year-to-date tracker can be
-- built from HIS approved sheets rather than only from the engine's detection.
--
-- WHY A RAW LEDGER AND NOT A DEDUPED TABLE:
--   The 10 workbooks in `Desktop/Overtime 2026` overlap heavily on purpose — a
--   single event file carries `Details` + `All New+ Old` + `New`, Ramadan carries
--   `FULL SYSTEM` + `Normal Days OV Details` + `Day OFF OV Details`, and the two
--   End-Of-Year files nearly repeat each other. Measured: 5,262 rows collapse to
--   2,831 person-days — naively stacking the sheets would report 21,712 hours
--   where the truth is 12,274 (a 9,438-hour double count, +77%).
--   So every row is stored AS FOUND, and one-value-per-person-day is decided at
--   READ time. That keeps the ledger truthful, makes the 46 genuine conflicts
--   (same person, same day, different hours) visible instead of silently
--   resolved, and lets the rule change later without re-ingesting.
--
-- DATE PRECISION: `Israa Wal Miraj Jan CC Overtime 2026` has no date column at
--   all — its calculation sheet names a single unspecified "Sun" in Jan 2026. Its
--   rows are stored with date_precision='month' and work_date NULL rather than
--   having a day invented for them. period_month is ALWAYS known.
--
-- Read-only downstream: nothing here feeds pay automatically.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ot_source_rows (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID        NOT NULL,
  person_no       TEXT        NOT NULL,
  employee_name   TEXT,
  work_date       DATE,                                  -- NULL ⇔ date_precision='month'
  date_precision  TEXT        NOT NULL DEFAULT 'day',    -- 'day' | 'month'
  period_month    TEXT        NOT NULL,                  -- YYYY-MM, always known
  hours           NUMERIC(6,2) NOT NULL,
  shift_code      TEXT,
  location        TEXT,
  note            TEXT,
  occasion        TEXT        NOT NULL,                  -- derived from the file name
  source_file     TEXT        NOT NULL,
  source_sheet    TEXT        NOT NULL,
  source_row      INTEGER     NOT NULL,                  -- 1-based row in that sheet
  data_quality    TEXT,                                  -- e.g. 'day-name-mismatch'
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ot_source_rows_precision_ck
    CHECK (date_precision IN ('day', 'month')
           AND ((date_precision = 'day' AND work_date IS NOT NULL)
             OR (date_precision = 'month' AND work_date IS NULL))),
  CONSTRAINT ot_source_rows_hours_ck CHECK (hours > 0),
  CONSTRAINT ot_source_rows_uq UNIQUE (tenant_id, source_file, source_sheet, source_row)
);

CREATE INDEX IF NOT EXISTS ot_source_rows_person_idx ON ot_source_rows (tenant_id, person_no);
CREATE INDEX IF NOT EXISTS ot_source_rows_month_idx  ON ot_source_rows (tenant_id, period_month);
CREATE INDEX IF NOT EXISTS ot_source_rows_date_idx   ON ot_source_rows (tenant_id, work_date);

COMMENT ON TABLE  ot_source_rows IS
  'Raw OT rows from the Director''s per-occasion overtime workbooks. Deliberately NOT deduplicated: the source sheets overlap by design, so one-value-per-person-day is resolved at read time and conflicts stay visible.';
COMMENT ON COLUMN ot_source_rows.date_precision IS
  'day = the file gave a real date; month = the file gave none (period_month only). A day is never invented.';
COMMENT ON COLUMN ot_source_rows.hours IS
  'Hours exactly as the workbook states them (the OV/OT column) — the Director''s approved figure, not the engine''s measurement.';
