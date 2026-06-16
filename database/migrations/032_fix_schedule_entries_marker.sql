-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 032: widen schedule_entries.attendance_marker
-- It was VARCHAR(5) but the markers stored on save (present/absent/sick/off/…)
-- exceed 5 chars, so "Save as Draft" failed with "value too long for type
-- character varying(5)". Widen to match the attendance_records marker values.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE schedule_entries
  ALTER COLUMN attendance_marker TYPE VARCHAR(20);
