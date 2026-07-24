-- 096_ot_source_derived_date.sql
-- ============================================================================
-- A THIRD DATE PRECISION: 'derived'.
--
-- One of the Director's overtime workbooks (`Israa Wal Miraj Jan CC Overtime
-- 2026`) has NO date column at all — its calculation sheet heads a single day
-- column "Sun" and nothing more. Those 43 rows were parked at month precision
-- so that no day would be invented for them, which was right, but it left 344
-- hours sitting in an "Undated" column with no path out.
--
-- They are not undatable. The roster knows which day it was: of the four
-- Sundays in January 2026, only 2026-01-18 carries holiday markers (44 rows
-- hr_code='H', 37 shift_code='H', 51 rows with holiday OT), and 37 of those
-- exact 43 people have holiday OT on that day and none on any other Sunday.
--
-- So the ingester now RESOLVES an undated sheet against that evidence and
-- records the result as 'derived': a real work_date, clearly distinguished from
-- a date the file actually stated, always carrying the evidence in
-- data_quality. Reversible, auditable, and never a silent guess. If the
-- evidence is ambiguous the rows stay at month precision, as before.
-- ============================================================================

ALTER TABLE ot_source_rows DROP CONSTRAINT IF EXISTS ot_source_rows_precision_ck;

ALTER TABLE ot_source_rows ADD CONSTRAINT ot_source_rows_precision_ck
  CHECK (date_precision IN ('day', 'month', 'derived')
         AND ((date_precision IN ('day', 'derived') AND work_date IS NOT NULL)
           OR (date_precision = 'month' AND work_date IS NULL)));

COMMENT ON COLUMN ot_source_rows.date_precision IS
  'day = the workbook stated the date · derived = the workbook stated none and the roster''s holiday evidence identified it (evidence recorded in data_quality) · month = still unresolved, period_month only. A day is never invented without evidence.';
