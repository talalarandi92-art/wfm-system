-- ──────────────────────────────────────────────────────────────────────────────
-- Migration 003: Add permission_type to request_permissions
-- Permission types: late_in, early_out, temp_out, return_during_shift
-- Rules enforced at application level:
--   - Min duration: 30 minutes
--   - Max duration per request: 3 hours (180 minutes)
--   - Max 3 permissions per week per employee
-- ──────────────────────────────────────────────────────────────────────────────

-- Create enum for permission types
DO $$ BEGIN
  CREATE TYPE permission_type_enum AS ENUM (
    'late_in',
    'early_out',
    'temp_out',
    'return_during_shift'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add permission_type column to request_permissions
ALTER TABLE request_permissions
  ADD COLUMN IF NOT EXISTS permission_type permission_type_enum NOT NULL DEFAULT 'temp_out';

-- Add index for efficient weekly quota queries
CREATE INDEX IF NOT EXISTS idx_req_perm_emp_week
  ON request_permissions(permission_date);

-- Remove default after adding (we want it required going forward)
ALTER TABLE request_permissions
  ALTER COLUMN permission_type DROP DEFAULT;

COMMENT ON COLUMN request_permissions.permission_type IS
  'Type of permission: late_in=coming late, early_out=leaving early, temp_out=temporary exit during shift, return_during_shift=returning after temp exit';
