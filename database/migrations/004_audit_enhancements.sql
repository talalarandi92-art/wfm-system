-- ──────────────────────────────────────────────────────────────────────────────
-- Migration 004: Schedule Audit Enhancements
-- Adds source_of_change, validation_flags, approval tracking to schedule_entry_edits
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Source-of-change enum
DO $$ BEGIN
  CREATE TYPE schedule_change_source_enum AS ENUM (
    'auto_generated',
    'manual_edit',
    'shift_swap',
    'off_swap',
    'sick_leave',
    'absence',
    'annual_leave',
    'comp',
    'permission',
    'business_need_override',
    'emergency',
    'import_excel',
    'correction'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Enhance schedule_entry_edits
ALTER TABLE schedule_entry_edits
  ADD COLUMN IF NOT EXISTS source_of_change    schedule_change_source_enum,
  ADD COLUMN IF NOT EXISTS edit_type_label     VARCHAR(60),   -- human-readable edit type
  ADD COLUMN IF NOT EXISTS validation_flags    JSONB,         -- [{rule, severity, message}]
  ADD COLUMN IF NOT EXISTS approval_required   BOOLEAN        NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approved_by         UUID           REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_notes      TEXT,
  ADD COLUMN IF NOT EXISTS related_request_id  UUID           REFERENCES requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hc_before           INTEGER,       -- working count before edit
  ADD COLUMN IF NOT EXISTS hc_after            INTEGER,       -- working count after edit
  ADD COLUMN IF NOT EXISTS fairness_before     NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS fairness_after      NUMERIC(5,2);

-- 3. Index for audit report queries
CREATE INDEX IF NOT EXISTS idx_entry_edits_source    ON schedule_entry_edits(source_of_change);
CREATE INDEX IF NOT EXISTS idx_entry_edits_approval  ON schedule_entry_edits(approval_required, approved_at);
CREATE INDEX IF NOT EXISTS idx_entry_edits_req       ON schedule_entry_edits(related_request_id);

COMMENT ON TABLE schedule_entry_edits IS
  'Immutable audit trail of every schedule cell change. One row per edit action.';
COMMENT ON COLUMN schedule_entry_edits.source_of_change IS
  'Classifies the origin of the change for reporting (auto_generated, manual_edit, swap, import, etc.)';
COMMENT ON COLUMN schedule_entry_edits.validation_flags IS
  'JSON array of rule violations detected at edit time [{rule, severity, messageAr, messageEn}]';
COMMENT ON COLUMN schedule_entry_edits.approval_required IS
  'TRUE when the edit violates a rule and requires WFM/Admin override approval';
